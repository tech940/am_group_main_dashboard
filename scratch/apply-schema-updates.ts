import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('Applying table updates to kia_approval_requests...')
  await db.execute(sql`
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'PENDING';
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS utr_number text;
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS payment_proof_url text;
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS payment_remarks text;
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS payment_completed_at timestamptz;
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS payment_completed_by text;
    ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS send_back_reason text;
  `)
  console.log('kia_approval_requests updated successfully.')

  console.log('Applying table updates to vendors...')
  await db.execute(sql`
    ALTER TABLE vendors ALTER COLUMN gst_number DROP NOT NULL;
    ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_code text;
    -- Safely add unique constraint if column was just added
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendors_vendor_code_key'
      ) THEN
        ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_code_key UNIQUE (vendor_code);
      END IF;
    END;
    $$;
    ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_account_number text;
  `)
  console.log('vendors updated successfully.')

  console.log('Recreating index on vendors.gst_number...')
  await db.execute(sql`
    DROP INDEX IF EXISTS vendors_gst_idx;
    CREATE INDEX IF NOT EXISTS vendors_gst_idx ON vendors (gst_number);
  `)
  console.log('Index updated successfully.')

  console.log('All database schema updates applied successfully!')
}

main()
