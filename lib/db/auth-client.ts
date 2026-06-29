import 'server-only'

import postgres from 'postgres'
import { env } from '@/config/env-config'

type AuthUserRow = {
  id: string
  supabase_id: string
  email: string
  full_name: string
  role: string
  brand: string | null
  department: string | null
  is_active: boolean
}

type PostgresClient = ReturnType<typeof postgres>
const AUTH_STATEMENT_TIMEOUT_MS = 5_000
const AUTH_LOCK_TIMEOUT_MS = 2_000
const AUTH_IDLE_IN_TRANSACTION_TIMEOUT_MS = 5_000

const globalForAuthDb = globalThis as unknown as {
  authPostgresClient: PostgresClient | undefined
}

function authDatabaseUrl() {
  const url = new URL(env.database.url)

  // Supabase uses 6543 for transaction mode and 5432 for session mode.
  // Keep one session connection reserved for authorization lookups so
  // analytics fan-out cannot exhaust every auth connection.
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }

  return url.toString()
}

const authClient = globalForAuthDb.authPostgresClient ?? postgres(authDatabaseUrl(), {
  prepare: false,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idle_timeout: 20,
  connect_timeout: 3,
  max_lifetime: 60 * 10,
  onnotice: () => {},
  connection: {
    application_name: 'main_dashboard_auth',
    options: [
      `-c statement_timeout=${AUTH_STATEMENT_TIMEOUT_MS}`,
      `-c lock_timeout=${AUTH_LOCK_TIMEOUT_MS}`,
      `-c idle_in_transaction_session_timeout=${AUTH_IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
    ].join(' '),
  },
})

if (process.env.NODE_ENV !== 'production') {
  globalForAuthDb.authPostgresClient = authClient
}

export async function findAuthUserBySupabaseId(supabaseId: string) {
  const rows = await authClient<AuthUserRow[]>`
    SELECT
      id,
      supabase_id,
      email,
      full_name,
      role,
      brand,
      department,
      is_active
    FROM users
    WHERE supabase_id = ${supabaseId}
      AND deleted_at IS NULL
    LIMIT 1
  `

  return rows[0]
}
