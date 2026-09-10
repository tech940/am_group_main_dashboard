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

export type RegisterManualVehicleInput = {
  registrationNumber: string
  model: string
  variant?: string | null
  vin?: string | null
  color?: string | null
  dealerCode?: string | null
  currentKms?: number | null
  createdByUserId?: string | null
  createdByName?: string | null
}

/**
 * Register a demo vehicle directly/manually.
 * Upserts into kia_demo_car_list and demo_vehicle_details so it immediately becomes selectable for Gate Passes.
 */
export async function registerManualDemoVehicle(input: RegisterManualVehicleInput): Promise<GatePassVehicle> {
  const regNo = input.registrationNumber.trim().toUpperCase()
  if (!regNo) throw new Error('Registration number is required.')

  const rawVin = input.vin?.trim().toUpperCase()
  const cleanReg = regNo.replace(/[^A-Z0-9]/g, '')
  const finalVin = rawVin || `DEMO-${cleanReg}-${Date.now().toString().slice(-4)}`

  const model = input.model.trim().toUpperCase()
  const variant = (input.variant?.trim() || model).toUpperCase()
  const color = input.color?.trim() || 'CLEAR WHITE'
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || 'JK402'
  const kms = input.currentKms ?? 0

  const crypto = await import('node:crypto')
  const rowHash = crypto.createHash('sha256').update(`manual-demo-car-${finalVin}-${Date.now()}`).digest('hex')

  // 1. Check/Upsert kia_demo_car_list
  const existingInFeed = await analyticsExecute<Record<string, unknown>>(sql`
    SELECT id FROM kia_demo_car_list WHERE UPPER(TRIM(vin_no::text)) = ${finalVin}
  `)

  if (existingInFeed.length > 0) {
    await analyticsExecute(sql`
      UPDATE kia_demo_car_list
      SET
        model = ${model},
        variant = ${variant},
        color = ${color},
        exterior_color_name = ${color},
        test_drive_vin = 'YES',
        billing_dealer_code = ${dealerCode},
        main_dealer = ${dealerCode},
        dealer = ${dealerCode},
        order_dealer = ${dealerCode},
        stock_status = 'Test Drive',
        uploaded_at = NOW()
      WHERE UPPER(TRIM(vin_no::text)) = ${finalVin}
    `)
  } else {
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
        ${dealerCode},
        ${dealerCode},
        ${dealerCode},
        ${dealerCode},
        'Test Drive',
        NOW()
      )
    `)
  }

  // 2. Check/Upsert demo_vehicle_details
  const existingDetails = await analyticsExecute<Record<string, unknown>>(sql`
    SELECT id FROM demo_vehicle_details WHERE UPPER(TRIM(vehicle_key::text)) = ${finalVin}
  `)

  if (existingDetails.length > 0) {
    await analyticsExecute(sql`
      UPDATE demo_vehicle_details
      SET
        registration_number = ${regNo},
        vehicle_status = 'active',
        current_reading_kms = ${String(kms)},
        updated_by = ${input.createdByUserId || null},
        updated_by_name = ${input.createdByName || null},
        updated_at = NOW()
      WHERE UPPER(TRIM(vehicle_key::text)) = ${finalVin}
    `)
  } else {
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
        ${String(kms)},
        ${input.createdByUserId || null},
        ${input.createdByName || null},
        NOW(),
        NOW()
      )
    `)
  }

  // Invalidate cache if possible
  try {
    const { invalidateCachePattern } = await import('@/lib/redis/cache-utils')
    await invalidateCachePattern('kia:demo-cars*')
  } catch {
    // Non-fatal
  }

  const resolved = await lookupByVin(finalVin)
  if (resolved) return resolved

  return {
    vin: finalVin,
    registrationNumber: regNo,
    model,
    variant,
    color,
    keyNumber: null,
    dealerCode,
    branchLabel: getKiaBranchLabel(dealerCode),
    lastKnownKms: kms,
    sharedPlate: false,
  }
}

