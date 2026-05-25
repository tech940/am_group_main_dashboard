import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/config/env-config'

// Singleton pattern to prevent connection pool exhaustion during Next.js HMR
// Without this, every hot reload creates a NEW postgres client, leaking connections
const globalForDb = globalThis as unknown as {
  postgresClient: ReturnType<typeof postgres> | undefined
}

const client = globalForDb.postgresClient ?? postgres(env.database.url, {
  prepare: false, // Required for Supabase Transaction Mode pooler (PgBouncer)
  ssl: { rejectUnauthorized: false },
  max: 10, // Increased for concurrent requests (was 3)
  idle_timeout: 45,
  connect_timeout: 8,
  max_lifetime: 60 * 30, // 30 minutes - recycle connections periodically
  onnotice: () => {}, // Ignore notices
  connection: {
    application_name: 'main_dashboard',
    statement_timeout: 12_000,
  },
})

// In development, store the client on globalThis so HMR reuses it
if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = client
}

export const db = drizzle(client)
