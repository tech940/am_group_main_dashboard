import 'server-only'

import { db } from '@/lib/db'
import { tataHPromiseEvents } from '@/lib/db/schema'
import type { HPromiseActor } from './access'

/**
 * The H Promise change history. Append-only in the database (triggers in 0072).
 *
 * ⚠️ `tx` is required: the history row is written inside the transaction that made the change, so a change
 * without its history row — or a history row for a change that rolled back — cannot exist.
 *
 * ⚠️ Personal values never enter the history. Phone numbers and the buyer's address are recorded as
 * `{changed: true}`; files are recorded by id. The history is readable by everyone who can open the vehicle,
 * which is wider than who may see those values.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
/** A transaction, or the plain client for a history row that stands alone (e.g. "document viewed"). */
export type Writer = Tx | typeof db

export type HPromiseEventSubject = 'vehicle' | 'booking' | 'file' | 'option' | 'setting' | 'exchange_bonus'

export type HPromiseEventInput = {
  vehicleId?: string | null
  subject?: HPromiseEventSubject
  subjectId?: string | null
  stockNo?: number | null
  regNo?: string | null
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  actor: HPromiseActor | null
  /** Used when there is no signed-in actor (the import). */
  actorName?: string
  remarks?: string | null
  changes?: Record<string, unknown>
}

export async function recordHPromiseEvent(tx: Writer, input: HPromiseEventInput): Promise<void> {
  await tx.insert(tataHPromiseEvents).values({
    vehicleId: input.vehicleId ?? null,
    subject: input.subject ?? 'vehicle',
    subjectId: input.subjectId ?? input.vehicleId ?? null,
    stockNo: input.stockNo ?? null,
    regNo: input.regNo ?? null,
    action: input.action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? input.actorName ?? 'System',
    actorRole: input.actor?.role ?? null,
    remarks: input.remarks ?? null,
    changes: input.changes ?? {},
    // The app's clock, like every other H Promise timestamp: "edited after approval" compares this with
    // purchase_decided_at / sale_decided_at, which the app sets.
    createdAt: new Date(),
  })
}

/** Fields whose VALUES must never be written to the history. */
export const PII_FIELDS = new Set(['sellerPhone', 'buyerPhone', 'buyerAddress', 'customerPhone'])

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value === undefined) return null
  // numeric columns come back as '120000.00' and are written as '120000' — compare as numbers.
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

/**
 * `{field: {from, to}}` for every listed field that actually changed, with personal fields redacted.
 * Returns an empty object when nothing changed, so callers can skip a no-op history row.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: Partial<T>,
  after: Partial<T>,
  fields: ReadonlyArray<keyof T & string>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  for (const field of fields) {
    if (!(field in after)) continue
    const from = comparable(before[field])
    const to = comparable(after[field])
    if (from === to) continue
    changes[field] = PII_FIELDS.has(field) ? { changed: true } : { from: from ?? null, to: to ?? null }
  }
  return changes
}
