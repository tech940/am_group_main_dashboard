import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/config/env-config'

const client = postgres(env.database.url, { prepare: false })

export const db = drizzle(client)
