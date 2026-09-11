import 'server-only'

import { and, asc, desc, eq, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  demoVehiclePositions,
  demoVehicleTrackerEvents,
  demoVehicleTrackers,
  loconavProviderVehicles,
} from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { analyticsExecute } from '@/lib/analytics/db'
import { analyticsTableColumnSet } from '@/lib/analytics/table-columns'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { canSeeAllGatePassDealers, isDealerInScope } from '@/lib/gate-pass/access'
import { listDemoVehiclesForGatePass, lookupDemoCarBranchesByVin } from '@/lib/gate-pass/vehicles'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { suggestTrackerLinks } from './matching'
import { getLoconavSyncState, pgErrorCode } from './sync'

/**
 * The Trackers screen, server side: which LocoNav tracker is fitted to which demo car, as confirmed by a person.
 *
 * ── The split this file keeps ─────────────────────────────────────────────────────────────────
 * Postgres only. The provider fleet comes from loconav_provider_vehicles, which the sync keeps; this file never
 * imports lib/loconav/client.ts. Linking a tracker is a decision about our own rows, and a screen that waited on
 * LocoNav to render would inherit the account's 20-requests-per-window limit.
 *
 * ── Why links are made by hand ───────────────────────────────────────────────────────────────
 * The only automatic link is LocoNav `chassisNumber` === our VIN, and on the live account that field holds a
 * plate or free text for 17 of 18 vehicles (2026-09-11). A plate is not an identity — `JK02C0059TC` is on five
 * cars — so lib/loconav/matching.ts may SUGGEST a car and nothing more. Every link written here is
 * `matched_by = 'manual'`, made by a named person, and recorded in demo_vehicle_tracker_events.
 *
 * ⚠️ NEVER RETURNS COORDINATES, POSITIONS, DEVICE PHONE NUMBERS OR FULL DEVICE SERIALS. The board goes to every
 * gate pass approver, and two of the units on the account are not demo cars.
 */

// ── The API contract (GET / POST /api/gate-pass/tracking/mappings) ────────────────────────────

export type TrackerRow = {
  providerVehicleUuid: string
  /** displayNumber || vehicleNumber || 'Unnamed tracker' */
  label: string
  vehicleNumber: string | null
  displayNumber: string | null
  chassisNumber: string | null
  deviceType: string | null
  deviceSerialLast4: string | null
  subscriptionExpiresAt: string | null
  subscriptionExpired: boolean
  lastFixAt: string | null
  lastSeenAt: string | null
  onAccount: boolean
  link: null | {
    vin: string
    registrationNumber: string | null
    model: string | null
    /**
     * The fleet row's branch; for a car that has left the fleet, the branch of the newest demo feed row for its VIN.
     * Null when neither knows it.
     */
    dealerCode: string | null
    matchedBy: 'chassis' | 'manual'
    linkedByName: string | null
    linkedAt: string | null
    inDemoFleet: boolean
    /** A manual link on a car in the actor's branches. The same test gates a move away from this car. */
    canUnlink: boolean
  }
  suggestion: null | {
    vin: string
    registrationNumber: string | null
    model: string | null
    dealerCode: string | null
    reason: 'plate_and_model' | 'plate_only'
  }
}

export type DemoCarRow = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  dealerCode: string | null
  sharedPlate: boolean
  trackerStatusOnRecord: string | null
  linkedTrackerUuid: string | null
  inScope: boolean
}

export type TrackerEvent = {
  id: string
  action: 'link' | 'unlink'
  vin: string
  providerVehicleUuid: string
  providerLabel: string | null
  note: string | null
  actorName: string
  createdAt: string
}

export type TrackerBoardResponse = {
  /** LOCO_AUTH_TOKEN present */
  configured: boolean
  sync: {
    lastRunAt: string | null
    lastSuccessAt: string | null
    lastRunStatus: string | null
    /** A sentence for a failed or skipped run — never the provider's or the database's own text. See boardSyncDetail. */
    lastRunDetail: string | null
    /** The warnings of a run that finished with some, one per entry, without the run's counters. */
    warnings: string[]
    vehiclesMapped: number
    positionsUpdated: number
  }
  trackers: TrackerRow[]
  demoCars: DemoCarRow[]
  /** Latest 20. */
  events: TrackerEvent[]
}

/** The POST body. `note` is trimmed and at most TRACKER_NOTE_MAX_LENGTH characters. */
export type TrackerMappingRequest =
  | {
      action: 'link' | 'unlink'
      providerVehicleUuid: string
      vin: string
      note?: string
    }
  | {
      /** The tracker came off `fromVin` and is fitted to `toVin` now. */
      action: 'move'
      providerVehicleUuid: string
      fromVin: string
      toVin: string
      note?: string
    }

export const TRACKER_NOTE_MAX_LENGTH = 500

export type TrackerMappingResult = { ok: true; alreadyDone?: true }

// ── Errors and actors ─────────────────────────────────────────────────────────────────────────

/**
 * A refusal carrying the status the route answers with.
 *
 * Its own class rather than GatePassError, which lives in lib/gate-pass/server.ts — importing that pulls the
 * pass lifecycle, its emails and the gate token code into a module that needs none of them.
 */
export class TrackerMappingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'TrackerMappingError'
  }
}

/**
 * Who is linking or unlinking. A person carries the AppUser the branch-scope check reads.
 *
 * ⚠️ `id: null` IS THE SYSTEM ACTOR, AND IT SKIPS THE BRANCH-SCOPE CHECK. It exists for one caller: the one-off
 * script that seeds the links the owner confirmed in chat, which has no signed-in user to scope. The route
 * builds its actor with trackerActorFor(access.appUser), whose id is never null — keep it that way. A request
 * path that can produce `id: null` is a request path with no branch pin.
 */
export type TrackerActor =
  | { id: string; name: string; role: string | null; appUser: AppUser }
  | { id: null; name: string; role: string | null; appUser?: undefined }

export function trackerActorFor(appUser: AppUser): TrackerActor {
  return { id: appUser.id, name: appUser.fullName || appUser.email, role: appUser.role, appUser }
}

export type TrackerMappingInput = {
  providerVehicleUuid: string
  vin: string
  note?: string | null
  actor: TrackerActor
}

export type TrackerMoveInput = {
  providerVehicleUuid: string
  /** The car the tracker is linked to now — as the board showed it when the person chose to move it. */
  fromVin: string
  toVin: string
  note?: string | null
  actor: TrackerActor
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const PROVIDER = 'loconav'
/** "Listed by the latest listing": within this of the newest last_seen_at in the snapshot. */
const ON_ACCOUNT_WINDOW_MS = 5 * 60 * 1000
const EVENT_LIMIT = 20

/** VIN normalisation is upper(btrim()) everywhere — lib/loconav/trips.ts joins on it. */
const vinKey = (vin: unknown) => String(vin ?? '').trim().toUpperCase()

/** Normalised on the column side too, so a row written by hand in another case is still that car. */
const trackerVinIs = (vin: string) => sql`upper(btrim(${demoVehicleTrackers.vin})) = ${vin}`
const positionVinIs = (vin: string) => sql`upper(btrim(${demoVehiclePositions.vin})) = ${vin}`

/** Drizzle selects hand back Dates; raw db.execute hands timestamptz back as Postgres text, which Date parses. */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** The last four characters only. The full 16-digit device serial never leaves the server. */
function serialLast4(serial: string | null | undefined): string | null {
  const text = String(serial ?? '').trim()
  return text.length > 4 ? text.slice(-4) : null
}

function validateNote(value: unknown): string | null {
  const note = typeof value === 'string' ? value.trim() : ''
  if (note.length > TRACKER_NOTE_MAX_LENGTH) {
    throw new TrackerMappingError(`The note can be at most ${TRACKER_NOTE_MAX_LENGTH} characters.`, 400)
  }
  return note || null
}

function validateInput(input: TrackerMappingInput) {
  const providerVehicleUuid = String(input.providerVehicleUuid ?? '').trim()
  const vin = vinKey(input.vin)
  if (!providerVehicleUuid) throw new TrackerMappingError('Choose a tracker.', 400)
  if (!vin) throw new TrackerMappingError('Choose a car.', 400)
  return { providerVehicleUuid, vin, note: validateNote(input.note) }
}

function validateMoveInput(input: TrackerMoveInput) {
  const providerVehicleUuid = String(input.providerVehicleUuid ?? '').trim()
  const fromVin = vinKey(input.fromVin)
  const toVin = vinKey(input.toVin)
  if (!providerVehicleUuid) throw new TrackerMappingError('Choose a tracker.', 400)
  if (!fromVin) throw new TrackerMappingError('Say which car the tracker is linked to now.', 400)
  if (!toVin) throw new TrackerMappingError('Choose the car to move the tracker to.', 400)
  if (fromVin === toVin) {
    throw new TrackerMappingError('The tracker is already linked to that car. Choose the car it is fitted to now.', 400)
  }
  return { providerVehicleUuid, fromVin, toVin, note: validateNote(input.note) }
}

/**
 * May this actor act on a car at this dealer code?
 *
 * The rule is lib/gate-pass/access.ts's isDealerInScope — the branch half of canApproveGatePass — called, not
 * restated. `gate_pass.approve` says "you are an approver"; this says "of this car's branch". A Sales Manager
 * pinned to Udhampur re-pointing the tracker on a Jammu car is what the branch pin exists to prevent.
 *
 * ⚠️ A car whose branch is UNKNOWN is in scope only for an actor who sees every branch
 * (canSeeAllGatePassDealers). A sold car is not unknown — its branch comes from the feed, outOfFleetBranches — so
 * what is left is a VIN the feed holds no row for, or one carrying a dealer code it does not recognise.
 * isDealerInScope refuses an empty code for everyone below super admin, which would leave such a link unlinkable
 * by anyone but a developer or the MD.
 */
function carInScope(actor: TrackerActor, dealerCode: string | null): boolean {
  if (actor.id === null) return true
  if (!dealerCode) return canSeeAllGatePassDealers(actor.appUser)
  return isDealerInScope(actor.appUser, dealerCode)
}

/**
 * The branch of each car that has left the demo fleet, from the newest demo feed row for its VIN — sold or not.
 *
 * ⚠️ ASKED ONLY FOR CARS OUTSIDE THE FLEET. A car in it takes its branch from its fleet row, which is what link and
 * the car picker read, so the board and the POST never disagree about a car on screen. Without this a sold car had
 * no branch, and a branch approver could neither unlink nor move the tracker the team had just taken off it.
 *
 * Normalised as the fleet normalises its own codes, so a code the feed does not recognise is unknown — the
 * all-branch rule — here too, rather than a branch no approver is pinned to.
 */
async function outOfFleetBranches(vins: string[], fleetByVin: ReadonlyMap<string, unknown>): Promise<Map<string, string | null>> {
  const outside = [...new Set(vins.map(vinKey))].filter((vin) => vin && !fleetByVin.has(vin))
  if (!outside.length) return new Map()
  const found = await lookupDemoCarBranchesByVin(outside)
  return new Map(outside.map((vin) => [vin, normalizeKiaDealerCode(found.get(vin))]))
}

type LinkRow = { vin: string; providerVehicleUuid: string; providerVehicleNumber: string | null; matchedBy: string }

/** The tracker already stands, as a person's link, on the car a move is taking it to. */
function isManualLinkTo(row: LinkRow | undefined, vin: string): boolean {
  return Boolean(row && vinKey(row.vin) === vin && row.matchedBy === 'manual')
}

/**
 * A move starts only from what the person saw: a person's link from this tracker to `fromVin`. Anything else is a 409
 * saying what stands instead, so they decide again on current data — never a move off a car they were not shown.
 */
function assertMovableFrom(row: LinkRow | undefined, fromVin: string): asserts row is LinkRow {
  if (!row) {
    throw new TrackerMappingError(
      'This tracker is not linked to any car now — someone unlinked it a moment ago. Refresh, then link it to the car it is fitted to.',
      409,
    )
  }
  const vin = vinKey(row.vin)
  if (row.matchedBy !== 'manual') {
    throw new TrackerMappingError(
      vin === fromVin
        ? "LocoNav lists this car's VIN as the chassis number, so this link can't be moved here — correct it in LocoNav."
        : `This tracker is now linked to VIN ${vin} by LocoNav's chassis number, so it can't be moved here — correct it in LocoNav.`,
      409,
    )
  }
  if (vin !== fromVin) {
    throw new TrackerMappingError(`This tracker is now linked to VIN ${vin}, not ${fromVin}. Refresh to see it.`, 409)
  }
}

/**
 * Does exactly this link stand right now? Read on plain db, after a link's transaction has rolled back on a unique
 * index — the one place the answer can no longer come from inside it. A failed read answers false, so the caller keeps
 * its 409 instead of turning it into a 500. `matchedBy` narrows it to a person's link, which is what a move writes.
 */
async function linkStands(vin: string, providerVehicleUuid: string, matchedBy?: 'manual'): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: demoVehicleTrackers.id })
      .from(demoVehicleTrackers)
      .where(and(
        trackerVinIs(vin),
        eq(demoVehicleTrackers.provider, PROVIDER),
        eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
        matchedBy ? eq(demoVehicleTrackers.matchedBy, matchedBy) : undefined,
      ))
      .limit(1)
    return rows.length > 0
  } catch {
    return false
  }
}

/**
 * ⚠️ Every table here comes from a migration applied BY HAND, often after the deploy that needs it — the
 * ordering hazard lib/loconav/positions.ts documents. Without this probe the Trackers panel would turn a raw
 * 42P01 into "Something went wrong", and nobody would learn which migration is the missing step.
 *
 * Latched once true, like positions.ts. A failed board read re-arms it, so a rollback on a warm instance
 * reports itself as a 503 instead of a 500.
 */
let mappingTablesReady = false
async function assertMappingTablesReady(): Promise<void> {
  if (mappingTablesReady) return
  const rows = await db.execute<{ has_0057: boolean; has_0060: boolean }>(sql`
    SELECT (to_regclass('public.demo_vehicle_trackers')  IS NOT NULL
        AND to_regclass('public.demo_vehicle_positions') IS NOT NULL
        AND to_regclass('public.loconav_sync_state')     IS NOT NULL) AS has_0057,
           (to_regclass('public.loconav_provider_vehicles')   IS NOT NULL
        AND to_regclass('public.demo_vehicle_tracker_events') IS NOT NULL) AS has_0060`)
  const row = (rows as unknown as { has_0057?: boolean; has_0060?: boolean }[])[0]
  if (!row?.has_0057) {
    throw new TrackerMappingError('Migration 0057 has not been applied, so GPS tracking is not set up yet.', 503)
  }
  if (!row?.has_0060) {
    throw new TrackerMappingError('Migration 0060 has not been applied, so trackers cannot be linked yet.', 503)
  }
  mappingTablesReady = true
}

/**
 * The sync-state row, shaped for the board.
 *
 * `configured` is getLoconavSyncState's, which asks isLoconavConfigured — this file does not import ./client even
 * for that, so nothing on the Trackers path holds a handle on the provider's fetchers.
 *
 * ⚠️ A failed read reports `configured: true` with a detail saying the status is unknown — not `false`. The 0057
 * probe has already passed, so this is a transient fault; "not configured" would send an approver to check an
 * environment variable that is set, and hide a board whose links need no token at all.
 */
async function readSyncState(): Promise<Pick<TrackerBoardResponse, 'configured' | 'sync'>> {
  try {
    const state = await getLoconavSyncState()
    const shown = boardSyncDetail(state.lastRunStatus, state.lastRunDetail)
    return {
      configured: state.configured,
      sync: {
        lastRunAt: toIso(state.lastRunAt),
        lastSuccessAt: toIso(state.lastSuccessAt),
        lastRunStatus: state.lastRunStatus,
        lastRunDetail: shown.detail,
        warnings: shown.warnings,
        vehiclesMapped: state.vehiclesMapped,
        positionsUpdated: state.positionsUpdated,
      },
    }
  } catch (error) {
    console.error('[loconav] sync state read failed for the Trackers board:', error)
    return {
      configured: true,
      sync: {
        lastRunAt: null,
        lastSuccessAt: null,
        lastRunStatus: 'unknown',
        lastRunDetail: 'The sync status could not be read just now.',
        warnings: [],
        vehiclesMapped: 0,
        positionsUpdated: 0,
      },
    }
  }
}

type BoardSyncDetail = { detail: string | null; warnings: string[] }

/**
 * The sync detail as an approver may read it.
 *
 * ⚠️ loconav_sync_state keeps the raw text for an operator. A failed run stores the error's own message — up to 200
 * characters of LocoNav's response body, or Drizzle's "Failed query: <SQL> params: …" — and a run with warnings stores
 * its counters, then " :: ", then the warnings. The sync route never returns the provider's words and the board may
 * not either: a failure becomes a sentence written here, and warnings come back as a list without the counters.
 * Uses nothing else from this module: verify:loconav runs it on its own.
 */
function boardSyncDetail(status: string | null, detail: string | null): BoardSyncDetail {
  if (!detail) return { detail: null, warnings: [] }
  if (status === 'ok_with_warnings') {
    const at = detail.indexOf(' :: ')
    // ' | ' between the sync's own warnings, ' :: ' before one the route appends after the trip sweep.
    const warnings = at < 0 ? [] : detail.slice(at + 4).split(/ \| | :: /).map((w) => w.trim()).filter(Boolean)
    return { detail: null, warnings }
  }
  // 'ok', 'skipped' and 'unknown' carry sentences this code wrote.
  if (status !== 'failed') return { detail, warnings: [] }
  const said = (sentence: string): BoardSyncDetail => ({ detail: sentence, warnings: [] })
  if (/^Migration 00\d\d has not been applied/.test(detail) || detail.startsWith('LocoNav rate limit reached')) {
    return said(detail)
  }
  if (detail.startsWith('LocoNav auth failed')) {
    return said('LocoNav refused the access token (LOCO_AUTH_TOKEN). Ask the developer to check it.')
  }
  if (detail.includes('LOCO_AUTH_TOKEN is not configured')) return said('LOCO_AUTH_TOKEN is not set on the server.')
  if (detail.startsWith('Failed query:')) return said('A database error stopped the sync. The server log has the details.')
  const http = /^LocoNav \S+ failed: HTTP (\d+)/.exec(detail)
  if (http) return said(`LocoNav answered with an error (HTTP ${http[1]}). The next run will retry.`)
  if (/abort|timeout|timed out|fetch failed/i.test(detail)) return said('LocoNav did not answer in time. The next run will retry.')
  return said('The sync stopped on an unexpected error. The server log has the details.')
}

/**
 * What our own records say about each car's tracker — demo_vehicle_details.tracker_status ('installed' /
 * 'not_installed'), typed by hand on the Demo Cars list — keyed by upper-trimmed vehicle_key. Read-only, and
 * through the same analytics executor lib/gate-pass/vehicles.ts reads that table with, so the flag and the plate
 * come from one place.
 *
 * ⚠️ Advisory, so it may not break the board: a missing table, a missing column or a failed read is an empty map.
 */
async function readTrackerStatusesOnRecord(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    if (!(await analyticsTableExists('demo_vehicle_details'))) return out
    if (!(await analyticsTableColumnSet('demo_vehicle_details')).has('tracker_status')) return out
    const rows = await analyticsExecute<{ vin: string | null; tracker_status: string | null }>(sql`
      SELECT UPPER(TRIM(vehicle_key::text)) AS vin,
             NULLIF(TRIM(tracker_status::text), '') AS tracker_status
      FROM demo_vehicle_details
      WHERE NULLIF(TRIM(vehicle_key::text), '') IS NOT NULL`)
    for (const row of rows) {
      if (row.vin && row.tracker_status) out.set(row.vin, row.tracker_status)
    }
  } catch (error) {
    console.warn('[loconav] demo_vehicle_details.tracker_status read failed; the board shows none:', error)
  }
  return out
}

// ── The board ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every LocoNav tracker in the snapshot, every link — including links whose tracker has left the account — the
 * demo fleet, and the latest changes.
 *
 * The board is not branch-scoped: an approver sees every tracker, because a tracker has no branch until it is
 * fitted to a car. What IS scoped is what they may do — `demoCars[].inScope` and `link.canUnlink` — and the POST
 * enforces the same test.
 */
export async function getTrackerBoard(actor: TrackerActor, now: Date = new Date()): Promise<TrackerBoardResponse> {
  await assertMappingTablesReady()

  const [fleet, snapshot, links, linkEvents, recentEvents, statuses, state] = await Promise.all([
    listDemoVehiclesForGatePass(),
    db
      .select({
        providerVehicleUuid: loconavProviderVehicles.providerVehicleUuid,
        vehicleNumber: loconavProviderVehicles.vehicleNumber,
        displayNumber: loconavProviderVehicles.displayNumber,
        chassisNumber: loconavProviderVehicles.chassisNumber,
        deviceSerialNumber: loconavProviderVehicles.deviceSerialNumber,
        deviceType: loconavProviderVehicles.deviceType,
        subscriptionExpiresAt: loconavProviderVehicles.subscriptionExpiresAt,
        lastFixAt: loconavProviderVehicles.lastFixAt,
        lastSeenAt: loconavProviderVehicles.lastSeenAt,
      })
      .from(loconavProviderVehicles)
      .where(eq(loconavProviderVehicles.provider, PROVIDER)),
    db
      .select({
        vin: demoVehicleTrackers.vin,
        providerVehicleUuid: demoVehicleTrackers.providerVehicleUuid,
        providerVehicleNumber: demoVehicleTrackers.providerVehicleNumber,
        deviceSerialNumber: demoVehicleTrackers.deviceSerialNumber,
        deviceType: demoVehicleTrackers.deviceType,
        subscriptionExpiresAt: demoVehicleTrackers.subscriptionExpiresAt,
        matchedBy: demoVehicleTrackers.matchedBy,
      })
      .from(demoVehicleTrackers)
      .where(eq(demoVehicleTrackers.provider, PROVIDER)),
    /*
     * Who made each link that stands today: the latest 'link' event for that VIN AND that tracker. Keyed on the
     * pair, not the VIN — a car unlinked and relinked to a different unit would otherwise be credited to whoever
     * made the old link.
     */
    db
      .selectDistinctOn([demoVehicleTrackerEvents.vin, demoVehicleTrackerEvents.providerVehicleUuid], {
        vin: demoVehicleTrackerEvents.vin,
        providerVehicleUuid: demoVehicleTrackerEvents.providerVehicleUuid,
        actorName: demoVehicleTrackerEvents.actorName,
        createdAt: demoVehicleTrackerEvents.createdAt,
      })
      .from(demoVehicleTrackerEvents)
      .where(and(eq(demoVehicleTrackerEvents.action, 'link'), eq(demoVehicleTrackerEvents.provider, PROVIDER)))
      .orderBy(
        demoVehicleTrackerEvents.vin,
        demoVehicleTrackerEvents.providerVehicleUuid,
        desc(demoVehicleTrackerEvents.createdAt),
      ),
    db
      .select({
        id: demoVehicleTrackerEvents.id,
        action: demoVehicleTrackerEvents.action,
        vin: demoVehicleTrackerEvents.vin,
        providerVehicleUuid: demoVehicleTrackerEvents.providerVehicleUuid,
        providerLabel: demoVehicleTrackerEvents.providerLabel,
        note: demoVehicleTrackerEvents.note,
        actorName: demoVehicleTrackerEvents.actorName,
        createdAt: demoVehicleTrackerEvents.createdAt,
      })
      .from(demoVehicleTrackerEvents)
      /*
       * A move writes its unlink and its link in one transaction, so both carry the same created_at. 'link' sorts before
       * 'unlink', which lists the car the tracker went to above the car it left — the order it happened in.
       */
      .orderBy(desc(demoVehicleTrackerEvents.createdAt), asc(demoVehicleTrackerEvents.action))
      .limit(EVENT_LIMIT),
    readTrackerStatusesOnRecord(),
    readSyncState(),
  ]).catch((error) => {
    // Re-arm the probe: if a table went away under a warm instance, the next request says which one.
    mappingTablesReady = false
    throw error
  })

  const fleetByVin = new Map(fleet.map((car) => [vinKey(car.vin), car]))
  /*
   * ⚠️ AN EMPTY FLEET IS NOT EVIDENCE THAT EVERY CAR WAS SOLD. listDemoVehiclesForGatePass answers [] when the DMS
   * feed table is missing or has lost its columns, and flagging every link as "not in the demo fleet" would
   * invite someone to unlink the lot. While the fleet is unreadable no link is flagged; the sync records the
   * same condition as a named warning and polls nothing.
   */
  const fleetKnown = fleetByVin.size > 0

  /*
   * One read for every link whose car is outside the fleet. Advisory on the board, like the tracker status: a failed
   * read leaves those branches unknown — the all-branch rule the POST would apply — instead of taking the board down.
   */
  const outOfFleet = await outOfFleetBranches(links.map((l) => l.vin), fleetByVin).catch((error) => {
    console.warn('[loconav] branch read for linked cars outside the demo fleet failed; the board shows them without one:', error)
    return new Map<string, string | null>()
  })

  const snapshotByUuid = new Map(snapshot.map((s) => [s.providerVehicleUuid, s]))
  const linkByUuid = new Map(links.map((l) => [l.providerVehicleUuid, l]))
  const linkedUuidByVin = new Map(links.map((l) => [vinKey(l.vin), l.providerVehicleUuid]))
  const linkedBy = new Map(linkEvents.map((e) => [`${vinKey(e.vin)}|${e.providerVehicleUuid}`, e]))
  const latestListingMs = snapshot.reduce((max, s) => Math.max(max, s.lastSeenAt.getTime()), 0)

  const suggestions = suggestTrackerLinks({
    trackers: snapshot.map((s) => ({
      providerVehicleUuid: s.providerVehicleUuid,
      labels: [s.vehicleNumber, s.displayNumber, s.chassisNumber],
    })),
    demoCars: fleet.map((car) => ({ vin: car.vin, registrationNumber: car.registrationNumber, model: car.model })),
    linkedVins: new Set(linkedUuidByVin.keys()),
    linkedTrackerUuids: new Set(linkByUuid.keys()),
  })

  // Snapshot rows AND link rows: a link whose tracker is no longer listed must still be visible, and removable.
  const uuids = new Set([...snapshotByUuid.keys(), ...linkByUuid.keys()])

  const trackers: TrackerRow[] = [...uuids].map((uuid) => {
    const listed = snapshotByUuid.get(uuid)
    const linked = linkByUuid.get(uuid)
    const subscriptionExpiresAt = listed?.subscriptionExpiresAt ?? linked?.subscriptionExpiresAt ?? null

    let link: TrackerRow['link'] = null
    if (linked) {
      const vin = vinKey(linked.vin)
      const car = fleetByVin.get(vin) ?? null
      // A sold car keeps the branch it was a demo car at, so that branch's approvers can still move or unlink its tracker.
      const dealerCode = car?.dealerCode ?? outOfFleet.get(vin) ?? null
      const matchedBy: 'chassis' | 'manual' = linked.matchedBy === 'manual' ? 'manual' : 'chassis'
      // A chassis link was made by the sync, not by a person, so it has no author to show.
      const event = matchedBy === 'manual' ? linkedBy.get(`${vin}|${uuid}`) : undefined
      link = {
        vin,
        registrationNumber: car?.registrationNumber ?? null,
        model: car?.model ?? null,
        dealerCode,
        matchedBy,
        linkedByName: event?.actorName ?? null,
        linkedAt: toIso(event?.createdAt),
        inDemoFleet: fleetKnown ? Boolean(car) : true,
        canUnlink: matchedBy === 'manual' && carInScope(actor, dealerCode),
      }
    }

    const suggested = linked ? undefined : suggestions.get(uuid)
    const suggestedCar = suggested ? fleetByVin.get(suggested.vin) : undefined

    return {
      providerVehicleUuid: uuid,
      label: listed?.displayNumber || listed?.vehicleNumber || linked?.providerVehicleNumber || 'Unnamed tracker',
      vehicleNumber: listed?.vehicleNumber ?? null,
      displayNumber: listed?.displayNumber ?? null,
      chassisNumber: listed?.chassisNumber ?? null,
      deviceType: listed?.deviceType ?? linked?.deviceType ?? null,
      deviceSerialLast4: serialLast4(listed?.deviceSerialNumber ?? linked?.deviceSerialNumber),
      subscriptionExpiresAt: toIso(subscriptionExpiresAt),
      subscriptionExpired: Boolean(subscriptionExpiresAt && subscriptionExpiresAt.getTime() < now.getTime()),
      lastFixAt: toIso(listed?.lastFixAt),
      lastSeenAt: toIso(listed?.lastSeenAt),
      onAccount: Boolean(listed && latestListingMs - listed.lastSeenAt.getTime() <= ON_ACCOUNT_WINDOW_MS),
      link,
      suggestion: suggested && suggestedCar
        ? {
            vin: suggested.vin,
            registrationNumber: suggestedCar.registrationNumber,
            model: suggestedCar.model,
            dealerCode: suggestedCar.dealerCode,
            reason: suggested.reason,
          }
        : null,
    }
  })
  trackers.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  const demoCars: DemoCarRow[] = fleet.map((car) => {
    const vin = vinKey(car.vin)
    return {
      vin,
      registrationNumber: car.registrationNumber,
      model: car.model,
      variant: car.variant,
      color: car.color,
      dealerCode: car.dealerCode,
      sharedPlate: car.sharedPlate,
      trackerStatusOnRecord: statuses.get(vin) ?? null,
      linkedTrackerUuid: linkedUuidByVin.get(vin) ?? null,
      inScope: carInScope(actor, car.dealerCode),
    }
  })

  const events: TrackerEvent[] = recentEvents.map((e) => ({
    id: e.id,
    action: e.action === 'unlink' ? 'unlink' : 'link',
    vin: e.vin,
    providerVehicleUuid: e.providerVehicleUuid,
    providerLabel: e.providerLabel,
    note: e.note,
    actorName: e.actorName,
    createdAt: e.createdAt.toISOString(),
  }))

  return { configured: state.configured, sync: state.sync, trackers, demoCars, events }
}

// ── Link / unlink ─────────────────────────────────────────────────────────────────────────────

/**
 * Link a tracker to a demo car, as confirmed by a person.
 *
 * ⚠️ NEVER MOVES A LINK. If the tracker is linked to another car, or the car to another tracker, the answer is a
 * 409 naming the other side, and the person unlinks first or uses moveTracker, which names both cars. A silent
 * move takes a position away from a car somebody may be looking for right now, with nothing on screen to say it
 * happened.
 *
 * ⚠️ ONE TRANSACTION, AND NOTHING SLOW INSIDE IT. The demo fleet is an analytics feed read, and the snapshot and
 * branch checks are validation, so they run BEFORE db.transaction — the pooler ends a transaction left idle for
 * 10 s. Inside, the current rows are read again, because two approvers can confirm different links for the same
 * car at once. Anything that still slips between that read and the INSERT hits the unique indexes on vin and
 * (provider, provider_vehicle_uuid), and that 23505 is reported as the same conflict.
 */
export async function linkTracker(input: TrackerMappingInput): Promise<TrackerMappingResult> {
  const { providerVehicleUuid, vin, note } = validateInput(input)
  await assertMappingTablesReady()

  const [[listed], fleet] = await Promise.all([
    db
      .select({
        vehicleNumber: loconavProviderVehicles.vehicleNumber,
        displayNumber: loconavProviderVehicles.displayNumber,
        deviceSerialNumber: loconavProviderVehicles.deviceSerialNumber,
        deviceType: loconavProviderVehicles.deviceType,
        subscriptionExpiresAt: loconavProviderVehicles.subscriptionExpiresAt,
        lastSeenAt: loconavProviderVehicles.lastSeenAt,
      })
      .from(loconavProviderVehicles)
      .where(and(
        eq(loconavProviderVehicles.provider, PROVIDER),
        eq(loconavProviderVehicles.providerVehicleUuid, providerVehicleUuid),
      ))
      .limit(1),
    listDemoVehiclesForGatePass(),
  ])

  if (!listed) {
    throw new TrackerMappingError('That tracker is not in the LocoNav fleet list. Sync tracking, then try again.', 404)
  }
  if (!fleet.length) {
    throw new TrackerMappingError('The demo fleet could not be read just now, so nothing can be linked. Try again in a minute.', 503)
  }
  const car = fleet.find((v) => vinKey(v.vin) === vin)
  if (!car) throw new TrackerMappingError('That VIN is not in the current demo fleet.', 404)
  if (!carInScope(input.actor, car.dealerCode)) {
    throw new TrackerMappingError('That car is not at one of your branches.', 403)
  }

  const providerLabel = listed.displayNumber || listed.vehicleNumber || null

  try {
    return await db.transaction(async (tx): Promise<TrackerMappingResult> => {
      const current = await tx
        .select({
          vin: demoVehicleTrackers.vin,
          providerVehicleUuid: demoVehicleTrackers.providerVehicleUuid,
          providerVehicleNumber: demoVehicleTrackers.providerVehicleNumber,
          matchedBy: demoVehicleTrackers.matchedBy,
        })
        .from(demoVehicleTrackers)
        .where(or(
          trackerVinIs(vin),
          and(
            eq(demoVehicleTrackers.provider, PROVIDER),
            eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
          ),
        ))

      if (current.some((r) => vinKey(r.vin) === vin && r.providerVehicleUuid === providerVehicleUuid)) {
        return { ok: true, alreadyDone: true }
      }
      const carLink = current.find((r) => vinKey(r.vin) === vin)
      if (carLink) {
        throw new TrackerMappingError(
          `This car is already linked to tracker ${carLink.providerVehicleNumber || carLink.providerVehicleUuid}` +
            (carLink.matchedBy === 'manual' ? '. Unlink it first.' : " by LocoNav's chassis number. Correct it in LocoNav first."),
          409,
        )
      }
      const trackerLink = current.find((r) => r.providerVehicleUuid === providerVehicleUuid)
      if (trackerLink) {
        throw new TrackerMappingError(
          `This tracker is already linked to VIN ${vinKey(trackerLink.vin)}. Move it from that car, or unlink it first.`,
          409,
        )
      }

      await tx.insert(demoVehicleTrackers).values({
        vin,
        provider: PROVIDER,
        providerVehicleUuid,
        // Number first, as the sync fills this column, so a manual row and a chassis row read alike.
        providerVehicleNumber: listed.vehicleNumber ?? listed.displayNumber,
        deviceSerialNumber: listed.deviceSerialNumber,
        deviceType: listed.deviceType,
        subscriptionExpiresAt: listed.subscriptionExpiresAt,
        matchedBy: 'manual',
        lastSeenAt: listed.lastSeenAt,
      })

      /*
       * ⚠️ A NEW LINK MUST NOT INHERIT A POSITION. demo_vehicle_positions is keyed on VIN alone, so a row left from
       * this car's previous tracker would be drawn as where it is now until the next sync overwrote it — or for
       * ever, if the new unit never reports.
       */
      await tx.delete(demoVehiclePositions).where(positionVinIs(vin))

      // The audit row commits with the link or not at all.
      await tx.insert(demoVehicleTrackerEvents).values({
        action: 'link',
        vin,
        provider: PROVIDER,
        providerVehicleUuid,
        providerLabel,
        matchedBy: 'manual',
        note,
        actorId: input.actor.id,
        actorName: input.actor.name,
        actorRole: input.actor.role,
      })

      return { ok: true }
    })
  } catch (error) {
    if (error instanceof TrackerMappingError) throw error
    /*
     * Two approvers confirming the SAME link at once: both reads saw no row, and the second INSERT waited for the
     * first and then hit a unique index. The link both asked for exists, so that is alreadyDone, not a conflict.
     */
    if (pgErrorCode(error) === '23505' && (await linkStands(vin, providerVehicleUuid))) return { ok: true, alreadyDone: true }
    if (pgErrorCode(error) === '23505') {
      throw new TrackerMappingError('Someone linked this car or tracker a moment ago. Refresh to see it.', 409)
    }
    throw error
  }
}

/**
 * Remove a link a person made.
 *
 * ⚠️ MANUAL LINKS ONLY. A chassis link is re-derived from LocoNav on every sync, so deleting it here would bring
 * it back within 15 minutes and look like the button did nothing. It is refused with what to do instead.
 *
 * The car's last position is removed in the same transaction, so the fleet board stops drawing the car where a
 * tracker no longer fitted to it last was. Trip history is untouched: demo_gate_pass_trips keeps what was
 * reconciled while the link stood.
 */
export async function unlinkTracker(input: TrackerMappingInput): Promise<TrackerMappingResult> {
  const { providerVehicleUuid, vin, note } = validateInput(input)
  await assertMappingTablesReady()

  const [[listed], fleet] = await Promise.all([
    db
      .select({
        vehicleNumber: loconavProviderVehicles.vehicleNumber,
        displayNumber: loconavProviderVehicles.displayNumber,
      })
      .from(loconavProviderVehicles)
      .where(and(
        eq(loconavProviderVehicles.provider, PROVIDER),
        eq(loconavProviderVehicles.providerVehicleUuid, providerVehicleUuid),
      ))
      .limit(1),
    listDemoVehiclesForGatePass(),
  ])

  // No 404 for a car outside the fleet: a sold car's link is exactly the one the sync asks someone to remove.
  const fleetByVin = new Map(fleet.map((v) => [vinKey(v.vin), v]))
  const car = fleetByVin.get(vin) ?? null
  // A sold car's branch comes from the feed, so that branch's approvers may unlink it — not only an all-branch one.
  const soldBranches = await outOfFleetBranches([vin], fleetByVin)
  if (!carInScope(input.actor, car?.dealerCode ?? soldBranches.get(vin) ?? null)) {
    // Says which refusal it is: a car with no known branch is not "at another branch" — only an all-branch approver may act.
    const knownBranch = car?.dealerCode ?? soldBranches.get(vin)
    throw !knownBranch && !fleet.length
      ? new TrackerMappingError("The demo fleet could not be read just now, so this car's branch is unknown. Try again in a minute.", 503)
      : knownBranch
        ? new TrackerMappingError('That car is not at one of your branches.', 403)
        : car
          ? new TrackerMappingError("This car's branch is not recognised, so only an approver who covers every branch can unlink it.", 403)
          : new TrackerMappingError('This car is no longer in the demo fleet and its branch is not on record, so only an approver who covers every branch can unlink it.', 403)
  }

  return db.transaction(async (tx): Promise<TrackerMappingResult> => {
    const current = await tx
      .select({
        matchedBy: demoVehicleTrackers.matchedBy,
        providerVehicleNumber: demoVehicleTrackers.providerVehicleNumber,
      })
      .from(demoVehicleTrackers)
      .where(and(
        trackerVinIs(vin),
        eq(demoVehicleTrackers.provider, PROVIDER),
        eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
      ))

    if (!current.length) return { ok: true, alreadyDone: true }
    if (current.some((r) => r.matchedBy !== 'manual')) {
      throw new TrackerMappingError(
        "LocoNav lists this car's VIN as the chassis number; correct it in LocoNav to change this link.",
        409,
      )
    }

    const removed = await tx
      .delete(demoVehicleTrackers)
      .where(and(
        trackerVinIs(vin),
        eq(demoVehicleTrackers.provider, PROVIDER),
        eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
        eq(demoVehicleTrackers.matchedBy, 'manual'),
      ))
      .returning({ id: demoVehicleTrackers.id })
    if (!removed.length) return { ok: true, alreadyDone: true }

    await tx.delete(demoVehiclePositions).where(positionVinIs(vin))

    await tx.insert(demoVehicleTrackerEvents).values({
      action: 'unlink',
      vin,
      provider: PROVIDER,
      providerVehicleUuid,
      providerLabel: listed?.displayNumber || listed?.vehicleNumber || current[0].providerVehicleNumber || null,
      matchedBy: 'manual',
      note,
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorRole: input.actor.role,
    })

    return { ok: true }
  })
}

/**
 * Move a tracker off the car it is linked to and onto another demo car — what the team does when a car is sold: the
 * unit comes off it, is fitted to a demo car, and the move is recorded here.
 *
 * ⚠️ NAMES BOTH CARS, AND STARTS ONLY FROM THE ONE THE PERSON SAW. The tracker must still be a person's link to
 * `fromVin`; a board that went stale while the dialog was open gets a 409 saying what stands, never a move off a car
 * nobody was shown. The car it goes to must be in the current demo fleet with no tracker, as for a link.
 *
 * ⚠️ ONE TRANSACTION, AND NOTHING SLOW INSIDE IT — linkTracker's rule, for the same pooler. The old link, both cars'
 * positions, the new link and both audit rows commit together or not at all. The new link is a NEW ROW, not the old
 * row with its vin changed, so its created_at is when the tracker went onto this car and a drive from before then is
 * not read as this tracker's.
 *
 * The actor must cover both cars' branches. The car it leaves may have been sold; its branch then comes from the feed.
 */
export async function moveTracker(input: TrackerMoveInput): Promise<TrackerMappingResult> {
  const { providerVehicleUuid, fromVin, toVin, note } = validateMoveInput(input)
  await assertMappingTablesReady()

  const [[listed], fleet] = await Promise.all([
    db
      .select({
        vehicleNumber: loconavProviderVehicles.vehicleNumber,
        displayNumber: loconavProviderVehicles.displayNumber,
        deviceSerialNumber: loconavProviderVehicles.deviceSerialNumber,
        deviceType: loconavProviderVehicles.deviceType,
        subscriptionExpiresAt: loconavProviderVehicles.subscriptionExpiresAt,
        lastSeenAt: loconavProviderVehicles.lastSeenAt,
      })
      .from(loconavProviderVehicles)
      .where(and(
        eq(loconavProviderVehicles.provider, PROVIDER),
        eq(loconavProviderVehicles.providerVehicleUuid, providerVehicleUuid),
      ))
      .limit(1),
    listDemoVehiclesForGatePass(),
  ])

  if (!listed) {
    throw new TrackerMappingError('That tracker is not in the LocoNav fleet list. Sync tracking, then try again.', 404)
  }
  if (!fleet.length) {
    throw new TrackerMappingError('The demo fleet could not be read just now, so nothing can be moved. Try again in a minute.', 503)
  }
  const fleetByVin = new Map(fleet.map((v) => [vinKey(v.vin), v]))
  const toCar = fleetByVin.get(toVin)
  if (!toCar) throw new TrackerMappingError('The car you chose is not in the current demo fleet.', 404)
  const fromCar = fleetByVin.get(fromVin) ?? null
  const soldBranches = await outOfFleetBranches([fromVin], fleetByVin)

  if (!carInScope(input.actor, fromCar?.dealerCode ?? soldBranches.get(fromVin) ?? null)) {
    // As unlink's refusal: a car with no known branch is not "at another branch".
    throw fromCar?.dealerCode ?? soldBranches.get(fromVin)
      ? new TrackerMappingError('The car this tracker is linked to now is not at one of your branches.', 403)
      : new TrackerMappingError(
          fromCar
            ? 'The branch of the car this tracker is linked to now is not recognised, so only an approver who covers every branch can move it.'
            : 'The car this tracker is linked to now has left the demo fleet and its branch is not on record, so only an approver who covers every branch can move it.',
          403,
        )
  }
  if (!carInScope(input.actor, toCar.dealerCode)) {
    throw new TrackerMappingError(
      toCar.dealerCode
        ? 'The car you chose is not at one of your branches.'
        : 'The car you chose has no recognised branch, so only an approver who covers every branch can move a tracker onto it.',
      403,
    )
  }

  const providerLabel = listed.displayNumber || listed.vehicleNumber || null
  const linkColumns = {
    vin: demoVehicleTrackers.vin,
    providerVehicleUuid: demoVehicleTrackers.providerVehicleUuid,
    providerVehicleNumber: demoVehicleTrackers.providerVehicleNumber,
    matchedBy: demoVehicleTrackers.matchedBy,
  }

  try {
    return await db.transaction(async (tx): Promise<TrackerMappingResult> => {
      const current = await tx
        .select(linkColumns)
        .from(demoVehicleTrackers)
        .where(or(
          trackerVinIs(toVin),
          and(
            eq(demoVehicleTrackers.provider, PROVIDER),
            eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
          ),
        ))

      const trackerLink = current.find((r) => r.providerVehicleUuid === providerVehicleUuid)
      if (isManualLinkTo(trackerLink, toVin)) return { ok: true, alreadyDone: true }
      assertMovableFrom(trackerLink, fromVin)
      const carLink = current.find((r) => vinKey(r.vin) === toVin)
      if (carLink) {
        throw new TrackerMappingError(
          `The car you chose is already linked to tracker ${carLink.providerVehicleNumber || carLink.providerVehicleUuid}` +
            (carLink.matchedBy === 'manual' ? '. Unlink that one first.' : " by LocoNav's chassis number. Correct it in LocoNav first."),
          409,
        )
      }

      // The manual filter is in the DELETE itself, as unlink's is, so a row that changed hands after the read stays.
      const removed = await tx
        .delete(demoVehicleTrackers)
        .where(and(
          trackerVinIs(fromVin),
          eq(demoVehicleTrackers.provider, PROVIDER),
          eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
          eq(demoVehicleTrackers.matchedBy, 'manual'),
        ))
        .returning({ id: demoVehicleTrackers.id })
      if (!removed.length) {
        /*
         * Someone changed this link between the read and the DELETE, which waited for them and then found nothing left
         * to remove. A new statement sees what they committed: the same move is alreadyDone, anything else is the
         * conflict it is. Nothing has been written yet, so either answer leaves no trace.
         */
        const [again] = await tx
          .select(linkColumns)
          .from(demoVehicleTrackers)
          .where(and(
            eq(demoVehicleTrackers.provider, PROVIDER),
            eq(demoVehicleTrackers.providerVehicleUuid, providerVehicleUuid),
          ))
          .limit(1)
        if (isManualLinkTo(again, toVin)) return { ok: true, alreadyDone: true }
        assertMovableFrom(again, fromVin)
        throw new TrackerMappingError('This tracker changed a moment ago. Refresh to see it.', 409)
      }

      /*
       * ⚠️ BOTH CARS LOSE THEIR POSITION. The car it left must stop being drawn where this tracker is, and the car it went
       * to must not inherit a row an earlier tracker left — demo_vehicle_positions is keyed on VIN alone.
       */
      await tx.delete(demoVehiclePositions).where(or(positionVinIs(fromVin), positionVinIs(toVin)))

      await tx.insert(demoVehicleTrackers).values({
        vin: toVin,
        provider: PROVIDER,
        providerVehicleUuid,
        // Number first, as linkTracker and the sync fill this column.
        providerVehicleNumber: listed.vehicleNumber ?? listed.displayNumber,
        deviceSerialNumber: listed.deviceSerialNumber,
        deviceType: listed.deviceType,
        subscriptionExpiresAt: listed.subscriptionExpiresAt,
        matchedBy: 'manual',
        lastSeenAt: listed.lastSeenAt,
      })

      // Two audit rows — the table records links and unlinks — so each car's own history says where the tracker went.
      const audit = {
        provider: PROVIDER,
        providerVehicleUuid,
        providerLabel: providerLabel || trackerLink.providerVehicleNumber || null,
        matchedBy: 'manual',
        note,
        actorId: input.actor.id,
        actorName: input.actor.name,
        actorRole: input.actor.role,
      }
      await tx.insert(demoVehicleTrackerEvents).values([
        { ...audit, action: 'unlink', vin: fromVin },
        { ...audit, action: 'link', vin: toVin },
      ])

      return { ok: true }
    })
  } catch (error) {
    if (error instanceof TrackerMappingError) throw error
    /*
     * The car took another tracker, or this tracker another car, after the read: the INSERT hit a unique index and the
     * whole move rolled back, so the old link still stands. The same move made by two people at once is alreadyDone.
     */
    if (pgErrorCode(error) === '23505' && (await linkStands(toVin, providerVehicleUuid, 'manual'))) {
      return { ok: true, alreadyDone: true }
    }
    if (pgErrorCode(error) === '23505') {
      throw new TrackerMappingError('Someone linked the car you chose, or this tracker, a moment ago. Refresh to see it.', 409)
    }
    throw error
  }
}
