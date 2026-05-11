import type { Config } from 'drizzle-kit'
import { env } from './config/env-config'

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.database.url,
  },
} satisfies Config
