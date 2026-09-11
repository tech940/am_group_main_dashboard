import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsExecute } from '@/lib/analytics/db'
import { analyticsTableColumnSet } from '@/lib/analytics/table-columns'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { normalizeKiaDealerCode, getKiaBranchLabel } from '@/lib/kia/dealer-branch'

/**
 * The demo fleet, as a gate pass needs to see it.
 *
 * ── Why this reads through the analytics provider ─────────────────────────────────────────────
 * demo_car_list is an externally-ingested DMS feed reached via lib/analytics/db.ts, a PLUGGABLE
 * provider that is Postgres today but is designed to swap to BigQuery (ANALYTICS_READ_SOURCE). The
 * gate pass tables live on the main db. A join across the two is not expressible, which is why
 * createGatePass SNAPSHOTS the vehicle onto the pass instead of holding a foreign key.
 *
 * ── ⚠️ A REGISTRATION NUMBER DOES NOT IDENTIFY A VEHICLE ──────────────────────────────────────
 * Measured on the live feed, 2026-09-04: 29 demo VINs, but only **25 distinct registration
 * numbers**. `JK02C0059TC` — a trade-certificate plate — is on **five different cars**:
 *
 *     MZBB6811VTN028205  MZBGC81BUSN004233  MZBB6814MTN028089
 *     MZBB681BUTN000242  MZBB681BUTN000451
 *
 * Demo fleets run on temporary TC plates that get recycled between vehicles. So the VIN is the key
 * everywhere, and lookupByRegistration deliberately returns a LIST — it must never auto-select on a
 * single plate match, because a plate legitimately has five cars behind it. Picking the first would
 * put the wrong car on the pass, and the guard would wave through a vehicle nobody approved.
 *
 * demo_car_list has no registration column at all (the demo-cars route probes five candidate names
 * and finds none), so the plate can only come from the app-owned demo_vehicle_details.
 */

export type GatePassVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  keyNumber: string | null
  dealerCode: string | null
  branchLabel: string
  /** Last odometer we know of. Advisory only — the guard's photographed reading is the authority. */
  lastKnownKms: number | null
  /** True when more than one demo car shares this registration number. Drives a UI warning. */
  sharedPlate: boolean
}

const DEMO_FEED_TABLE = 'kia_demo_car_list'
const DETAILS_TABLE = 'demo_vehicle_details'

type Row = {
  vin: string | null
  registration_number: string | null
  model: string | null
  variant: string | null
  color: string | null
  key_number: string | null
  billing_dealer_code: string | null
  current_reading_kms: string | number | null
  plate_share_count: string | number | null
}

function toNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapRow(row: Row): GatePassVehicle {
  const dealerCode = normalizeKiaDealerCode(row.billing_dealer_code)
  return {
    vin: String(row.vin ?? '').trim().toUpperCase(),
    registrationNumber: row.registration_number?.trim() || null,
    model: row.model?.trim() || null,
    variant: row.variant?.trim() || null,
    color: row.color?.trim() || null,
    keyNumber: row.key_number?.trim() || null,
    dealerCode,
    branchLabel: getKiaBranchLabel(dealerCode),
    lastKnownKms: toNumber(row.current_reading_kms),
    sharedPlate: (toNumber(row.plate_share_count) ?? 1) > 1,
  }
}

/**
 * The selectable demo fleet.
 *
 * ⚠️ Excludes cars marked sold. Two of the 29 carry vehicle_status='sold' — raising a gate pass
 * against one would be a pass for a car that has permanently left. The test is
 * `IS DISTINCT FROM 'sold'` rather than `= 'active'` because two more rows have a NULL status, and
 * an unknown status means "we have not recorded one", not "this car is gone".
 *
 * Column presence is probed rather than assumed: a bare SELECT of a column the DMS stopped
 * exporting fails the whole query with Postgres 42703 and takes the section down — which is exactly
 * what happened to the approvals list before lib/approvals/request-number.ts started probing.
 */
export async function listDemoVehiclesForGatePass(dealerCode?: string | null): Promise<GatePassVehicle[]> {
  if (!(await analyticsTableExists(DEMO_FEED_TABLE))) return []

  const feedColumns = await analyticsTableColumnSet(DEMO_FEED_TABLE)
  if (!feedColumns.has('test_drive_vin') || !feedColumns.has('vin_no')) return []
  const hasDetails = await analyticsTableExists(DETAILS_TABLE)

  const col = (name: string) =>
    feedColumns.has(name) ? sql`NULLIF(TRIM(${sql.raw(name)}::text), '')` : sql`NULL::text`

  // The feed is a cumulative snapshot — the same VIN reappears on every upload — so collapse to the
  // newest row per VIN before anything else, the way the demo-cars list does.
  const uploadedAt = feedColumns.has('uploaded_at') ? sql`uploaded_at` : sql`NULL::timestamptz`
  const dealerFilter = dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(billing_dealer_code::text, ''))) = ${String(dealerCode).toUpperCase()}`
    : sql``

  const detailsJoin = hasDetails
    ? sql`
      LEFT JOIN (
        SELECT vehicle_key,
               NULLIF(TRIM(registration_number), '') AS registration_number,
               current_reading_kms,
               vehicle_status
        FROM demo_vehicle_details
      ) d ON d.vehicle_key = v.vehicle_key`
    : sql`LEFT JOIN (SELECT NULL::text AS vehicle_key, NULL::text AS registration_number,
                           NULL::numeric AS current_reading_kms, NULL::text AS vehicle_status) d
            ON d.vehicle_key = v.vehicle_key`

  const rows = await analyticsExecute<Row>(sql`
    WITH raw AS (
      SELECT
        UPPER(TRIM(vin_no::text)) AS vehicle_key,
        ${col('model')} AS model,
        ${col('variant')} AS variant,
        COALESCE(${col('exterior_color_name')}, ${col('color')}) AS color,
        ${col('key_number')} AS key_number,
        ${col('billing_dealer_code')} AS billing_dealer_code,
        ${uploadedAt} AS uploaded_at
      FROM ${sql.raw(DEMO_FEED_TABLE)}
      WHERE UPPER(TRIM(test_drive_vin::text)) = 'YES'
        AND NULLIF(TRIM(vin_no::text), '') IS NOT NULL
        ${dealerFilter}
    ),
    v AS (
      SELECT DISTINCT ON (vehicle_key) * FROM raw
      ORDER BY vehicle_key, uploaded_at DESC NULLS LAST
    ),
    joined AS (
      SELECT v.vehicle_key AS vin, v.model, v.variant, v.color, v.key_number,
             v.billing_dealer_code, d.registration_number, d.current_reading_kms, d.vehicle_status
      FROM v
      ${detailsJoin}
    )
    SELECT
      vin, model, variant, color, key_number, billing_dealer_code,
      registration_number, current_reading_kms,
      COUNT(*) FILTER (WHERE registration_number IS NOT NULL)
        OVER (PARTITION BY UPPER(TRIM(registration_number))) AS plate_share_count
    FROM joined
    WHERE COALESCE(vehicle_status, '') IS DISTINCT FROM 'sold'
    ORDER BY model NULLS LAST, registration_number NULLS LAST, vin
  `)

  return rows.map(mapRow)
}

/** One vehicle by VIN — the identity path, and the only one that may return a single row. */
export async function lookupByVin(vin: string): Promise<GatePassVehicle | null> {
  const key = String(vin ?? '').trim().toUpperCase()
  if (!key) return null
  const all = await listDemoVehiclesForGatePass()
  return all.find((v) => v.vin === key) ?? null
}

/** Search or lookup vehicles by registration number */
export async function lookupByRegistration(registrationNumber: string): Promise<GatePassVehicle[]> {
  const q = registrationNumber.trim().toLowerCase().replace(/[\s\-_]/g, '')
  if (!q) return []
  const all = await listDemoVehiclesForGatePass()
  return all.filter((v) => (v.registrationNumber || '').toLowerCase().replace(/[\s\-_]/g, '').includes(q))
}

/**
 * The branch each VIN is recorded at: the normalised dealer code on its NEWEST kia_demo_car_list row, keyed by
 * upper-trimmed VIN. Every VIN asked for comes back as a key — null when the feed has no row for it, its code is not a
 * KIA branch, or the feed or its columns are missing.
 *
 * ⚠️ Not listDemoVehiclesForGatePass, which drops sold cars and cars no longer flagged test_drive_vin. A car sold today
 * was still at its branch for every drive it made before, so this reads the feed with no flag filter at all.
 *
 * One query for every VIN. A failed read throws: an unreadable feed is not "no branch".
 */
export async function lookupDemoCarBranchesByVin(vins: string[]): Promise<Map<string, string | null>> {
  const keys = [...new Set(vins.map((vin) => String(vin ?? '').trim().toUpperCase()).filter(Boolean))]
  const branches = new Map<string, string | null>(keys.map((key) => [key, null]))
  if (!keys.length || !(await analyticsTableExists(DEMO_FEED_TABLE))) return branches

  const feedColumns = await analyticsTableColumnSet(DEMO_FEED_TABLE)
  if (!feedColumns.has('vin_no') || !feedColumns.has('billing_dealer_code')) return branches
  const uploadedAt = feedColumns.has('uploaded_at') ? sql`uploaded_at` : sql`NULL::timestamptz`

  const rows = await analyticsExecute<{ vin: string | null; billing_dealer_code: string | null }>(sql`
    SELECT DISTINCT ON (vin) vin, billing_dealer_code
    FROM (
      SELECT UPPER(TRIM(vin_no::text)) AS vin,
             NULLIF(TRIM(billing_dealer_code::text), '') AS billing_dealer_code,
             ${uploadedAt} AS uploaded_at
      FROM ${sql.raw(DEMO_FEED_TABLE)}
      WHERE UPPER(TRIM(vin_no::text)) IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
    ) feed
    ORDER BY vin, uploaded_at DESC NULLS LAST
  `)

  for (const row of rows) {
    const key = String(row.vin ?? '').trim().toUpperCase()
    if (branches.has(key)) branches.set(key, normalizeKiaDealerCode(row.billing_dealer_code))
  }
  return branches
}

// ── Adding a vehicle from the gate pass form ──────────────────────────────────────────────────

export type RegisterManualVehicleInput = {
  registrationNumber: string
  model: string
  variant?: string | null
  vin?: string | null
  color?: string | null
  dealerCode?: string | null
  /** Null or absent when the request carried no reading — which leaves a recorded one alone. */
  currentKms?: number | null
  createdByUserId?: string | null
  createdByName?: string | null
  scope: ManualVehicleScope
}

/**
 * What the caller may reach, resolved by the route from lib/gate-pass/access.ts and passed in.
 *
 * Passed rather than imported: the sync, the fuel reconciliation and the fleet board all import this module, and
 * access.ts brings the auth and permission stack with it.
 */
export type ManualVehicleScope = {
  /** isDealerInScope(appUser, code) */
  inScope: (dealerCode: string) => boolean
  /** canSeeAllGatePassDealers(appUser) */
  seesEveryBranch: boolean
  /** visibleDealerCodes(appUser) */
  visibleDealerCodes: string[]
  /** checkGatePassPermission(appUser, 'gate_pass.approve'). Asked only when a recorded plate would change. */
  canOverwritePlate: () => Promise<boolean>
}

export type ManualVehicleResult = {
  vehicle: GatePassVehicle
  /** The VIN was already in the demo car feed, so its model, colour and branch are the recorded ones, not the request's. */
  existing: boolean
  /** The request carried a different plate and the caller may not replace a recorded one, so the recorded plate stands. */
  plateKept: boolean
}

/** A refusal carrying the status the route answers with. Its own class: lib/gate-pass/server.ts, home of GatePassError, imports this module. */
export class DemoVehicleRegistrationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'DemoVehicleRegistrationError'
  }
}

/** What is on record for a VIN, read before anything is written. */
type RecordedDemoCar = {
  inFeed: boolean
  /** The newest feed row's billing_dealer_code, upper-trimmed. Null when blank, or when the VIN is not in the feed. */
  dealerCode: string | null
  /** That code's branch name. Null when the code is not a KIA branch. */
  branch: string | null
  testDriveCar: boolean
  hasDetails: boolean
  /** Lower-trimmed. */
  vehicleStatus: string | null
  registrationNumber: string | null
}

type ManualVehicleAsk = {
  /** Upper-trimmed. Null when the request named none. */
  dealerCode: string | null
  /** That code's branch name. Null when the code is not a KIA branch. */
  branch: string | null
  registrationNumber: string
  kms: number | null
}

type ManualVehiclePlanScope = Omit<ManualVehicleScope, 'canOverwritePlate'> & { canOverwritePlate: boolean }

type ManualVehiclePlan =
  | { ok: false; status: 400 | 403 | 409; message: string }
  | {
      ok: true
      /** The branch the car is, or will be, recorded at. */
      dealerCode: string | null
      feed: 'insert' | 'flag_test_drive' | 'none'
      details: 'insert' | 'update' | 'none'
      overwritePlate: boolean
      writeKms: boolean
      plateKept: boolean
    }

/**
 * Who may add this VIN, and what may be written for it — decided before a single write.
 *
 * ⚠️ A VIN ALREADY ON RECORD IS SOMEBODY'S CAR. The form needs only gate_pass.create, which every employee holds, and it
 * used to rewrite a recorded car's dealer columns (to JK402 by default), model, colour, plate and odometer, and flip a
 * sold car back to active — which also put the car back in reach of the Trackers screen's branch check. So for a VIN
 * on record: the caller must cover the branch it is RECORDED at, not the one the request names; a sold car and a
 * different branch are refused; only an approver replaces a recorded plate. The DMS columns are never written.
 *
 * Pure — it uses nothing from this module's scope — so scripts/verify-gate-pass.ts compiles it on its own and runs it.
 */
function planManualDemoVehicle(car: RecordedDemoCar, ask: ManualVehicleAsk, scope: ManualVehiclePlanScope): ManualVehiclePlan {
  const refuse = (status: 400 | 403 | 409, message: string): ManualVehiclePlan => ({ ok: false, status, message })
  const plateKey = (plate: string | null) => String(plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

  if (car.inFeed || car.hasDetails) {
    if (car.dealerCode) {
      if (!scope.inScope(car.dealerCode)) {
        return refuse(403, `That car is at ${car.branch ?? car.dealerCode}, which is not one of your branches.`)
      }
    } else if (!scope.seesEveryBranch) {
      // isDealerInScope refuses an empty code below super admin; the Trackers screen lets an all-branch approver act.
      return refuse(403, 'That car has no branch on record, so only someone who covers every branch can add it.')
    }
    if (car.vehicleStatus === 'sold') {
      return refuse(409, 'This VIN is marked sold. Change it on the Demo Cars List.')
    }
    if (car.inFeed && ask.dealerCode && ask.dealerCode !== car.dealerCode) {
      return refuse(409, car.dealerCode
        ? `That car is recorded at ${car.branch ?? car.dealerCode}. Pick it from the vehicle list instead.`
        : 'That car has no branch on record. Pick it from the vehicle list instead.')
    }
  }

  // A feed row is about to be created, so the request chooses its branch — from the caller's own branches only.
  if (!car.inFeed) {
    if (!ask.dealerCode) return refuse(400, 'Choose the branch this car belongs to.')
    if (!ask.branch) return refuse(400, `${ask.dealerCode} is not a KIA branch. Choose one of your branches.`)
    if (!scope.visibleDealerCodes.includes(ask.dealerCode)) {
      return refuse(403, `${ask.branch} is not one of your branches.`)
    }
  }

  const recordedPlate = plateKey(car.registrationNumber)
  const platesDiffer = recordedPlate !== '' && recordedPlate !== plateKey(ask.registrationNumber)
  const overwritePlate = platesDiffer && scope.canOverwritePlate
  const writeKms = ask.kms !== null
  return {
    ok: true,
    dealerCode: car.inFeed ? car.dealerCode : ask.dealerCode,
    feed: !car.inFeed ? 'insert' : car.testDriveCar ? 'none' : 'flag_test_drive',
    details: !car.hasDetails ? 'insert' : recordedPlate === '' || overwritePlate || writeKms ? 'update' : 'none',
    overwritePlate,
    writeKms,
    plateKept: car.hasDetails && platesDiffer && !scope.canOverwritePlate,
  }
}

/**
 * What is on record for one VIN: its newest feed row — the row every other reader here takes a car's branch from — and
 * its details row. A missing table or column is a 503 that says so, not an empty record, which would read as a new VIN.
 */
async function readRecordedDemoCar(vin: string): Promise<{ car: RecordedDemoCar; feedHasUploadedAt: boolean }> {
  const [hasFeed, hasDetails] = await Promise.all([
    analyticsTableExists(DEMO_FEED_TABLE),
    analyticsTableExists(DETAILS_TABLE),
  ])
  if (!hasFeed || !hasDetails) {
    throw new DemoVehicleRegistrationError('The demo car list is not set up on this server, so a vehicle cannot be added.', 503)
  }
  const feedColumns = await analyticsTableColumnSet(DEMO_FEED_TABLE)
  if (!['vin_no', 'test_drive_vin', 'billing_dealer_code'].every((column) => feedColumns.has(column))) {
    throw new DemoVehicleRegistrationError('The demo car list is missing a column this form needs, so a vehicle cannot be added.', 503)
  }
  const feedHasUploadedAt = feedColumns.has('uploaded_at')
  const uploadedAt = feedHasUploadedAt ? sql`uploaded_at` : sql`NULL::timestamptz`

  const [[feed], [details]] = await Promise.all([
    analyticsExecute<{ billing_dealer_code: string | null; test_drive_vin: string | null }>(sql`
      SELECT NULLIF(TRIM(billing_dealer_code::text), '') AS billing_dealer_code,
             NULLIF(TRIM(test_drive_vin::text), '') AS test_drive_vin
      FROM ${sql.raw(DEMO_FEED_TABLE)}
      WHERE UPPER(TRIM(vin_no::text)) = ${vin}
      ORDER BY ${uploadedAt} DESC NULLS LAST
      LIMIT 1
    `),
    analyticsExecute<{ registration_number: string | null; vehicle_status: string | null }>(sql`
      SELECT NULLIF(TRIM(registration_number::text), '') AS registration_number,
             NULLIF(LOWER(TRIM(vehicle_status::text)), '') AS vehicle_status
      FROM ${sql.raw(DETAILS_TABLE)}
      WHERE UPPER(TRIM(vehicle_key::text)) = ${vin}
      LIMIT 1
    `),
  ])

  const dealerCode = feed?.billing_dealer_code?.trim().toUpperCase() || null
  return {
    feedHasUploadedAt,
    car: {
      inFeed: Boolean(feed),
      dealerCode,
      branch: normalizeKiaDealerCode(dealerCode) ? getKiaBranchLabel(dealerCode) : null,
      testDriveCar: String(feed?.test_drive_vin ?? '').trim().toUpperCase() === 'YES',
      hasDetails: Boolean(details),
      vehicleStatus: details?.vehicle_status?.trim().toLowerCase() || null,
      registrationNumber: details?.registration_number?.trim() || null,
    },
  }
}

/**
 * Add a demo vehicle from the gate pass form, so it can be picked for a pass straight away.
 *
 * A new VIN gets a feed row at one of the caller's branches and a details row. A VIN already on record gets at most the
 * test_drive_vin flag on its newest feed row and, on its details row, a plate where none is recorded (or a replacement,
 * from an approver) and the odometer reading the request carried. planManualDemoVehicle decides which.
 */
export async function registerManualDemoVehicle(input: RegisterManualVehicleInput): Promise<ManualVehicleResult> {
  const regNo = input.registrationNumber.trim().toUpperCase()
  if (!regNo) throw new DemoVehicleRegistrationError('Registration number is required.', 400)

  const rawVin = input.vin?.trim().toUpperCase()
  const cleanReg = regNo.replace(/[^A-Z0-9]/g, '')
  const finalVin = rawVin || `DEMO-${cleanReg}-${Date.now().toString().slice(-4)}`

  const model = input.model.trim().toUpperCase()
  const variant = (input.variant?.trim() || model).toUpperCase()
  const color = input.color?.trim() || 'CLEAR WHITE'
  const kms = typeof input.currentKms === 'number' && Number.isFinite(input.currentKms) ? input.currentKms : null
  const askedDealer = String(input.dealerCode ?? '').trim().toUpperCase() || null
  const ask: ManualVehicleAsk = {
    dealerCode: askedDealer,
    branch: normalizeKiaDealerCode(askedDealer) ? getKiaBranchLabel(askedDealer) : null,
    registrationNumber: regNo,
    kms,
  }

  const recorded = await readRecordedDemoCar(finalVin)
  const { canOverwritePlate, ...reach } = input.scope
  let plan = planManualDemoVehicle(recorded.car, ask, { ...reach, canOverwritePlate: false })
  // The approve permission is resolved only when it changes the outcome: a recorded plate the request differs from.
  if (plan.ok && plan.plateKept && (await canOverwritePlate())) {
    plan = planManualDemoVehicle(recorded.car, ask, { ...reach, canOverwritePlate: true })
  }
  if (!plan.ok) throw new DemoVehicleRegistrationError(plan.message, plan.status)

  const kmsValue = plan.writeKms ? String(kms) : null
  const actorId = input.createdByUserId || null
  const actorName = input.createdByName || null

  /*
   * ⚠️ FEED ROW FIRST. A details row with no feed row has no branch, and only an all-branch caller may add such a car —
   * so if the details write fails, the retry must find the feed row, which keeps the car in the caller's reach.
   */
  if (plan.feed === 'insert') {
    const crypto = await import('node:crypto')
    const rowHash = crypto.createHash('sha256').update(`manual-demo-car-${finalVin}-${Date.now()}`).digest('hex')
    await analyticsExecute(sql`
      INSERT INTO kia_demo_car_list (
        row_hash,
        vin_no,
        model,
        variant,
        color,
        exterior_color_name,
        test_drive_vin,
        billing_dealer_code,
        main_dealer,
        dealer,
        order_dealer,
        stock_status,
        uploaded_at
      ) VALUES (
        ${rowHash},
        ${finalVin},
        ${model},
        ${variant},
        ${color},
        ${color},
        'YES',
        ${plan.dealerCode},
        ${plan.dealerCode},
        ${plan.dealerCode},
        ${plan.dealerCode},
        'Test Drive',
        NOW()
      )
    `)
  } else if (plan.feed === 'flag_test_drive') {
    // The one column the demo list filters on, on the newest row only. The DMS owns the rest, uploaded_at included.
    const uploadedAt = recorded.feedHasUploadedAt ? sql`uploaded_at` : sql`NULL::timestamptz`
    await analyticsExecute(sql`
      UPDATE kia_demo_car_list
      SET test_drive_vin = 'YES'
      WHERE UPPER(TRIM(vin_no::text)) = ${finalVin}
        AND UPPER(TRIM(COALESCE(test_drive_vin::text, ''))) <> 'YES'
        AND ${uploadedAt} IS NOT DISTINCT FROM (
          SELECT MAX(${uploadedAt}) FROM kia_demo_car_list WHERE UPPER(TRIM(vin_no::text)) = ${finalVin}
        )
    `)
  }

  if (plan.details === 'insert') {
    await analyticsExecute(sql`
      INSERT INTO demo_vehicle_details (
        vehicle_key,
        vin,
        registration_number,
        vehicle_status,
        tracker_status,
        current_reading_kms,
        updated_by,
        updated_by_name,
        created_at,
        updated_at
      ) VALUES (
        ${finalVin},
        ${finalVin},
        ${regNo},
        'active',
        'not_installed',
        ${kmsValue}::numeric,
        ${actorId},
        ${actorName},
        NOW(),
        NOW()
      )
      ON CONFLICT (vehicle_key) DO NOTHING
    `)
  } else if (plan.details === 'update') {
    const updated = await analyticsExecute<{ vehicle_key: string }>(sql`
      UPDATE demo_vehicle_details
      SET registration_number = ${plan.overwritePlate ? sql`${regNo}` : sql`COALESCE(NULLIF(TRIM(registration_number), ''), ${regNo})`},
          current_reading_kms = ${plan.writeKms ? sql`${kmsValue}::numeric` : sql`current_reading_kms`},
          updated_by = ${actorId},
          updated_by_name = ${actorName},
          updated_at = NOW()
      WHERE UPPER(TRIM(vehicle_key::text)) = ${finalVin}
        AND LOWER(TRIM(COALESCE(vehicle_status::text, ''))) <> 'sold'
      RETURNING vehicle_key
    `)
    // Marked sold, or removed, between the read and this write — the WHERE left the row as the Demo Cars List set it.
    if (!updated.length) {
      throw new DemoVehicleRegistrationError('This car changed while you were saving. Refresh and try again.', 409)
    }
  }

  // Invalidate cache if possible
  try {
    const { invalidateCachePattern } = await import('@/lib/redis/cache-utils')
    await invalidateCachePattern('kia:demo-cars*')
  } catch {
    // Non-fatal
  }

  const existing = recorded.car.inFeed
  const resolved = await lookupByVin(finalVin)
  return {
    vehicle: resolved ?? {
      vin: finalVin,
      registrationNumber: plan.plateKept ? recorded.car.registrationNumber : regNo,
      model: existing ? null : model,
      variant: existing ? null : variant,
      color: existing ? null : color,
      keyNumber: null,
      dealerCode: plan.dealerCode,
      branchLabel: getKiaBranchLabel(plan.dealerCode),
      lastKnownKms: kms,
      sharedPlate: false,
    },
    existing,
    plateKept: plan.plateKept,
  }
}
