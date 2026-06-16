import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/config/env-config'
import { recordSqlTiming } from '@/lib/api/timing'

const STATEMENT_TIMEOUT_MS = 12_000

type PostgresClient = ReturnType<typeof postgres>
type PostgresTransaction = postgres.TransactionSql

function runInTimedTransaction<T>(
  baseClient: PostgresClient,
  action: (tx: PostgresTransaction) => T | Promise<T>,
) {
  return baseClient.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout TO ${STATEMENT_TIMEOUT_MS}`)
    return action(tx)
  })
}

// Drizzle expects client.unsafe() to synchronously return a PendingQuery (Promise + .values()).
// Wrapping in begin() must preserve that API shape.
function wrapUnsafe(baseClient: PostgresClient): PostgresClient['unsafe'] {
  const unsafe = (query: string, parameters?: Parameters<PostgresClient['unsafe']>[1], queryOptions?: Parameters<PostgresClient['unsafe']>[2]) => {
    const pending = Object.assign(
      runInTimedTransaction(baseClient, (tx) => tx.unsafe(query, parameters, queryOptions)),
      {
        describe: () => runInTimedTransaction(baseClient, (tx) => tx.unsafe(query, parameters, queryOptions).describe()),
        values: () => {
          const valuesPending = runInTimedTransaction(
            baseClient,
            (tx) => tx.unsafe(query, parameters, queryOptions).values(),
          )
          return Object.assign(valuesPending, {
            describe: () => runInTimedTransaction(
              baseClient,
              (tx) => tx.unsafe(query, parameters, queryOptions).values().describe(),
            ),
          })
        },
        raw: () => runInTimedTransaction(baseClient, (tx) => tx.unsafe(query, parameters, queryOptions).raw()),
        simple: function (this: Promise<unknown>) {
          return this
        },
        execute: function (this: Promise<unknown>) {
          return this
        },
        cancel: () => {},
      },
    )

    return pending
  }

  return unsafe as PostgresClient['unsafe']
}

// Singleton pattern to prevent connection pool exhaustion during Next.js HMR
// Without this, every hot reload creates a NEW postgres client, leaking connections
const globalForDb = globalThis as unknown as {
  postgresClient: PostgresClient | undefined
}

const baseClient = globalForDb.postgresClient ?? postgres(env.database.url, {
  prepare: false, // Required for Supabase Transaction Mode pooler (PgBouncer)
  ssl: { rejectUnauthorized: false },
  max: 20,
  idle_timeout: 45,
  connect_timeout: 15,
  max_lifetime: 60 * 30, // 30 minutes - recycle connections periodically
  onnotice: () => {}, // Ignore notices
  connection: {
    application_name: 'main_dashboard',
  },
})

const client = Object.assign(
  (...args: Parameters<PostgresClient>) => baseClient(...args),
  baseClient,
  { unsafe: wrapUnsafe(baseClient) },
) as PostgresClient

// In development, store the client on globalThis so HMR reuses it
if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = baseClient
}

function shouldLogSqlTimings() {
  return process.env.SQL_QUERY_LOGS !== 'false'
}

function getSqlCaller() {
  const stack = new Error().stack?.split('\n').map((line) => line.trim()) || []
  const caller = stack.find((line) => (
    line.includes('app\\api')
    || line.includes('app/api')
    || line.includes('lib\\')
    || line.includes('lib/')
  ) && !line.includes('lib\\db\\index') && !line.includes('lib/db/index'))

  return caller?.replace(/^at\s+/, '') || 'unknown caller'
}

function getSqlRowCount(result: unknown) {
  if (Array.isArray(result)) return result.length
  if (result && typeof result === 'object' && 'rowCount' in result) {
    const rowCount = Number((result as { rowCount?: unknown }).rowCount)
    return Number.isFinite(rowCount) ? rowCount : null
  }
  return null
}

const rawDb = drizzle(client)
const originalExecute = rawDb.execute.bind(rawDb)

rawDb.execute = (async (...args: Parameters<typeof rawDb.execute>) => {
  if (!shouldLogSqlTimings()) {
    return originalExecute(...args)
  }

  const caller = getSqlCaller()
  const startedAt = Date.now()

  try {
    const result = await originalExecute(...args)
    const durationMs = Date.now() - startedAt
    const rowCount = getSqlRowCount(result)
    recordSqlTiming({ caller, durationMs, rowCount, ok: true })
    console.log(`[sql] ${durationMs}ms${rowCount === null ? '' : ` rows=${rowCount}`} ${caller}`)
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    recordSqlTiming({ caller, durationMs, rowCount: null, ok: false })
    console.error(`[sql:error] ${durationMs}ms ${caller}`, error)
    throw error
  }
}) as typeof rawDb.execute

export const db = rawDb
