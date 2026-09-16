import 'server-only'

import { desc, eq } from 'drizzle-orm'
import type { AppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelBenchmarks, fuelConfigEvents, fuelIntelligenceSettings } from '@/lib/db/schema'
import { serializeAppDate } from '@/lib/date-time'
import { invalidateFuelManagementCache } from '@/lib/fuel-approvals/accountability'
import { listDemoVehiclesForGatePass } from '@/lib/gate-pass/vehicles'
import { DEFAULT_FUEL_SETTINGS, FUEL_SETTING_DESCRIPTIONS, type FuelIntelligenceSettings } from './engine'
import { readFuelBenchmarks, readFuelSettingOverrides } from './ledger-reads'
import type { FuelSettingsResponse } from './types'

/**
 * Expected mileage, tank capacity and every threshold — read and written here, audited in fuel_config_events.
 *
 * ⚠️ Changing a benchmark re-labels a fleet, so writes need canEditFuelManagement (the route checks it) and every
 * change writes the previous value to the append-only log in the SAME transaction.
 */

export class FuelSettingsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function pgCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

const BENCHMARK_ROW = {
  scope: fuelBenchmarks.scope,
  vin: fuelBenchmarks.vin,
  model: fuelBenchmarks.model,
  variant: fuelBenchmarks.variant,
  energyType: fuelBenchmarks.energyType,
  unit: fuelBenchmarks.unit,
  expectedEfficiency: fuelBenchmarks.expectedEfficiency,
  tankCapacity: fuelBenchmarks.tankCapacity,
}

const toNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function getFuelSettings(canEdit: boolean): Promise<FuelSettingsResponse> {
  const [overrides, benchmarks, fleet, changes] = await Promise.all([
    readFuelSettingOverrides(),
    readFuelBenchmarks(),
    listDemoVehiclesForGatePass().catch(() => []),
    db
      .select({
        at: fuelConfigEvents.createdAt,
        actorName: fuelConfigEvents.actorName,
        target: fuelConfigEvents.target,
        action: fuelConfigEvents.action,
        label: fuelConfigEvents.targetLabel,
      })
      .from(fuelConfigEvents)
      .orderBy(desc(fuelConfigEvents.createdAt))
      .limit(20),
  ])

  const models = new Map<string, { variants: Set<string>; cars: number }>()
  for (const car of fleet) {
    const model = String(car.model ?? '').trim()
    if (!model) continue
    const entry = models.get(model.toUpperCase()) ?? { variants: new Set<string>(), cars: 0 }
    entry.cars += 1
    if (car.variant) entry.variants.add(String(car.variant).trim())
    models.set(model.toUpperCase(), entry)
  }

  return {
    canEdit,
    settings: (Object.keys(DEFAULT_FUEL_SETTINGS) as (keyof FuelIntelligenceSettings)[]).map((key) => ({
      key,
      label: FUEL_SETTING_DESCRIPTIONS[key].label,
      unit: FUEL_SETTING_DESCRIPTIONS[key].unit,
      value: overrides[key] ?? DEFAULT_FUEL_SETTINGS[key],
      defaultValue: DEFAULT_FUEL_SETTINGS[key],
      overridden: key in overrides,
    })),
    benchmarks: benchmarks.map((b) => ({
      id: b.id,
      scope: b.scope,
      vin: b.vin ?? null,
      model: b.model ?? null,
      variant: b.variant ?? null,
      energyType: b.energyType,
      unit: b.unit,
      expectedEfficiency: b.expectedEfficiency,
      tankCapacity: b.tankCapacity,
      notes: b.notes,
      setByName: b.setByName,
      updatedAt: b.updatedAt,
    })),
    models: [...models.entries()]
      .map(([model, entry]) => ({ model, variants: [...entry.variants].sort(), cars: entry.cars }))
      .sort((a, b) => a.model.localeCompare(b.model)),
    changes: changes.map((c) => ({
      at: serializeAppDate(c.at) ?? '',
      actorName: c.actorName,
      target: c.target,
      action: c.action,
      label: c.label,
    })),
  }
}

type Actor = Pick<AppUser, 'id' | 'fullName' | 'role'>

/** Set (number) or clear (null → back to the default) each named threshold. Unknown keys are refused. */
export async function saveFuelSettings(actor: Actor, changes: Record<string, unknown>): Promise<number> {
  const keys = Object.keys(changes)
  if (!keys.length) return 0
  for (const key of keys) {
    if (!(key in DEFAULT_FUEL_SETTINGS)) throw new FuelSettingsError(`Unknown setting "${key}".`, 400)
    const value = changes[key]
    if (value !== null && (toNum(value) === null || (toNum(value) as number) < 0)) {
      throw new FuelSettingsError(`${FUEL_SETTING_DESCRIPTIONS[key as keyof FuelIntelligenceSettings].label}: enter a number of zero or more.`, 400)
    }
  }
  const current = await readFuelSettingOverrides()
  await db.transaction(async (tx) => {
    for (const key of keys) {
      const next = changes[key] === null ? null : (toNum(changes[key]) as number)
      const before = key in current ? current[key] : null
      if (next === before) continue
      if (next === null) {
        await tx.delete(fuelIntelligenceSettings).where(eq(fuelIntelligenceSettings.key, key))
      } else {
        await tx
          .insert(fuelIntelligenceSettings)
          .values({ key, value: String(next), updatedBy: actor.id, updatedByName: actor.fullName, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: fuelIntelligenceSettings.key,
            set: { value: String(next), updatedBy: actor.id, updatedByName: actor.fullName, updatedAt: new Date() },
          })
      }
      await tx.insert(fuelConfigEvents).values({
        target: 'setting',
        action: before === null ? 'create' : next === null ? 'delete' : 'update',
        targetKey: key,
        targetLabel: FUEL_SETTING_DESCRIPTIONS[key as keyof FuelIntelligenceSettings].label,
        previousValue: before === null ? null : { value: before },
        newValue: next === null ? { value: DEFAULT_FUEL_SETTINGS[key as keyof FuelIntelligenceSettings], restoredDefault: true } : { value: next },
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
      })
    }
  })
  await invalidateFuelManagementCache()
  return keys.length
}

export type BenchmarkInput = {
  id?: unknown
  scope?: unknown
  vin?: unknown
  model?: unknown
  variant?: unknown
  energyType?: unknown
  unit?: unknown
  expectedEfficiency?: unknown
  tankCapacity?: unknown
  notes?: unknown
}

const text = (value: unknown, max = 80) => {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ')
  return s ? s.slice(0, max) : null
}

/** Create or update one benchmark. The table's CHECKs and unique indexes are restated here as readable refusals. */
export async function saveFuelBenchmark(actor: Actor, input: BenchmarkInput): Promise<string> {
  const scope = String(input.scope ?? '')
  if (!['vehicle', 'model_variant', 'model'].includes(scope)) throw new FuelSettingsError('Choose whether this is for one car, a variant or a model.', 400)
  const energyType = String(input.energyType ?? '').toLowerCase()
  if (!['petrol', 'diesel', 'cng', 'ev', 'hybrid'].includes(energyType)) throw new FuelSettingsError('Choose the fuel type.', 400)
  const unit = String(input.unit ?? '')
  if (!['L', 'kg', 'kWh'].includes(unit)) throw new FuelSettingsError('Choose the unit.', 400)
  const expected = toNum(input.expectedEfficiency)
  const tank = toNum(input.tankCapacity)
  if (expected !== null && (expected <= 0 || expected > 9999)) throw new FuelSettingsError('Expected mileage must be above zero.', 400)
  if (tank !== null && (tank <= 0 || tank > 9999)) throw new FuelSettingsError('Tank capacity must be above zero.', 400)
  if (expected === null && tank === null) throw new FuelSettingsError('Enter an expected mileage, a tank capacity, or both.', 400)

  const vin = scope === 'vehicle' ? text(input.vin, 17)?.toUpperCase() ?? null : null
  const model = scope === 'vehicle' ? null : text(input.model)
  const variant = scope === 'model_variant' ? text(input.variant) : null
  if (scope === 'vehicle' && (!vin || vin.length !== 17)) throw new FuelSettingsError('Enter the car’s full 17-character VIN.', 400)
  if (scope !== 'vehicle' && !model) throw new FuelSettingsError('Choose the model.', 400)
  if (scope === 'model_variant' && !variant) throw new FuelSettingsError('Choose the variant.', 400)

  const label = [vin ?? model, variant, `${energyType} ${unit}`].filter(Boolean).join(' · ')
  const values = {
    scope,
    vin,
    model,
    variant,
    energyType,
    unit,
    expectedEfficiency: expected === null ? null : expected.toFixed(2),
    tankCapacity: tank === null ? null : tank.toFixed(2),
    notes: text(input.notes, 300),
    setBy: actor.id,
    setByName: actor.fullName,
    updatedAt: new Date(),
  }
  const id = text(input.id, 36)

  try {
    return await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select(BENCHMARK_ROW).from(fuelBenchmarks).where(eq(fuelBenchmarks.id, id)).limit(1)
        if (!before) throw new FuelSettingsError('That benchmark no longer exists.', 404)
        await tx.update(fuelBenchmarks).set(values).where(eq(fuelBenchmarks.id, id))
        await tx.insert(fuelConfigEvents).values({
          target: 'benchmark', action: 'update', targetKey: id, targetLabel: label,
          previousValue: { expectedEfficiency: before.expectedEfficiency, tankCapacity: before.tankCapacity, scope: before.scope, model: before.model, variant: before.variant, vin: before.vin },
          newValue: { expectedEfficiency: values.expectedEfficiency, tankCapacity: values.tankCapacity, scope, model, variant, vin },
          actorId: actor.id, actorName: actor.fullName, actorRole: actor.role,
        })
        return id
      }
      const [row] = await tx.insert(fuelBenchmarks).values(values).returning({ id: fuelBenchmarks.id })
      await tx.insert(fuelConfigEvents).values({
        target: 'benchmark', action: 'create', targetKey: row.id, targetLabel: label,
        previousValue: null,
        newValue: { expectedEfficiency: values.expectedEfficiency, tankCapacity: values.tankCapacity, scope, model, variant, vin },
        actorId: actor.id, actorName: actor.fullName, actorRole: actor.role,
      })
      return row.id
    })
  } catch (error) {
    if (error instanceof FuelSettingsError) throw error
    if (pgCode(error) === '23505') throw new FuelSettingsError('A benchmark for this car, variant or model and fuel already exists — edit that one.', 409)
    throw error
  } finally {
    await invalidateFuelManagementCache()
  }
}

export async function deleteFuelBenchmark(actor: Actor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select(BENCHMARK_ROW).from(fuelBenchmarks).where(eq(fuelBenchmarks.id, id)).limit(1)
    if (!before) throw new FuelSettingsError('That benchmark no longer exists.', 404)
    await tx.delete(fuelBenchmarks).where(eq(fuelBenchmarks.id, id))
    await tx.insert(fuelConfigEvents).values({
      target: 'benchmark', action: 'delete', targetKey: id,
      targetLabel: [before.vin ?? before.model, before.variant, `${before.energyType} ${before.unit}`].filter(Boolean).join(' · '),
      previousValue: { expectedEfficiency: before.expectedEfficiency, tankCapacity: before.tankCapacity, scope: before.scope, model: before.model, variant: before.variant, vin: before.vin },
      newValue: null,
      actorId: actor.id, actorName: actor.fullName, actorRole: actor.role,
    })
  })
  await invalidateFuelManagementCache()
}
