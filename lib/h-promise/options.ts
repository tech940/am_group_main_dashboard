import 'server-only'

import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { tataHPromiseOptions, tataHPromiseSettings } from '@/lib/db/schema'
import { HPromiseError, type HPromiseActor } from './access'
import { NOT_TAKEN, OPTION_KIND_LABELS, type OptionKind } from './constants'
import { INTEREST_RATE_SETTING_KEY, ratesFromSettings, type InterestRatePeriod } from './economics'
import { recordHPromiseEvent } from './events'
import { iso, ymd } from './serialize'
import { optionCreateSchema, optionUpdateSchema, rateCreateSchema } from './schemas'
import type { HpOption, HpRateRow } from './types'

/**
 * The editable name lists (staff, WhatsApp approvers, locations) and the effective-dated interest rate.
 *
 * ⚠️ A list entry has a stable VALUE (stored on vehicle rows) and a LABEL (shown). Renaming changes only the
 * label, so "DEEP PANIDTA" can be corrected on screen without rewriting a single vehicle. Deactivating hides
 * an entry from the forms; rows that already use it keep it, and an edit of such a row may keep it too.
 */

type OptionRecord = typeof tataHPromiseOptions.$inferSelect

function toOption(record: OptionRecord): HpOption {
  return {
    id: record.id,
    kind: record.kind as HpOption['kind'],
    value: record.value,
    label: record.label,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
  }
}

export async function loadOptions(): Promise<HpOption[]> {
  const rows = await db
    .select()
    .from(tataHPromiseOptions)
    .orderBy(asc(tataHPromiseOptions.kind), asc(tataHPromiseOptions.sortOrder), asc(tataHPromiseOptions.label))
  return rows.map(toOption)
}

export type MetaLists = {
  options: HpOption[]
  suggestions: { models: string[]; colours: string[]; consultants: string[] }
}

/** The name lists and the typing suggestions, in ONE round trip (the forms need both at once). */
export async function loadMetaLists(): Promise<MetaLists> {
  const rows = (await db.execute(sql`
    SELECT
      (SELECT coalesce(json_agg(json_build_object(
          'id', o.id, 'kind', o.kind, 'value', o.value, 'label', o.label,
          'sortOrder', o.sort_order, 'isActive', o.is_active
        ) ORDER BY o.kind, o.sort_order, o.label), '[]'::json)
        FROM public.tata_h_promise_options o) AS options,
      (SELECT coalesce(json_agg(model ORDER BY n DESC, model), '[]'::json) FROM (
        SELECT model, count(*) AS n FROM public.tata_h_promise_vehicles WHERE deleted_at IS NULL GROUP BY model LIMIT 300
      ) m) AS models,
      (SELECT coalesce(json_agg(colour ORDER BY n DESC, colour), '[]'::json) FROM (
        SELECT colour, count(*) AS n FROM public.tata_h_promise_vehicles
        WHERE deleted_at IS NULL AND colour IS NOT NULL GROUP BY colour LIMIT 100
      ) c) AS colours,
      (SELECT coalesce(json_agg(consultant ORDER BY n DESC, consultant), '[]'::json) FROM (
        SELECT sales_consultant AS consultant, count(*) AS n FROM public.tata_h_promise_vehicles
        WHERE deleted_at IS NULL AND sales_consultant IS NOT NULL GROUP BY sales_consultant LIMIT 200
      ) s) AS consultants
  `)) as unknown as Array<{ options: HpOption[] | null; models: string[] | null; colours: string[] | null; consultants: string[] | null }>
  const row = rows[0]
  return {
    options: (row?.options ?? []).map((option) => ({ ...option, kind: option.kind as HpOption['kind'] })),
    suggestions: {
      models: row?.models ?? [],
      colours: row?.colours ?? [],
      consultants: row?.consultants ?? [],
    },
  }
}

export function groupOptions(options: HpOption[]): Record<OptionKind, HpOption[]> {
  return {
    staff: options.filter((option) => option.kind === 'staff'),
    approver: options.filter((option) => option.kind === 'approver'),
    location: options.filter((option) => option.kind === 'location'),
  }
}

/** Upper case, single spaces: how a value is stored. */
export function optionValueFromLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Refuses a value that is not on the list. `current` is the value the record already holds: an entry that
 * has since been deactivated stays acceptable on that record.
 */
export function assertOption(
  lists: Record<OptionKind, HpOption[]>,
  kind: OptionKind,
  value: string,
  current?: string | null,
): void {
  if (current && value === current) return
  if (kind === 'approver' && value === NOT_TAKEN) return
  const match = lists[kind].find((option) => option.value === value)
  const noun = OPTION_KIND_LABELS[kind].singular.toLowerCase()
  if (!match) throw new HPromiseError(`Choose a ${noun} from the list. Ask an admin to add "${value}" in H Promise settings.`, 400)
  if (!match.isActive) throw new HPromiseError(`${match.label} is no longer offered as a ${noun}. Choose another.`, 400)
}

export async function createOption(actor: HPromiseActor, raw: unknown): Promise<HpOption> {
  const input = optionCreateSchema.parse(raw)
  const value = optionValueFromLabel(input.label)
  const label = input.label.trim().replace(/\s+/g, ' ')
  return db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`COALESCE(MAX(${tataHPromiseOptions.sortOrder}), 0) + 10` })
      .from(tataHPromiseOptions)
      .where(eq(tataHPromiseOptions.kind, input.kind))
    const inserted = await tx
      .insert(tataHPromiseOptions)
      .values({
        kind: input.kind,
        value,
        label,
        sortOrder: Number(next) || 10,
        createdBy: actor.id,
        createdByName: actor.name,
        updatedBy: actor.id,
        updatedByName: actor.name,
      })
      .onConflictDoNothing()
      .returning()
    const row = inserted[0]
    if (!row) throw new HPromiseError(`"${label}" is already on the ${OPTION_KIND_LABELS[input.kind].plural.toLowerCase()} list.`, 409)
    await recordHPromiseEvent(tx, {
      subject: 'option',
      subjectId: row.id,
      action: 'option_added',
      actor,
      changes: { kind: input.kind, value, label },
    })
    return toOption(row)
  })
}

export async function updateOption(actor: HPromiseActor, id: string, raw: unknown): Promise<HpOption> {
  const parsedId = z.string().uuid().safeParse(id)
  if (!parsedId.success) throw new HPromiseError('That list entry was not found.', 404)
  const input = optionUpdateSchema.parse(raw)
  const [current] = await db.select().from(tataHPromiseOptions).where(eq(tataHPromiseOptions.id, id)).limit(1)
  if (!current) throw new HPromiseError('That list entry was not found.', 404)

  const patch: Partial<OptionRecord> = {}
  if (input.label !== undefined) patch.label = input.label.trim().replace(/\s+/g, ' ')
  if (input.isActive !== undefined) patch.isActive = input.isActive
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as Array<keyof OptionRecord>) {
    if (patch[key] !== current[key]) changes[key] = { from: current[key], to: patch[key] }
  }
  if (Object.keys(changes).length === 0) return toOption(current)

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tataHPromiseOptions)
      .set({ ...patch, updatedBy: actor.id, updatedByName: actor.name, updatedAt: new Date() })
      .where(eq(tataHPromiseOptions.id, id))
      .returning()
    if (!row) throw new HPromiseError('That list entry was not found.', 404)
    await recordHPromiseEvent(tx, {
      subject: 'option',
      subjectId: id,
      action: 'option_updated',
      actor,
      remarks: `${current.kind}: ${current.value}`,
      changes,
    })
    return toOption(row)
  })
}

// ── Interest rate ────────────────────────────────────────────────────────────────────────────────

/*
 * ⚠️ CACHED PER SERVER INSTANCE for five minutes. Every register, detail and MIS read needs the rates, and
 * each database round trip from the app to the Seoul region costs ~250 ms (measured 2026-09-17) while the
 * rate changes perhaps once a year. A change made here clears this instance at once; other instances pick it
 * up within five minutes.
 */
const RATE_CACHE_MS = 5 * 60_000
let rateCache: { at: number; rows: HpRateRow[] } | null = null
let rateLoad: Promise<HpRateRow[]> | null = null

export function clearRateCache(): void {
  rateCache = null
  rateLoad = null
}

export async function loadRateRows(): Promise<HpRateRow[]> {
  if (rateCache && Date.now() - rateCache.at < RATE_CACHE_MS) return rateCache.rows
  if (!rateLoad) {
    rateLoad = readRateRows()
      .then((rows) => {
        rateCache = { at: Date.now(), rows }
        return rows
      })
      .finally(() => {
        rateLoad = null
      })
  }
  return rateLoad
}

async function readRateRows(): Promise<HpRateRow[]> {
  const rows = await db
    .select()
    .from(tataHPromiseSettings)
    .where(eq(tataHPromiseSettings.key, INTEREST_RATE_SETTING_KEY))
    .orderBy(desc(tataHPromiseSettings.effectiveFrom))
  const periods = ratesFromSettings(rows.map((row) => ({ key: row.key, effectiveFrom: String(row.effectiveFrom), value: row.value })))
  return rows
    .map((row) => {
      const period = periods.find((candidate) => candidate.effectiveFrom === ymd(row.effectiveFrom))
      if (!period) return null
      return {
        id: row.id,
        effectiveFrom: period.effectiveFrom,
        ratePct: period.ratePct,
        note: row.note,
        createdByName: row.createdByName,
        createdAt: iso(row.createdAt) as string,
      }
    })
    .filter((row): row is HpRateRow => row !== null)
}

export function periodsFromRateRows(rows: HpRateRow[]): InterestRatePeriod[] {
  return rows
    .map((row) => ({ effectiveFrom: row.effectiveFrom, ratePct: row.ratePct }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

/**
 * A new rate applies from its date onwards; earlier days keep the rate they had. Back-dating is allowed
 * (a bank letter often arrives late) and is recorded in the history like any other change.
 */
export async function addRate(actor: HPromiseActor, raw: unknown): Promise<HpRateRow> {
  const input = rateCreateSchema.parse(raw)
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tataHPromiseSettings)
      .values({
        key: INTEREST_RATE_SETTING_KEY,
        effectiveFrom: input.effectiveFrom,
        value: { ratePct: input.ratePct },
        note: input.note,
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .onConflictDoNothing()
      .returning()
    const row = inserted[0]
    if (!row) throw new HPromiseError('A rate already starts on that date. Pick another date.', 409)
    await recordHPromiseEvent(tx, {
      subject: 'setting',
      subjectId: row.id,
      action: 'interest_rate_added',
      actor,
      remarks: input.note,
      changes: { effectiveFrom: input.effectiveFrom, ratePct: input.ratePct },
    })
    clearRateCache()
    return {
      id: row.id,
      effectiveFrom: input.effectiveFrom,
      ratePct: input.ratePct,
      note: row.note,
      createdByName: row.createdByName,
      createdAt: iso(row.createdAt) as string,
    }
  })
}

/** Only a rate that has not started yet can be removed; a rate that applied to real days is history. */
export async function removeFutureRate(actor: HPromiseActor, id: string, todayYmd: string): Promise<void> {
  const parsedId = z.string().uuid().safeParse(id)
  if (!parsedId.success) throw new HPromiseError('That rate was not found.', 404)
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tataHPromiseSettings)
      .where(and(eq(tataHPromiseSettings.id, id), eq(tataHPromiseSettings.key, INTEREST_RATE_SETTING_KEY)))
      .limit(1)
    if (!row) throw new HPromiseError('That rate was not found.', 404)
    if (String(row.effectiveFrom) <= todayYmd) {
      throw new HPromiseError('This rate has already applied to real days, so it stays. Add a new rate from a later date instead.', 409)
    }
    const [{ count }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tataHPromiseSettings)
      .where(eq(tataHPromiseSettings.key, INTEREST_RATE_SETTING_KEY))
    if (Number(count) <= 1) throw new HPromiseError('At least one interest rate must remain.', 409)
    await tx.delete(tataHPromiseSettings).where(eq(tataHPromiseSettings.id, id))
    await recordHPromiseEvent(tx, {
      subject: 'setting',
      subjectId: id,
      action: 'interest_rate_removed',
      actor,
      changes: { effectiveFrom: String(row.effectiveFrom), value: row.value },
    })
  })
  clearRateCache()
}
