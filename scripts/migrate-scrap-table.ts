import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function migrateScrapTable() {
  console.log('=== Adding missing distribution & metadata columns to scrap_transactions ===')

  await db.execute(sql.raw(`
    ALTER TABLE scrap_transactions
      ADD COLUMN IF NOT EXISTS is_distributed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS distributed_by TEXT,
      ADD COLUMN IF NOT EXISTS sent_to_accounts BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS accounts_received_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS accounts_note TEXT,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
  `))

  console.log('✅ Columns added successfully to scrap_transactions table.')
}

migrateScrapTable().catch(console.error).finally(() => process.exit(0))
