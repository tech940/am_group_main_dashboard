import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('Applying table updates to discount_approvals...')
  await db.execute(sql`
    ALTER TABLE discount_approvals ADD COLUMN IF NOT EXISTS tele_date date;
    ALTER TABLE discount_approvals ADD COLUMN IF NOT EXISTS insurance_type text;
    ALTER TABLE discount_approvals ADD COLUMN IF NOT EXISTS history jsonb DEFAULT '[]'::jsonb;
  `)
  console.log('discount_approvals updated successfully.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
