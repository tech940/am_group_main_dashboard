import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/config/env-config'
import { recordSqlTiming } from '@/lib/api/timing'

const STATEMENT_TIMEOUT_MS = 12_000
const DEFAULT_POOL_MAX = 6

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

// In dev the pool was capped at 1, which serialises the parallel `Promise.all`
// queries each list endpoint fires (7-8 round-trips → sequential = slow). A small
// pool lets them actually run concurrently against the Supabase pooler while still
// leaving plenty of headroom for auth. Overridable via DATABASE_POOL_MAX.
const DB_POOL_MAX = process.env.NODE_ENV === 'development'
  ? positiveInteger(process.env.DATABASE_POOL_MAX, 4)
  : positiveInteger(process.env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX)
const LOCK_TIMEOUT_MS = positiveInteger(process.env.DATABASE_LOCK_TIMEOUT_MS, 3_000)
const IDLE_IN_TRANSACTION_TIMEOUT_MS = positiveInteger(process.env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS, 10_000)

type PostgresClient = ReturnType<typeof postgres>
type PostgresTransaction = postgres.TransactionSql

function runInTimedTransaction<T>(
  baseClient: PostgresClient,
  action: (tx: PostgresTransaction) => T | Promise<T>,
) {
  return baseClient.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout TO ${STATEMENT_TIMEOUT_MS}`)
    await tx.unsafe(`SET LOCAL lock_timeout TO ${LOCK_TIMEOUT_MS}`)
    await tx.unsafe(`SET LOCAL idle_in_transaction_session_timeout TO ${IDLE_IN_TRANSACTION_TIMEOUT_MS}`)
    return action(tx)
  })
}

// Singleton pattern to prevent connection pool exhaustion during Next.js HMR
// Without this, every hot reload creates a NEW postgres client, leaking connections
const globalForDb = globalThis as unknown as {
  postgresClient: PostgresClient | undefined
  postgresClientKey: string | undefined
}

function databaseUrlForRuntime() {
  const explicitSessionUrl = process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL
  if (process.env.NODE_ENV === 'development' && explicitSessionUrl) {
    return explicitSessionUrl
  }

  if (process.env.NODE_ENV !== 'development' || process.env.DATABASE_USE_TRANSACTION_POOLER_IN_DEV === 'true') {
    return env.database.url
  }

  try {
    const url = new URL(env.database.url)
    const isSupabaseTransactionPooler = url.port === '6543' || url.searchParams.get('pgbouncer') === 'true'

    if (isSupabaseTransactionPooler) {
      url.port = '5432'
      url.searchParams.delete('pgbouncer')
      return url.toString()
    }
  } catch {
    // Fall back to the configured URL if it cannot be parsed.
  }

  return env.database.url
}

const runtimeDatabaseUrl = databaseUrlForRuntime()
const runtimeClientKey = [
  runtimeDatabaseUrl,
  DB_POOL_MAX,
  STATEMENT_TIMEOUT_MS,
  LOCK_TIMEOUT_MS,
  IDLE_IN_TRANSACTION_TIMEOUT_MS,
].join('|')
const shouldReuseGlobalClient = globalForDb.postgresClient && globalForDb.postgresClientKey === runtimeClientKey

if (process.env.NODE_ENV !== 'production' && globalForDb.postgresClient && !shouldReuseGlobalClient) {
  void globalForDb.postgresClient.end({ timeout: 1 }).catch(() => null)
}

const baseClient = shouldReuseGlobalClient && globalForDb.postgresClient ? globalForDb.postgresClient : postgres(runtimeDatabaseUrl, {
  prepare: false, // Required for Supabase Transaction Mode pooler (PgBouncer)
  ssl: { rejectUnauthorized: false },
  // Keep enough headroom in the Supabase transaction pool for auth and other
  // app instances. A large per-process pool lets dashboard fan-out starve auth.
  max: DB_POOL_MAX,
  idle_timeout: 10, // Release connections faster when idle
  connect_timeout: 5, // Fail fast if connections are starved instead of hanging
  max_lifetime: 60 * 30, // 30 minutes - recycle connections periodically
  onnotice: () => {}, // Ignore notices
  connection: {
    application_name: 'main_dashboard',
    options: [
      `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
      `-c lock_timeout=${LOCK_TIMEOUT_MS}`,
      `-c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
    ].join(' '),
  },
})

const client = Object.assign(
  (...args: Parameters<PostgresClient>) => baseClient(...args),
  baseClient,
  { unsafe: baseClient.unsafe.bind(baseClient) },
) as PostgresClient

// In development, store the client on globalThis so HMR reuses it
if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = baseClient
  globalForDb.postgresClientKey = runtimeClientKey
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
