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
  max: 3, // Keep low — Supavisor manages connections server-side
  idle_timeout: 20,
  connect_timeout: 30,
  onnotice: () => {}, // Ignore notices
})

// In development, store the client on globalThis so HMR reuses it
if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = client
}

export const db = drizzle(client)
