/**
 * A stand-in for `@/lib/db`, used ONLY by scripts/verify-h-promise-flow.ts (tsconfig.hp-flow.json maps it).
 *
 * While a test is running, every `db.*` call the app code makes is sent to ONE outer transaction that the
 * test always rolls back, and `db.transaction(...)` becomes a savepoint inside it — so the app's own
 * compare-and-swap and rollback behaviour is exercised for real, and nothing it writes survives.
 *
 * ⚠️ Sequences are not transactional: stock numbers taken by the test are not returned. The flow test resets
 * the stock-number sequence to the highest real stock number when it finishes.
 */
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

function sessionUrl(): string {
  const direct = process.env.DATABASE_DIRECT_URL
  if (direct) return direct
  const pooled = process.env.DATABASE_URL
  if (!pooled) throw new Error('DATABASE_URL is not set')
  const url = new URL(pooled)
  if (url.port === '6543') url.port = '5432'
  return url.toString()
}

export const testClient = postgres(sessionUrl(), { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, connect_timeout: 20 })
const real = drizzle(testClient)

type AnyDb = typeof real
let outer: AnyDb | null = null

/** Route every app `db` call into `tx` until cleared. */
export function useOuterTransaction(tx: AnyDb | null) {
  outer = tx
}

export const db = new Proxy({} as AnyDb, {
  get(_target, prop) {
    const target = (outer ?? real) as unknown as Record<PropertyKey, unknown>
    const value = target[prop]
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
  },
})

export const realDb = real
