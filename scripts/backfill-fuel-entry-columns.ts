/**
 * Fills in the columns migration 0063 added, for the fuel records that predate it.
 *
 * Run:  npm run backfill:fuel-entry            (DRY RUN — reports, writes nothing)
 *       npm run backfill:fuel-entry -- --apply (writes)
 *
 * ── What it sets, and from what ─────────────────────────────────────────────────────────────────────
 *  - odometer_km   ← current_km_reading, parsed by the SAME parseOdometerKm the screen uses. The text
 *                    column stays exactly as typed; this is only the number read out of it.
 *  - energy_type   ← the row's own fuel_type (PETROL / DIESEL).
 *  - vehicle_vin   ← matchDemoFill, for DEMO fills only, and ONLY when the evidence names exactly one
 *                    demo car. Trade plate JK02C0059TC is worn by five cars — a fill that could be any
 *                    of them is left NULL, which simply means "no mileage from this entry".
 *  - asset_code    ← GENSET / STOCKYARD, for fills whose purpose says they never entered a vehicle.
 *
 * ── What it deliberately does NOT set ───────────────────────────────────────────────────────────────
 *  ⚠️ is_full_tank. Nobody was ever asked the question, so there is no answer to recover. Guessing "yes"
 *     would invent the basis every full-tank-to-full-tank mileage rests on, and the figures would look
 *     authoritative while being fiction. Left NULL, the engine says "Mileage unavailable" — which is the
 *     truth about records taken before the question existed.
 *  ⚠️ total_cost. No price was ever recorded on any of these rows, anywhere. There is nothing to read.
 *  ⚠️ Nothing about a request's STATUS, stage, approver or history is touched. This script never
 *     approves, un-approves or re-stages anything.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────────────────────────────
 *  - Dry run unless --apply is passed.
 *  - A column is only ever written when it is currently NULL. An existing value is never overwritten.
 *  - Energy conflicts (a matched EV recorded as PETROL) are REPORTED, never silently corrected.
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { fuelApprovals } from '../lib/db/schema'
import { indexDemoFleet, matchDemoFill, normalisePurpose, parseOdometerKm, unmatchedDemoFillMessage } from '../lib/fuel-management/metrics'
import { listDemoVehiclesForGatePass } from '../lib/gate-pass/vehicles'

const APPLY = process.argv.includes('--apply')

type Change = {
  requestNumber: string
  id: string
  vehicle: string
  purpose: string
  sets: Record<string, string | number>
  notes: string[]
}

function energyFromFuelType(fuelType: unknown): 'petrol' | 'diesel' | null {
  const text = String(fuelType ?? '').trim().toUpperCase()
  if (text === 'PETROL') return 'petrol'
  if (text === 'DIESEL') return 'diesel'
  return null
}

/**
 * Purposes whose fuel never enters a vehicle, so they get an asset code, never a VIN, and no odometer.
 *
 * ⚠️ The PURPOSE decides this, never the free-text vehicle label. An earlier version also matched the
 * label, which classified three 'STOCK TRANSFER' rows as the stockyard because someone had typed
 * "Stockyard" in the vehicle box, while four other 'STOCK TRANSFER' rows stayed unclassified — the same
 * purpose treated two different ways depending on free text. A row whose purpose says it moved stock is
 * left unclassified, which is honest: nobody recorded whether that fuel went into the yard tank or a car.
 */
function assetCodeFor(purpose: string): 'GENSET' | 'STOCKYARD' | null {
  if (purpose === 'GENSET') return 'GENSET'
  if (purpose === 'STOCK YARD') return 'STOCKYARD'
  return null
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — changes will be written.\n' : 'DRY RUN — nothing is written. Pass --apply to write.\n')

  const [rows, fleetCars] = await Promise.all([
    db
      .select({
        id: fuelApprovals.id,
        requestNumber: fuelApprovals.requestNumber,
        purpose: fuelApprovals.fuelRequiredFor,
        vehRegNo: fuelApprovals.vehRegNo,
        vinNo: fuelApprovals.vinNo,
        fuelType: fuelApprovals.fuelType,
        kmReadingText: fuelApprovals.currentKmReading,
        energyType: fuelApprovals.energyType,
        odometerKm: fuelApprovals.odometerKm,
        vehicleVin: fuelApprovals.vehicleVin,
        assetCode: fuelApprovals.assetCode,
        isFullTank: fuelApprovals.isFullTank,
        totalCost: fuelApprovals.totalCost,
      })
      .from(fuelApprovals),
    listDemoVehiclesForGatePass(),
  ])

  const fleet = indexDemoFleet(
    fleetCars.map((car) => ({
      vin: car.vin,
      registrationNumber: car.registrationNumber,
      model: car.model,
      branchLabel: car.branchLabel,
      sharedPlate: car.sharedPlate,
    })),
  )

  console.log(`${rows.length} fuel records, ${fleetCars.length} demo cars on the list.\n`)

  const changes: Change[] = []
  const unmatched: string[] = []
  const conflicts: string[] = []
  let alreadyDone = 0

  for (const row of rows) {
    const purpose = normalisePurpose(row.purpose)
    const sets: Record<string, string | number> = {}
    const notes: string[] = []

    // Decided FIRST: being an asset is what disqualifies a row from having an odometer or a VIN at all,
    // so both of the blocks below depend on it.
    const asset = assetCodeFor(purpose)
    if (asset && row.assetCode === null && row.vehicleVin === null) {
      sets.asset_code = asset
    }

    if (row.odometerKm === null) {
      const km = parseOdometerKm(row.kmReadingText)
      if (asset) {
        // ⚠️ A generator has no odometer. The live GENSET row carries "221.05" in the km box — an hour
        // meter or a litre count, but certainly not a distance. Writing it to odometer_km would record a
        // measurement that does not exist. The raw text stays in current_km_reading either way.
        if (km !== null) {
          notes.push(`${asset} has no odometer — "${String(row.kmReadingText).slice(0, 24)}" kept as text only`)
        }
      } else if (km !== null) {
        // Small readings are left alone on purpose: a new or display car genuinely reads single digits.
        sets.odometer_km = km
      } else if (String(row.kmReadingText ?? '').trim()) {
        notes.push(`odometer "${String(row.kmReadingText).slice(0, 24)}" is not a number — left empty`)
      }
    }

    if (row.energyType === null) {
      const energy = energyFromFuelType(row.fuelType)
      if (energy) sets.energy_type = energy
      else notes.push(`fuel type "${String(row.fuelType ?? '')}" is not petrol or diesel — left empty`)
    }

    // A VIN is only ever established for a DEMO fill, and never alongside an asset code.
    if (!asset && row.vehicleVin === null && purpose === 'DEMO') {
      const match = matchDemoFill({ vehRegNo: row.vehRegNo, vinNo: row.vinNo }, fleet)
      if (match.matched) {
        sets.vehicle_vin = match.vin
        const car = fleet.byVin.get(match.vin)
        const model = String(car?.model ?? '').toUpperCase()
        const energy = sets.energy_type ?? row.energyType
        // ⚠️ Reported, never corrected. An EV recorded as petrol is a data problem for a person to settle.
        if (/\bEV\b/.test(model) && (energy === 'petrol' || energy === 'diesel')) {
          conflicts.push(`${row.requestNumber}: matched ${car?.model} (an EV) but the entry says ${String(row.fuelType)}`)
        }
      } else {
        unmatched.push(`${row.requestNumber}: ${unmatchedDemoFillMessage(match)}`)
      }
    }

    if (Object.keys(sets).length === 0) {
      alreadyDone += 1
      if (notes.length) console.log(`  ${row.requestNumber}: nothing to set — ${notes.join('; ')}`)
      continue
    }

    changes.push({
      id: row.id,
      requestNumber: row.requestNumber,
      vehicle: String(row.vehRegNo ?? '').slice(0, 46),
      purpose,
      sets,
      notes,
    })
  }

  console.log(`\n── Proposed changes (${changes.length} record${changes.length === 1 ? '' : 's'}) ──`)
  for (const change of changes) {
    const fields = Object.entries(change.sets).map(([k, v]) => `${k}=${v}`).join('  ')
    console.log(`  ${change.requestNumber.padEnd(16)} ${change.purpose.padEnd(14)} ${fields}`)
    if (change.notes.length) console.log(`  ${' '.repeat(16)} ${change.notes.join('; ')}`)
  }

  if (unmatched.length) {
    console.log(`\n── DEMO fills left without a car (${unmatched.length}) — no mileage from these ──`)
    for (const line of unmatched) console.log(`  ${line}`)
  }
  if (conflicts.length) {
    console.log(`\n⚠️ Energy conflicts for a person to settle (${conflicts.length}) — NOT changed by this script:`)
    for (const line of conflicts) console.log(`  ${line}`)
  }

  const stillEmpty = rows.filter((r) => r.isFullTank === null).length
  const noCost = rows.filter((r) => r.totalCost === null).length
  console.log(`\n── Deliberately left empty ──`)
  console.log(`  is_full_tank: ${stillEmpty} record(s). Never asked, so there is no answer to recover —`)
  console.log(`                these records give no full-tank mileage, and that is the honest result.`)
  console.log(`  total_cost:   ${noCost} record(s). No price was ever recorded on any of them.`)
  console.log(`  ${alreadyDone} record(s) already had everything this script can set.`)

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply to write the ${changes.length} change(s) above.`)
    await db.$client.end()
    return
  }

  let written = 0
  for (const change of changes) {
    const payload: Record<string, unknown> = {}
    if ('odometer_km' in change.sets) payload.odometerKm = String(change.sets.odometer_km)
    if ('energy_type' in change.sets) payload.energyType = change.sets.energy_type
    if ('vehicle_vin' in change.sets) payload.vehicleVin = change.sets.vehicle_vin
    if ('asset_code' in change.sets) payload.assetCode = change.sets.asset_code
    // ⚠️ Only the columns above. Status, stage, approvers and history are never in this payload.
    await db.update(fuelApprovals).set(payload).where(eq(fuelApprovals.id, change.id))
    written += 1
  }
  console.log(`\n✅ Wrote ${written} record(s).`)
  await db.$client.end()
}

main().catch(async (error) => {
  console.error('Backfill failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
