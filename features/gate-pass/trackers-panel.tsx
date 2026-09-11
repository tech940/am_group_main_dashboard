'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  History,
  Link2,
  Loader2,
  MoveRight,
  RefreshCw,
  Satellite,
  Search,
  Unlink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { formatIndiaDate, formatIndiaDateTime, INDIA_TIME_ZONE, parseAppDate } from '@/lib/date-time'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import type { TrackerBoardResponse } from '@/lib/loconav/mappings'
import { normalisePlate } from '@/lib/loconav/matching'
import { cn } from '@/lib/utils'

/*
 * The GET /api/gate-pass/tracking/mappings response, restated here so each field can say what it means on
 * this screen. The query assigns TrackerBoardResponse to it, so a field renamed or retyped in
 * lib/loconav/mappings.ts fails tsc instead of rendering undefined. `import type` only: that module is
 * 'server-only', and a type import is erased from the bundle.
 *
 * ⚠️ It carries no coordinates, device phone numbers or full device serials, and nothing on this screen may
 * add them: the LocoNav account also holds trackers that are not on demo cars.
 */
type TrackerLink = {
  vin: string
  registrationNumber: string | null
  model: string | null
  /** For a car that has left the fleet, the branch it was last a demo car at. Null only when no record has one. */
  dealerCode: string | null
  matchedBy: 'chassis' | 'manual'
  linkedByName: string | null
  linkedAt: string | null
  /** False once the car has left the demo fleet — the sync stops polling it. */
  inDemoFleet: boolean
  /** Manual links on cars in the viewer's branches. Gates Move to another car as well as Unlink. */
  canUnlink: boolean
}

type Tracker = {
  providerVehicleUuid: string
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
  /** Listed by LocoNav in the latest sync. A link whose tracker dropped off the account still shows, with false. */
  onAccount: boolean
  link: TrackerLink | null
  suggestion: {
    vin: string
    registrationNumber: string | null
    model: string | null
    dealerCode: string | null
    reason: 'plate_and_model' | 'plate_only'
  } | null
}

type DemoCar = {
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

type TrackerBoard = {
  configured: boolean
  sync: {
    lastRunAt: string | null
    lastSuccessAt: string | null
    lastRunStatus: string | null
    /** A sentence the server wrote for a failed or skipped run — never LocoNav's or the database's own text. */
    lastRunDetail: string | null
    /** A run's warnings, one per entry. */
    warnings: string[]
    vehiclesMapped: number
    positionsUpdated: number
  }
  trackers: Tracker[]
  demoCars: DemoCar[]
  events: Array<{
    id: string
    action: 'link' | 'unlink'
    vin: string
    providerVehicleUuid: string
    providerLabel: string | null
    note: string | null
    actorName: string
    createdAt: string
  }>
}

/** The car half of a link, a suggestion or a picker row. */
type CarSide = { vin: string; registrationNumber: string | null; model: string | null; dealerCode: string | null }

/** One POST to the mappings route, as a dialog hands it over. */
type MappingWrite =
  | { action: 'link' | 'unlink'; tracker: Tracker; car: CarSide; note: string }
  | { action: 'move'; tracker: Tracker; from: CarSide; to: CarSide; note: string }

const WRITE_TEXT: Record<MappingWrite['action'], { refused: string; failed: string; fallback: string }> = {
  link: { refused: 'Not linked', failed: 'Link failed', fallback: 'Could not link the tracker.' },
  unlink: { refused: 'Not unlinked', failed: 'Unlink failed', fallback: 'Could not unlink the tracker.' },
  move: { refused: 'Not moved', failed: 'Move failed', fallback: 'Could not move the tracker.' },
}

/** A car in a toast: its plate, or its VIN when none is on record. */
const plateOrVin = (car: CarSide) => car.registrationNumber || car.vin

class BoardError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** A parked car's unit sleeps for hours; a week without a fix is a unit that has stopped reporting. */
const SILENT_AFTER_MS = 7 * DAY_MS
const SUBSCRIPTION_WARN_MS = 30 * DAY_MS
/** The automatic sync runs every 15 minutes, so an hour without a good run means it is failing, not late. */
const SYNC_STALE_MS = HOUR_MS
const NOTE_MAX = 500
/** Shared by every mounted panel, so a sync started before the panel was hidden still shows as running. */
const SYNC_MUTATION_KEY = ['gate-pass-tracking-sync']

type SyncOutcome =
  | { kind: 'cooldown'; message: string }
  | { kind: 'skipped' }
  | { kind: 'synced'; updated: number; warned: boolean; tripsFailed: boolean }

/*
 * Inline colours, not Tailwind classes — app/globals.css retints emerald/amber/rose utilities to
 * theme tokens with !important, the same reason fleet-panel.tsx keeps STATE_STYLE.
 *
 * ⚠️ Through CSS variables with a dark set: an inline colour is the one thing the dark-theme rescue net cannot reach,
 * and on the dark panel the light text colours measured about 2:1. Declared on :root and .dark rather than on the
 * panel, because the Link, Move and Unlink dialogs are portalled to <body>. ok, warn and risk reuse the dark pairs of
 * .approval-status-pill in app/globals.css; info and muted are their indigo and slate equivalents.
 */
const TONE_PALETTE = {
  ok: { light: ['#d1fae5', '#065f46'], dark: ['#052e22', '#6ee7b7'] },
  info: { light: ['#e0e7ff', '#3730a3'], dark: ['#1e1b4b', '#a5b4fc'] },
  warn: { light: ['#fef3c7', '#92400e'], dark: ['#3a2a06', '#fcd34d'] },
  risk: { light: ['#ffe4e6', '#9f1239'], dark: ['#3f0d17', '#fda4af'] },
  muted: { light: ['#f1f5f9', '#475569'], dark: ['#1e293b', '#cbd5e1'] },
} as const

type Tone = keyof typeof TONE_PALETTE

const TONES = Object.keys(TONE_PALETTE) as Tone[]
const TONE = Object.fromEntries(
  TONES.map((tone) => [tone, { bg: `var(--trk-${tone}-bg)`, fg: `var(--trk-${tone}-fg)` }]),
) as Record<Tone, { bg: string; fg: string }>
const toneVariables = (mode: 'light' | 'dark') =>
  TONES.map((tone) => `--trk-${tone}-bg:${TONE_PALETTE[tone][mode][0]};--trk-${tone}-fg:${TONE_PALETTE[tone][mode][1]};`).join('')
const TONE_CSS = `:root{${toneVariables('light')}}.dark{${toneVariables('dark')}}`

const trackerRowId = (uuid: string) => `tracker-row-${uuid}`

function focusTrackerRow(uuid: string) {
  document.getElementById(trackerRowId(uuid))?.focus()
}

const SUGGESTION_REASON: Record<NonNullable<Tracker['suggestion']>['reason'], string> = {
  plate_and_model: 'Plate and model match',
  plate_only: 'Plate matches, no model in the LocoNav label',
}

const SHORT_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: INDIA_TIME_ZONE, day: 'numeric', month: 'short' })

const vinKey = (vin: string | null | undefined) => String(vin ?? '').trim().toUpperCase()

function ageMs(value: string | null, now: number): number | null {
  const at = parseAppDate(value)
  return at ? Math.max(0, now - at.getTime()) : null
}

/** "8 h ago" — short enough for a table cell. */
function ago(value: string | null, now: number): string {
  const ms = ageMs(value, now)
  if (ms === null) return 'Never'
  if (ms < MINUTE_MS) return 'Just now'
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min ago`
  if (ms < 2 * DAY_MS) return `${Math.floor(ms / HOUR_MS)} h ago`
  return `${Math.floor(ms / DAY_MS)} days ago`
}

/** No fix at all counts as silent: a unit that has never reported is the worst case, not an unknown. */
function isSilent(lastFixAt: string | null, now: number): boolean {
  const ms = ageMs(lastFixAt, now)
  return ms === null || ms > SILENT_AFTER_MS
}

/**
 * The one rule behind the "Silent 7+ days" count AND the row's Silent pill, so the two always agree. A tracker LocoNav
 * no longer lists is neither: its row already says it has left the account.
 */
function isTrackerSilent(t: Tracker, now: number): boolean {
  return t.onAccount && isSilent(t.lastFixAt, now)
}

function branchLabel(dealerCode: string | null): string {
  return KIA_BRANCH_DEALERS.find((b) => b.dealerCode === dealerCode)?.label ?? dealerCode ?? 'No branch'
}

function carName(car: CarSide): string {
  return [car.registrationNumber || 'No plate', car.model].filter(Boolean).join(' · ')
}

function deviceText(t: Tracker): string {
  return [t.deviceType || 'Unknown device', t.deviceSerialLast4 ? `…${t.deviceSerialLast4}` : null]
    .filter(Boolean)
    .join(' · ')
}

/** LocoNav's chassis field, shown only when it says something the label does not. */
function chassisDiffers(t: Tracker): boolean {
  const chassis = normalisePlate(t.chassisNumber)
  return Boolean(chassis) && chassis !== normalisePlate(t.label) && chassis !== normalisePlate(t.vehicleNumber)
}

function linkedByText(link: TrackerLink): string {
  if (link.matchedBy === 'chassis') return 'VIN match'
  const at = parseAppDate(link.linkedAt)
  return `Linked by ${link.linkedByName || 'unknown'}${at ? `, ${SHORT_DATE.format(at)}` : ''}`
}

/**
 * Why a link is not feeding positions, or null when it is.
 *
 * ⚠️ Both are links the sync deliberately SKIPS, yet the row still reads "linked". A car that left the demo
 * fleet was most likely sold, so its tracker now follows a customer; a tracker LocoNav no longer lists has
 * nothing to poll. Without this line either one passes for a working link.
 */
function linkProblem(t: Tracker): string | null {
  if (!t.link) return null
  if (!t.link.inDemoFleet) {
    if (t.link.matchedBy !== 'manual') {
      return 'This car is no longer in the demo fleet, so it is not tracked. LocoNav lists its VIN as the chassis number — change it there.'
    }
    /*
     * The team takes the tracker off a sold car and fits it to another demo car, so Move comes first. Its branch is the
     * one it was last a demo car at; only a car with none on record falls to an approver who covers every branch.
     */
    if (t.link.canUnlink) {
      return t.onAccount
        ? 'This car is no longer in the demo fleet, so it is not tracked. If its tracker is on another demo car now, move it there; if not, unlink it.'
        : 'This car is no longer in the demo fleet, and LocoNav no longer lists its tracker. Unlink it.'
    }
    return t.link.dealerCode
      ? `This car is no longer in the demo fleet, so it is not tracked. An approver at ${branchLabel(t.link.dealerCode)} can move or unlink its tracker.`
      : 'This car is no longer in the demo fleet and its branch is not on record, so it is not tracked. Only an approver who covers every branch can move or unlink its tracker.'
  }
  if (!t.onAccount) return 'LocoNav no longer lists this tracker, so this car gets no positions.'
  return null
}

/** Rows that need a decision first: broken links, then suggestions, then the rest. */
function attentionRank(t: Tracker): number {
  if (linkProblem(t)) return 0
  if (!t.link && t.suggestion) return 1
  if (!t.link && t.onAccount) return 2
  if (t.link) return 3
  return 4
}

/**
 * GPS trackers — which LocoNav unit is fitted to which demo car.
 *
 * The only automatic link is LocoNav's chassis field equal to our VIN, and that field holds a VIN for one
 * tracker in eighteen, so nearly every link is a person confirming it here. The screen suggests; it never
 * decides. A suggestion becomes a link only when someone presses Link and confirms both sides.
 *
 * Mounted only when the page says the viewer holds gate_pass.approve, but a 403 from the route still renders
 * a reason — a blank panel reads as "no trackers".
 */
export function TrackersPanel() {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [linkFor, setLinkFor] = useState<{ tracker: Tracker; choose: boolean } | null>(null)
  const [unlinkFor, setUnlinkFor] = useState<Tracker | null>(null)
  const [unlinkNote, setUnlinkNote] = useState('')
  const [moveFor, setMoveFor] = useState<Tracker | null>(null)
  const [showUntracked, setShowUntracked] = useState(false)
  /*
   * Where keyboard focus returns when a dialog closes. The dialogs open from state, not from a DialogTrigger, so Radix
   * has no trigger to hand focus back to and dropped it on the page body — a keyboard user started again at the sidebar.
   */
  const returnFocus = useRef<{ el: HTMLElement; uuid: string } | null>(null)
  const focusRowAfterRefresh = useRef<string | null>(null)

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['gate-pass-trackers'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/tracking/mappings', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new BoardError(json.error || 'Could not load the trackers.', res.status)
      // Through the server's type, not straight to the local one: this assignment is the compile-time tie.
      const board: TrackerBoard = json as TrackerBoardResponse
      return board
    },
    // Opening the panel must show links another approver made since, not a copy from half an hour ago.
    refetchOnMount: 'always',
    /*
     * ⚠️ Only a 403 or a missing migration stops the polling — neither fixes itself in a minute. Stopping on ANY error
     * froze the board after one failed refetch: the old list stayed up, every age stopped moving, and its "may be
     * failing" warning could never appear. A failed refresh over a board already shown says so, below.
     */
    refetchInterval: (query) => {
      const failed = query.state.error instanceof BoardError ? query.state.error.status : null
      return failed === 403 || failed === 503 ? false : 60_000
    },
  })

  // Ages are measured from when the board was fetched; it refetches every minute.
  const now = dataUpdatedAt

  const carsByVin = useMemo(
    () => new Map((data?.demoCars ?? []).map((c) => [vinKey(c.vin), c])),
    [data],
  )
  const trackers = useMemo(
    () => [...(data?.trackers ?? [])].sort(
      (a, b) => attentionRank(a) - attentionRank(b) || a.label.localeCompare(b.label),
    ),
    [data],
  )
  const untrackedCars = useMemo(
    () => (data?.demoCars ?? [])
      .filter((c) => !c.linkedTrackerUuid)
      .sort(
        (a, b) =>
          Number(b.trackerStatusOnRecord === 'installed') - Number(a.trackerStatusOnRecord === 'installed') ||
          (a.registrationNumber ?? '').localeCompare(b.registrationNumber ?? ''),
      ),
    [data],
  )

  const counts = {
    linked: trackers.filter((t) => t.link).length,
    notTracked: trackers.filter((t) => linkProblem(t)).length,
    suggested: trackers.filter((t) => !t.link && t.suggestion).length,
    notLinked: trackers.filter((t) => !t.link && !t.suggestion).length,
    silent: trackers.filter((t) => isTrackerSilent(t, now)).length,
  }
  const installedOnRecord = untrackedCars.filter((c) => c.trackerStatusOnRecord === 'installed').length

  const refreshBoards = async () => {
    await queryClient.invalidateQueries({ queryKey: ['gate-pass-trackers'] })
    await queryClient.invalidateQueries({ queryKey: ['gate-pass-fleet'] })
  }

  const closeDialogs = () => {
    setLinkFor(null)
    setUnlinkFor(null)
    setUnlinkNote('')
    setMoveFor(null)
  }

  /*
   * ⚠️ Sync now's pending state lives in the QueryClient, not in this component. The panel unmounts on "Hide GPS
   * Trackers" and a sync can run for two minutes; with local state, showing the panel again offered Sync now while the
   * first run was still spending LocoNav's 20-request window. The toasts and the refresh are the mutation's own
   * options, which still run after an unmount — callbacks passed to mutate() do not.
   */
  const syncMutation = useMutation({
    mutationKey: SYNC_MUTATION_KEY,
    mutationFn: async (): Promise<SyncOutcome> => {
      const res = await fetch('/api/gate-pass/tracking/sync', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.status === 429) return { kind: 'cooldown', message: json.error || 'Try again in a minute.' }
      if (res.status === 502) {
        // The route's own sentence says whether it was the rate limit, which is not a fault, or a real failure.
        throw new Error(`${json.error || 'LocoNav sync failed.'} The positions from the last good sync are still shown.`)
      }
      if (res.status === 504) {
        throw new Error('The sync took longer than 2 minutes. It may still finish — check this panel again in a minute.')
      }
      if (!res.ok) throw new Error(json.error || 'Could not sync the trackers.')
      if (json.skipped) return { kind: 'skipped' }
      return {
        kind: 'synced',
        updated: typeof json.positionsUpdated === 'number' ? json.positionsUpdated : 0,
        warned: Array.isArray(json.errors) && json.errors.length > 0,
        // A 200 can still carry a failed check of finished drives: the positions landed, the sweep after them threw.
        tripsFailed: typeof json.trips?.error === 'string',
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'cooldown') {
        toast({ title: 'A sync ran moments ago', description: outcome.message, variant: 'warning' })
        return
      }
      if (outcome.kind === 'skipped') {
        toast({
          title: 'Tracking is not switched on',
          description: 'LOCO_AUTH_TOKEN is not set on the server, so nothing was synced.',
          variant: 'warning',
        })
        return
      }
      const { updated, warned, tripsFailed } = outcome
      toast({
        title: tripsFailed ? 'Synced, but drives were not checked' : warned ? 'Synced, with warnings' : 'Trackers synced',
        description:
          `Positions updated for ${updated} ${updated === 1 ? 'car' : 'cars'}.` +
          (tripsFailed ? ' Checking finished drives against GPS failed; the next sync tries again.' : '') +
          (warned ? ' The warnings are listed under the panel title.' : ''),
        variant: warned || tripsFailed ? 'warning' : 'success',
      })
    },
    onError: (e) => {
      toast({ title: 'Not synced', description: e instanceof Error ? e.message : 'Try again.', variant: 'error' })
    },
    /*
     * On every outcome, not only success: a failed run records itself in the sync state, and the freshness
     * line has to say so instead of still showing the previous "Synced" time.
     */
    onSettled: () => refreshBoards(),
  })
  const syncing = useIsMutating({ mutationKey: SYNC_MUTATION_KEY }) > 0

  const openLink = (el: HTMLElement, tracker: Tracker, choose: boolean) => {
    returnFocus.current = { el, uuid: tracker.providerVehicleUuid }
    setLinkFor({ tracker, choose })
  }

  const openUnlink = (el: HTMLElement, tracker: Tracker) => {
    returnFocus.current = { el, uuid: tracker.providerVehicleUuid }
    setUnlinkFor(tracker)
    setUnlinkNote('')
  }

  const openMove = (el: HTMLElement, tracker: Tracker) => {
    returnFocus.current = { el, uuid: tracker.providerVehicleUuid }
    setMoveFor(tracker)
  }

  /** Radix's onCloseAutoFocus: back to the button that opened the dialog, or to its row once that button has gone. */
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const target = returnFocus.current
    if (target?.el.isConnected) target.el.focus()
    else if (target) focusTrackerRow(target.uuid)
  }

  /*
   * After a link or unlink the refreshed board re-sorts the row and swaps its button, which drops focus on the body.
   * Once that board is on screen, focus the row — unless the person has already moved focus somewhere else.
   */
  useEffect(() => {
    const uuid = focusRowAfterRefresh.current
    if (!uuid) return
    focusRowAfterRefresh.current = null
    if (!document.activeElement || document.activeElement === document.body) focusTrackerRow(uuid)
  }, [dataUpdatedAt])

  const writeMapping = async (write: MappingWrite) => {
    const { tracker } = write
    const text = WRITE_TEXT[write.action]
    setSaving(true)
    try {
      const res = await fetch('/api/gate-pass/tracking/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: write.action,
          providerVehicleUuid: tracker.providerVehicleUuid,
          ...(write.action === 'move' ? { fromVin: write.from.vin, toVin: write.to.vin } : { vin: write.car.vin }),
          note: write.note.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409) {
        /*
         * ⚠️ The tracker or the car changed after this board loaded — someone linked it meanwhile, or it is
         * a chassis link. Never retry or quietly move the link: say what the server found, reload the board,
         * and let the person decide again on current data.
         */
        toast({
          title: text.refused,
          description: json.error || 'This tracker or car changed since the list loaded. The list has been refreshed.',
          variant: 'warning',
        })
        focusRowAfterRefresh.current = tracker.providerVehicleUuid
        closeDialogs()
        return
      }
      if (!res.ok) {
        throw new Error(json.error || text.fallback)
      }
      if (write.action === 'move') {
        toast({
          title: json.alreadyDone ? 'Already moved' : 'Tracker moved',
          description: `Tracker moved from ${plateOrVin(write.from)} to ${plateOrVin(write.to)}. Its position appears after the next sync.`,
          variant: 'success',
        })
      } else if (write.action === 'link') {
        toast({
          title: json.alreadyDone ? 'Already linked' : 'Tracker linked',
          description: `${tracker.label} is linked to ${carName(write.car)}. Its position appears after the next sync (every 15 minutes) or after Sync now.`,
          variant: 'success',
        })
      } else {
        toast({
          title: json.alreadyDone ? 'Already unlinked' : 'Tracker unlinked',
          description: `${carName(write.car)} no longer gets positions from ${tracker.label}. Past trip reports stay.`,
          variant: 'success',
        })
      }
      // The refreshed board moves this row and swaps its button; the effect above puts focus back on the row.
      focusRowAfterRefresh.current = tracker.providerVehicleUuid
      closeDialogs()
    } catch (e) {
      toast({
        title: text.failed,
        description: e instanceof Error ? e.message : 'Try again.',
        variant: 'error',
      })
    } finally {
      setSaving(false)
      await refreshBoards()
    }
  }

  const status = error instanceof BoardError ? error.status : null

  let body: ReactNode
  if (isLoading) {
    body = <StateMessage busy title="Loading trackers…" />
  } else if (status === 403) {
    body = (
      <StateMessage
        title="Only gate pass approvers can manage trackers"
        text="A link decides which car a GPS position is shown for, so it needs gate pass approval rights. Ask an admin if you should have them."
      />
    )
  } else if (status === 503) {
    body = (
      <StateMessage
        title="Tracker linking is not set up yet"
        // The route names which migration is missing — 0057 (tracking) or 0060 (linking).
        text={`${error?.message || 'A database change this screen needs has not been applied.'} Ask the developer to apply it.`}
      />
    )
  } else if (!data) {
    // A failed background refetch keeps the board it already has; only a first load that failed lands here.
    body = (
      <StateMessage
        title="The trackers did not load"
        text={error?.message}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 rounded-xl px-3 text-xs font-semibold [&_svg]:size-3.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden /> Try again
          </Button>
        }
      />
    )
  } else if (trackers.length === 0) {
    body = data.configured ? (
      <StateMessage
        title="No trackers listed yet"
        text="The list fills in after the first successful sync with LocoNav. Use Sync now, or wait for the automatic sync every 15 minutes."
      />
    ) : (
      <StateMessage
        title="LocoNav is not connected"
        text="LOCO_AUTH_TOKEN is not set on the server, so no trackers have been listed. Ask the developer to set it."
      />
    )
  } else {
    body = (
      <>
        {!data.configured ? (
          <div
            className="flex items-start gap-2 border-b border-slate-100 px-4 py-3 text-xs"
            style={{ backgroundColor: TONE.warn.bg, color: TONE.warn.fg }}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              LocoNav is not connected (LOCO_AUTH_TOKEN is not set on the server), so positions are not updating.
              The links below are kept.
            </span>
          </div>
        ) : null}

        {/* A failed refresh over a board already on screen says so — otherwise every age below reads as current. */}
        {error ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs"
            style={{ backgroundColor: TONE.warn.bg, color: TONE.warn.fg }}
            role="status"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Could not refresh the list — showing it as of {formatIndiaDateTime(new Date(dataUpdatedAt))}.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-7 gap-1 rounded-lg px-2.5 text-xs font-semibold [&_svg]:size-3.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden /> Try again
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
          <Count
            label="Linked"
            value={counts.linked}
            tone={counts.linked ? 'ok' : 'muted'}
            sub={counts.notTracked ? `${counts.notTracked} not getting positions` : undefined}
            subTone="risk"
          />
          <Count
            label="Suggested"
            value={counts.suggested}
            tone={counts.suggested ? 'info' : 'muted'}
            sub={counts.suggested ? 'Check and link' : undefined}
          />
          <Count label="Not linked" value={counts.notLinked} tone="muted" sub="No suggestion" />
          <Count
            label="Silent 7+ days"
            value={counts.silent}
            tone={counts.silent ? 'risk' : 'muted'}
            sub="No GPS fix in a week, or never"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <caption className="sr-only">LocoNav trackers and the demo cars they are linked to</caption>
            <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Tracker</th>
                <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Last GPS fix</th>
                <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Subscription</th>
                <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Demo car</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-[11px] uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trackers.map((t) => {
                const problem = linkProblem(t)
                const suggestion = t.link ? null : t.suggestion
                const suggestedCar = suggestion ? carsByVin.get(vinKey(suggestion.vin)) : undefined
                const canLinkSuggestion = Boolean(
                  suggestion && t.onAccount && suggestedCar?.inScope && !suggestedCar.linkedTrackerUuid,
                )

                return (
                  <tr key={t.providerVehicleUuid} className="align-top">
                    <td className="px-4 py-3.5">
                      {/* Focusable by script only: where focus lands when a link or unlink has moved this row. */}
                      <div
                        id={trackerRowId(t.providerVehicleUuid)}
                        tabIndex={-1}
                        className="rounded-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {t.label}
                      </div>
                      {chassisDiffers(t) ? (
                        <div className="mt-0.5 text-[11px] text-slate-400">LocoNav chassis: {t.chassisNumber}</div>
                      ) : null}
                      <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{deviceText(t)}</div>
                      {!t.onAccount && !t.link ? (
                        <div className="mt-0.5 text-[11px] text-slate-400">Not in LocoNav&apos;s latest list</div>
                      ) : null}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <FixAge lastFixAt={t.lastFixAt} silent={isTrackerSilent(t, now)} now={now} />
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <SubscriptionCell tracker={t} now={now} />
                    </td>

                    <td className="px-4 py-3.5 max-w-[320px]">
                      {t.link ? (
                        <>
                          <div className="font-mono text-[11px] font-semibold text-slate-900 break-all">{t.link.vin}</div>
                          <div className="text-[11px] text-slate-600">{carName(t.link)}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{linkedByText(t.link)}</div>
                          {problem ? (
                            <p className="mt-1.5 flex items-start gap-1 text-[11px] font-medium" style={{ color: TONE.risk.fg }}>
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                              {problem}
                            </p>
                          ) : null}
                        </>
                      ) : suggestion ? (
                        <div className="space-y-1">
                          <p className="text-[11px] text-slate-700">
                            <span className="font-semibold text-indigo-700">Suggested:</span> {carName(suggestion)} ·{' '}
                            <span className="font-mono break-all">{suggestion.vin}</span>
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {SUGGESTION_REASON[suggestion.reason]}
                            {suggestedCar && !suggestedCar.inScope ? ' · the car is in a branch you do not manage' : ''}
                          </p>
                          {canLinkSuggestion ? (
                            <Button
                              size="sm"
                              onClick={(e) => openLink(e.currentTarget, t, false)}
                              aria-label={`Link ${t.label} to ${suggestion.registrationNumber || suggestion.vin}`}
                              className="h-7 gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-700 [&_svg]:size-3"
                            >
                              <Link2 className="h-3 w-3" aria-hidden /> Link
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-slate-400">Not linked</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      {t.link ? (
                        t.link.matchedBy === 'manual' && t.link.canUnlink ? (
                          <div className="inline-flex items-center gap-1.5">
                            {/* Only a tracker LocoNav still lists: the route refuses to move one it does not, as it refuses to link one. */}
                            {t.onAccount ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => openMove(e.currentTarget, t)}
                                aria-label={`Move to another car: ${t.label}, now on ${t.link.registrationNumber || t.link.vin}`}
                                className="h-7 gap-1 rounded-lg border-slate-200 px-2.5 text-xs font-semibold text-slate-700 [&_svg]:size-3"
                              >
                                <MoveRight className="h-3 w-3" aria-hidden /> Move to another car
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => openUnlink(e.currentTarget, t)}
                              aria-label={`Unlink ${t.label} from ${t.link.registrationNumber || t.link.vin}`}
                              className="h-7 gap-1 rounded-lg border-slate-200 px-2.5 text-xs font-semibold text-slate-700 [&_svg]:size-3"
                            >
                              <Unlink className="h-3 w-3" aria-hidden /> Unlink
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {/* The link's branch is the car's last one even once it is sold, so no branch on record really is unknown — not "another branch". */}
                            {t.link.matchedBy === 'chassis' ? 'Set in LocoNav' : t.link.dealerCode ? 'Not your branch' : 'Branch unknown'}
                          </span>
                        )
                      ) : t.onAccount ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => openLink(e.currentTarget, t, true)}
                          aria-label={`Link ${t.label} to a demo car`}
                          className="h-7 gap-1 rounded-lg border-slate-200 px-2.5 text-xs font-semibold text-slate-700 [&_svg]:size-3"
                        >
                          <Link2 className="h-3 w-3" aria-hidden /> Link…
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowUntracked((v) => !v)}
            aria-expanded={showUntracked}
            aria-controls="trackers-untracked-cars"
            className="h-auto w-full justify-between whitespace-normal rounded-none px-4 py-3 text-left text-xs font-semibold text-slate-700 [&_svg]:size-3.5"
          >
            <span className="flex flex-wrap items-center gap-2">
              Demo cars without a tracker
              <span className="tabular-nums text-slate-400">{untrackedCars.length}</span>
              {installedOnRecord > 0 ? (
                <Pill tone="warn">
                  {installedOnRecord} marked as fitted in our records
                </Pill>
              ) : null}
            </span>
            {showUntracked ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          </Button>

          {showUntracked ? (
            <div id="trackers-untracked-cars" className="border-t border-slate-100">
              {untrackedCars.length === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-500">Every demo car has a tracker linked.</p>
              ) : (
                <div
                  className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                  tabIndex={0}
                  role="region"
                  aria-label="Demo cars without a tracker"
                >
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Car</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">VIN</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Branch</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Our records</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {untrackedCars.map((c) => (
                        <tr key={c.vin}>
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-slate-900">{c.registrationNumber || 'No plate'}</div>
                            <div className="text-[11px] text-slate-500">{[c.model, c.variant, c.color].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700">{c.vin}</td>
                          <td className="px-4 py-2.5 text-slate-600">{branchLabel(c.dealerCode)}</td>
                          <td className="px-4 py-2.5">
                            {/* ⚠️ The record is kept by hand and has been wrong both ways, so it is a reason to
                                go and look — never proof that a tracker is or is not fitted. */}
                            {c.trackerStatusOnRecord === 'installed' ? (
                              <Pill tone="warn">Marked as fitted — find its tracker</Pill>
                            ) : (
                              <span className="text-slate-400">
                                {c.trackerStatusOnRecord === 'not_installed' ? 'Marked as not fitted' : 'Not recorded'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 p-4">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <History className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            Recent changes
          </h3>
          {data.events.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No tracker has been linked or unlinked on this screen yet.</p>
          ) : (
            <ol className="mt-3 space-y-2.5">
              {data.events.map((e) => {
                const car = carsByVin.get(vinKey(e.vin))
                const tone = TONE[e.action === 'link' ? 'info' : 'muted']
                return (
                  <li key={e.id} className="flex items-start gap-2.5 text-xs">
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: tone.bg, color: tone.fg }}
                    >
                      {e.action === 'link' ? <Link2 className="h-3 w-3" aria-hidden /> : <Unlink className="h-3 w-3" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-slate-700">
                        <span className="font-semibold text-slate-900">{e.actorName}</span>{' '}
                        {e.action === 'link' ? 'linked' : 'unlinked'}{' '}
                        <span className="font-semibold text-slate-900">{e.providerLabel || 'a tracker'}</span>{' '}
                        {e.action === 'link' ? 'to' : 'from'}{' '}
                        {car?.registrationNumber ? `${car.registrationNumber} · ` : ''}
                        <span className="font-mono text-[11px] break-all">{e.vin}</span>
                      </p>
                      <p className="text-[11px] tabular-nums text-slate-400">{formatIndiaDateTime(e.createdAt)}</p>
                      {e.note ? <p className="mt-0.5 text-[11px] italic text-slate-500">&ldquo;{e.note}&rdquo;</p> : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </>
    )
  }

  return (
    <section aria-labelledby="gps-trackers-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <style>{TONE_CSS}</style>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Satellite className="h-4 w-4 text-slate-500" aria-hidden />
            <h2 id="gps-trackers-title" className="text-sm font-semibold text-slate-900">GPS trackers</h2>
            {data && trackers.length > 0 ? (
              <span className="text-sm tabular-nums text-slate-500">
                {trackers.length} {trackers.length === 1 ? 'tracker' : 'trackers'}
              </span>
            ) : null}
          </div>
          {data ? <SyncLine sync={data.sync} syncing={syncing} now={now} /> : null}
        </div>
        {data?.configured ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncing}
            className="h-9 gap-1.5 rounded-xl border-slate-200 px-3 text-xs font-semibold [&_svg]:size-3.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} aria-hidden />
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        ) : null}
        {/* Announced once when a sync starts; the visible line refreshes every minute and must not be read out each time. */}
        <span className="sr-only" aria-live="polite">
          {syncing ? 'Syncing with LocoNav. This can take up to 2 minutes.' : ''}
        </span>
      </div>

      {body}

      {linkFor && data ? (
        <LinkDialog
          // The tracker alone: "Choose a different car" is the same dialog, and must keep a note already typed.
          key={linkFor.tracker.providerVehicleUuid}
          tracker={linkFor.tracker}
          choose={linkFor.choose}
          demoCars={data.demoCars}
          now={now}
          saving={saving}
          onChoose={() => setLinkFor({ tracker: linkFor.tracker, choose: true })}
          onCancel={() => setLinkFor(null)}
          onConfirm={(car, note) => void writeMapping({ action: 'link', tracker: linkFor.tracker, car, note })}
          onCloseAutoFocus={restoreFocus}
        />
      ) : null}

      <Dialog
        open={Boolean(unlinkFor)}
        onOpenChange={(o) => {
          if (!o && !saving) setUnlinkFor(null)
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus} className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Unlink className="h-4 w-4" style={{ color: TONE.risk.fg }} aria-hidden />
              Unlink tracker
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {unlinkFor?.link
                ? `${carName(unlinkFor.link)} will stop getting GPS positions from ${unlinkFor.label}. Past trip reports for this car stay as they are.`
                : 'This car will stop getting GPS positions. Past trip reports stay as they are.'}
            </DialogDescription>
          </DialogHeader>

          {unlinkFor?.link ? (
            <div className="space-y-3">
              <BothSides tracker={unlinkFor} car={unlinkFor.link} now={now} />
              <p className="text-xs text-slate-500">
                New trips for this car get no GPS distance until a tracker is linked to it again.
                {/* Moving records both cars in one step; an unlink then a link leaves the new car untracked in between. */}
                {unlinkFor.onAccount ? ' If this tracker is now fitted to another demo car, use Move to another car instead.' : ''}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="tracker-unlink-note" className="text-xs font-semibold text-slate-700">
                  Reason <span className="font-normal text-slate-400">(optional)</span>
                </Label>
                <Textarea
                  id="tracker-unlink-note"
                  value={unlinkNote}
                  onChange={(e) => setUnlinkNote(e.target.value)}
                  maxLength={NOTE_MAX}
                  rows={2}
                  placeholder="e.g. Tracker taken off the car and returned"
                  className="rounded-xl text-xs"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setUnlinkFor(null)}
              disabled={saving}
              className="h-9 rounded-xl text-xs font-semibold"
            >
              Keep link
            </Button>
            <Button
              /*
               * Ghost, not the default variant: that one adds app-primary-action, whose !important gradient in
               * app/globals.css paints over bg-rose-600 — the destructive button came out in the primary colour.
               */
              variant="ghost"
              onClick={() => {
                if (unlinkFor?.link) void writeMapping({ action: 'unlink', tracker: unlinkFor, car: unlinkFor.link, note: unlinkNote })
              }}
              disabled={saving || !unlinkFor?.link}
              className="h-9 gap-1.5 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700 hover:text-white disabled:opacity-60 [&_svg]:size-3.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Unlink className="h-3.5 w-3.5" aria-hidden />}
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * How current the board is, in one line.
 *
 * ⚠️ A failed or skipped run is said out loud. Showing only the last SUCCESS would let a sync that has been
 * failing all morning read as "Synced 3 h ago" — which looks like a quiet fleet, not a broken feed.
 */
function SyncLine({ sync, syncing, now }: { sync: TrackerBoard['sync']; syncing: boolean; now: number }) {
  const lastGood = sync.lastSuccessAt
    ? `the last good sync was ${ago(sync.lastSuccessAt, now).toLowerCase()}`
    : 'no sync has succeeded yet'
  const mapped = sync.vehiclesMapped > 0
    ? ` · ${sync.vehiclesMapped} ${sync.vehiclesMapped === 1 ? 'car' : 'cars'} getting positions`
    : ''

  let text: string
  let tone: Tone | null = null
  if (syncing) {
    text = 'Syncing with LocoNav — this can take up to 2 minutes.'
  } else if (sync.lastRunStatus === 'failed') {
    text = `The last sync failed ${ago(sync.lastRunAt, now).toLowerCase()}; ${lastGood}.`
    tone = 'risk'
  } else if (sync.lastRunStatus === 'skipped') {
    text = `The last sync was skipped because LocoNav is not configured; ${lastGood}.`
    tone = 'warn'
  } else if (sync.lastRunStatus === 'unknown') {
    // lib/loconav/mappings.ts sends 'unknown' when it could not read the sync state; "Never synced" would be a guess.
    text = sync.lastRunDetail || 'The sync status could not be read just now.'
    tone = 'warn'
  } else if (!sync.lastSuccessAt) {
    text = 'Never synced.'
    tone = 'warn'
  } else if ((ageMs(sync.lastSuccessAt, now) ?? 0) > SYNC_STALE_MS) {
    text = `Last synced ${ago(sync.lastSuccessAt, now).toLowerCase()}. The automatic sync runs every 15 minutes, so it may be failing.`
    tone = 'warn'
  } else if (sync.lastRunStatus === 'ok_with_warnings') {
    text = `Synced ${ago(sync.lastSuccessAt, now).toLowerCase()}, with warnings${mapped}`
    tone = 'warn'
  } else {
    text = `Synced ${ago(sync.lastSuccessAt, now).toLowerCase()}${mapped}`
  }

  /*
   * 'unknown' already shows its detail as the main line. The board sends a sentence it wrote for a failed or skipped
   * run, and a run's warnings as a list — shown whole, not clamped: the toast after Sync now points at them, and a
   * clamped line showed a phone only the counters in front of the first warning.
   */
  const detail = !syncing && (sync.lastRunStatus === 'failed' || sync.lastRunStatus === 'skipped') ? sync.lastRunDetail : null
  const warnings = !syncing && sync.lastRunStatus === 'ok_with_warnings' ? sync.warnings ?? [] : []

  return (
    <div className="mt-1 space-y-0.5">
      <p
        className={cn('text-xs tabular-nums', !tone && 'text-slate-500')}
        style={tone ? { color: TONE[tone].fg } : undefined}
        title={sync.lastRunAt ? `Last attempt ${formatIndiaDateTime(sync.lastRunAt)}` : undefined}
      >
        {text}
      </p>
      {detail ? <p className="max-w-3xl text-[11px] text-slate-400">{detail}</p> : null}
      {warnings.length > 0 ? (
        <ul className="max-w-3xl list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">
          {warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * `silent` is isTrackerSilent — the rule the "Silent 7+ days" count uses — so the pills and the count always agree,
 * including a unit that has never reported ("Never" is silent too).
 */
function FixAge({ lastFixAt, now, silent }: { lastFixAt: string | null; now: number; silent: boolean }) {
  const ms = ageMs(lastFixAt, now)
  const tone: Tone | null = silent ? 'risk' : ms !== null && ms > DAY_MS ? 'warn' : null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn('font-medium tabular-nums', !tone && 'text-slate-700')}
        style={tone ? { color: TONE[tone].fg } : undefined}
        title={formatIndiaDateTime(lastFixAt)}
      >
        {ago(lastFixAt, now)}
      </span>
      {silent ? <Pill tone="risk">Silent</Pill> : null}
    </div>
  )
}

function SubscriptionCell({ tracker, now }: { tracker: Tracker; now: number }) {
  const expires = parseAppDate(tracker.subscriptionExpiresAt)
  if (tracker.subscriptionExpired) {
    return (
      <div>
        <Pill tone="risk">Expired</Pill>
        {expires ? <div className="mt-1 text-[11px] tabular-nums text-slate-400">{formatIndiaDate(expires)}</div> : null}
      </div>
    )
  }
  if (!expires) return <span className="text-slate-400">Not known</span>
  if (expires.getTime() - now < SUBSCRIPTION_WARN_MS) {
    return <Pill tone="warn">Expires {formatIndiaDate(expires)}</Pill>
  }
  return <span className="tabular-nums text-slate-600">Until {formatIndiaDate(expires)}</span>
}

/** The tracker and the car side by side, so a link is confirmed against both halves, never one. */
function BothSides({ tracker, car, now }: { tracker: Tracker; car: CarSide | null; now: number }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
      <TrackerCard tracker={tracker} now={now} />
      <ArrowLeftRight className="hidden h-4 w-4 self-center text-slate-400 sm:block" aria-hidden />
      <ChosenCarCard heading="Demo car" car={car} />
    </div>
  )
}

/**
 * A move is confirmed against three things: the tracker, the car it comes off and the car it goes to. A car that has
 * left the fleet has no plate or model on record any more, so it is named by its VIN and the branch it was last at.
 */
function MoveSides({ tracker, from, to, now }: { tracker: Tracker; from: TrackerLink; to: CarSide | null; now: number }) {
  return (
    <div className="space-y-2">
      <TrackerCard tracker={tracker} now={now} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Linked now</p>
          <p className="mt-1 font-mono text-[11px] font-semibold text-slate-900 break-all">{from.vin}</p>
          {from.inDemoFleet ? (
            <>
              <p className="text-[11px] text-slate-600">{carName(from)}</p>
              <p className="text-[11px] text-slate-500">{branchLabel(from.dealerCode)}</p>
            </>
          ) : (
            <p className="text-[11px] text-slate-500">
              No longer in the demo fleet{from.dealerCode ? ` · last at ${branchLabel(from.dealerCode)}` : ''}
            </p>
          )}
        </div>
        <MoveRight className="hidden h-4 w-4 self-center text-slate-400 sm:block" aria-hidden />
        <ChosenCarCard heading="Move to" car={to} />
      </div>
    </div>
  )
}

function TrackerCard({ tracker, now }: { tracker: Tracker; now: number }) {
  // Exactly bg-slate-50: the dark-theme rescue net matches that token, and /60 left this card pale on a dark dialog.
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">LocoNav tracker</p>
      <p className="mt-1 font-semibold text-slate-900 break-all">{tracker.label}</p>
      {chassisDiffers(tracker) ? (
        <p className="text-[11px] text-slate-400">LocoNav chassis: {tracker.chassisNumber}</p>
      ) : null}
      <p className="text-[11px] tabular-nums text-slate-500">{deviceText(tracker)}</p>
      <p className="text-[11px] tabular-nums text-slate-500">Last GPS fix: {ago(tracker.lastFixAt, now).toLowerCase()}</p>
    </div>
  )
}

/** The car a dialog is about to link, or the prompt to choose one. */
function ChosenCarCard({ heading, car }: { heading: string; car: CarSide | null }) {
  // No rescue rule touches indigo backgrounds, so this card's dark variant takes effect.
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs dark:bg-indigo-950/40">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{heading}</p>
      {car ? (
        <>
          <p className="mt-1 font-mono text-[11px] font-semibold text-slate-900 break-all">{car.vin}</p>
          <p className="text-[11px] text-slate-600">{carName(car)}</p>
          <p className="text-[11px] text-slate-500">{branchLabel(car.dealerCode)}</p>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">Choose a car from the list below.</p>
      )}
    </div>
  )
}

/**
 * Link one tracker to one demo car.
 *
 * `choose` false confirms the suggestion; true is the searchable list. The list offers only cars in the
 * viewer's branches with no tracker — the route refuses anything else, so offering it would only produce an
 * error after the person had already decided.
 */
function LinkDialog({
  tracker,
  choose,
  demoCars,
  now,
  saving,
  onChoose,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  tracker: Tracker
  choose: boolean
  demoCars: DemoCar[]
  now: number
  saving: boolean
  onChoose: () => void
  onCancel: () => void
  onConfirm: (car: CarSide, note: string) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const suggestion = tracker.suggestion
  const suggestedVin = suggestion ? vinKey(suggestion.vin) : null
  const pickable = useMemo(() => demoCars.filter((c) => c.inScope && !c.linkedTrackerUuid), [demoCars])
  const [query, setQuery] = useState('')
  const [vin, setVin] = useState<string | null>(
    () => pickable.find((c) => vinKey(c.vin) === suggestedVin)?.vin ?? null,
  )
  const [note, setNote] = useState('')

  const shown = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    return pickable
      .filter((c) => {
        const haystack = [c.vin, c.registrationNumber, c.model, c.variant, c.color, branchLabel(c.dealerCode)]
          .join(' ')
          .toLowerCase()
        return tokens.every((token) => haystack.includes(token))
      })
      .sort(
        (a, b) =>
          Number(vinKey(b.vin) === suggestedVin) - Number(vinKey(a.vin) === suggestedVin) ||
          (a.registrationNumber ?? '').localeCompare(b.registrationNumber ?? ''),
      )
  }, [pickable, query, suggestedVin])

  const car: CarSide | null = choose ? pickable.find((c) => c.vin === vin) ?? null : suggestion

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onCancel()
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Link2 className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
            {choose ? `Link ${tracker.label} to a demo car` : 'Link tracker'}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {choose
              ? 'Only demo cars in your branches that have no tracker are listed. Check the plate on the car itself before you link.'
              : 'Check that this tracker is fitted to this car. Its position shows for the car from the next sync.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <BothSides tracker={tracker} car={car} now={now} />

          {!choose && suggestion ? (
            <p className="text-xs text-slate-500">Why suggested: {SUGGESTION_REASON[suggestion.reason].toLowerCase()}.</p>
          ) : null}

          {choose ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tracker-car-search" className="text-xs font-semibold text-slate-700">
                  Find the car
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" aria-hidden />
                  <Input
                    id="tracker-car-search"
                    // Mounted when the picker opens — including from "Choose a different car", whose button just vanished.
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="VIN, plate, model or branch"
                    className="h-9 rounded-xl pl-8 text-xs"
                  />
                </div>
              </div>

              <fieldset>
                <legend className="sr-only">Demo cars without a tracker</legend>
                {pickable.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
                    Every demo car in your branches already has a tracker.
                  </p>
                ) : shown.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
                    No car matches &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                    {shown.map((c) => {
                      const checked = c.vin === vin
                      return (
                        <label
                          key={c.vin}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 px-3 py-2.5 text-xs',
                            checked ? 'bg-indigo-50' : 'hover:bg-slate-50',
                          )}
                        >
                          <input
                            type="radio"
                            name="tracker-car"
                            value={c.vin}
                            checked={checked}
                            onChange={() => setVin(c.vin)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-[11px] font-semibold text-slate-900 break-all">{c.vin}</span>
                            <span className="block text-[11px] text-slate-600">
                              {[c.registrationNumber || 'No plate', c.model, branchLabel(c.dealerCode)].filter(Boolean).join(' · ')}
                            </span>
                            {c.sharedPlate ? (
                              <span className="block text-[11px] text-slate-400">
                                This plate is on other demo cars too — go by the VIN.
                              </span>
                            ) : null}
                          </span>
                          {vinKey(c.vin) === suggestedVin ? <Pill tone="info">Suggested</Pill> : null}
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="tracker-link-note" className="text-xs font-semibold text-slate-700">
              Note <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Textarea
              id="tracker-link-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              rows={2}
              placeholder="e.g. Checked the unit under the dashboard"
              className="rounded-xl text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 sm:gap-0">
          {!choose ? (
            <Button
              variant="ghost"
              onClick={onChoose}
              disabled={saving}
              className="h-9 rounded-xl text-xs font-semibold text-slate-600 sm:mr-auto"
            >
              Choose a different car
            </Button>
          ) : null}
          <Button variant="outline" onClick={onCancel} disabled={saving} className="h-9 rounded-xl text-xs font-semibold">
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (car) onConfirm(car, note)
            }}
            disabled={saving || !car}
            className="h-9 gap-1.5 rounded-xl bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 [&_svg]:size-3.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
            Link tracker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StateMessage({ title, text, busy, action }: { title: string; text?: string; busy?: boolean; action?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center" role={busy ? 'status' : undefined}>
      {busy ? <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-indigo-600" aria-hidden /> : null}
      <p className="text-xs font-semibold text-slate-800">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-md text-[11px] text-slate-500">{text}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

function Count({ label, value, tone, sub, subTone }: {
  label: string; value: number; tone: Tone; sub?: string; subTone?: Tone
}) {
  return (
    <div className="bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums" style={{ color: TONE[tone].fg }}>
        {value}
      </p>
      {sub ? (
        <p
          className={cn('text-[11px]', !subTone && 'text-slate-400')}
          style={subTone ? { color: TONE[subTone].fg } : undefined}
        >
          {sub}
        </p>
      ) : null}
    </div>
  )
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
      style={{ backgroundColor: TONE[tone].bg, color: TONE[tone].fg }}
    >
      {children}
    </span>
  )
}
