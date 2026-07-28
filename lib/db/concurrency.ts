/**
 * Run async DB tasks with a hard concurrency ceiling.
 *
 * Deliberately NOT `server-only`: this is a pure scheduling primitive — no db, no env, no fetch —
 * so it can be unit-tested outside Next. The callers that actually hold a connection are server-only.
 *
 * ⚠️ WHY THIS EXISTS — a production-only outage, measured 2026-07-28.
 *
 * The insurance summary route fired 15 aggregate queries in one `Promise.all`. Locally that is fine:
 * dev rewrites the connection to Supabase SESSION mode (:5432, a direct connection). Production uses
 * the TRANSACTION pooler (:6543, Supavisor), which holds a small server-side pool — measured at 6
 * server connections for this project — shared by every concurrent lambda.
 *
 * Firing more concurrent queries than that pool can serve does not merely queue; it stalls. Measured
 * against the live pooler, 15 identical GROUP BY queries over a 34 MB table:
 *
 *     concurrency 15  ->  never completed (killed at 45s)
 *     concurrency  6  ->  never completed (killed at 45s)   <- equal to pool max, still fatal
 *     concurrency  4  ->  2,457 ms
 *     concurrency  3  ->    969 ms   <- fastest
 *     concurrency  2  ->  1,497 ms
 *
 * A single one of those queries is 186 ms, so the work was never the problem — the fan-out was. The
 * symptom was exactly what an unbounded fan-out looks like from a browser: the request hangs
 * forever, and once one brand's request has taken the connections, the next brand never loads.
 *
 * DEFAULT IS 3, not the pool max. Saturating every connection in the pool leaves nothing for the
 * auth lookup that runs on the same request, and a route is never the only thing using the pool.
 */

const DEFAULT_DB_CONCURRENCY = 3

/**
 * Like `Promise.all(tasks.map(fn))`, but never more than `limit` in flight.
 *
 * Results keep input order. A rejecting task rejects the whole call, matching Promise.all — callers
 * that need partial success should catch inside their own task.
 */
export async function mapWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number = DEFAULT_DB_CONCURRENCY,
): Promise<T[]> {
  if (tasks.length === 0) return []
  const ceiling = Math.max(1, Math.min(limit, tasks.length))
  const results = new Array<T>(tasks.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: ceiling }, async () => {
      while (cursor < tasks.length) {
        const index = cursor++
        results[index] = await tasks[index]()
      }
    }),
  )

  return results
}

/**
 * A gate that admits at most `limit` tasks at once.
 *
 * Preferred over mapWithConcurrency when the call site is a `Promise.all` whose RESULT IS
 * DESTRUCTURED — wrapping each element keeps Promise.all's tuple typing intact, so a 15-way
 * destructure still type-checks element by element:
 *
 *     const gate = createDbGate()
 *     const [kpis, trend, ...] = await Promise.all([
 *       gate(() => db.execute(...)),
 *       gate(() => db.execute(...)),
 *     ])
 *
 * Every task is still *started* immediately from Promise.all's point of view; the gate is what
 * decides when each one is allowed to touch the connection pool.
 */
export function createDbGate(limit: number = DEFAULT_DB_CONCURRENCY) {
  const ceiling = Math.max(1, limit)
  let active = 0
  const waiting: Array<() => void> = []

  const release = () => {
    active--
    const next = waiting.shift()
    if (next) next()
  }

  return async function gate<T>(task: () => Promise<T>): Promise<T> {
    if (active >= ceiling) {
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    active++
    try {
      return await task()
    } finally {
      release()
    }
  }
}

export { DEFAULT_DB_CONCURRENCY }
