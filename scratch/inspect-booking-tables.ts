import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString, {
  connect_timeout: 30,
  idle_timeout: 20,
  max: 1,
})

function generateNumber(prefix: string) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${dateStr}-${rand}`
}

import { getPettyCashDashboard, listPettyCashRequests, getPettyCashApprovalQueue, getPettyCashApprovalCount } from '@/lib/petty-cash/server'
import type { AppUser } from '@/lib/auth/app-user'

async function main() {
  console.log('Creating fuel_approvals table...')

  await sql`
    CREATE TABLE IF NOT EXISTS fuel_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_number TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL DEFAULT 'kia',
      location TEXT NOT NULL,
      fuel_required_for TEXT NOT NULL,
      veh_reg_no TEXT NOT NULL,
      vin_no TEXT NOT NULL,
      last_fuel_filled_date DATE,
      fuel_type TEXT NOT NULL,
      current_km_reading TEXT,
      fuel_filled_date DATE NOT NULL DEFAULT CURRENT_DATE,
      fuel_filled_ltrs NUMERIC(10, 2) NOT NULL,
      fuel_slip_url TEXT NOT NULL,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'ed_pending',
      current_stage TEXT NOT NULL DEFAULT 'ed',
      
      ed_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ed_approved_by_name TEXT,
      ed_approved_at TIMESTAMPTZ,
      ed_remarks TEXT,
      
      hr_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      hr_approved_by_name TEXT,
      hr_approved_at TIMESTAMPTZ,
      hr_remarks TEXT,
      
      md_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      md_approved_by_name TEXT,
      md_approved_at TIMESTAMPTZ,
      md_remarks TEXT,
      
      rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
      rejected_by_name TEXT,
      rejected_at TIMESTAMPTZ,
      reject_stage TEXT,
      reject_remarks TEXT,
      
      send_back_reason TEXT,
      
      submitted_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
      submitted_by_name TEXT NOT NULL,
      submitted_by_email TEXT NOT NULL,
      
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE INDEX IF NOT EXISTS fuel_approvals_brand_status_idx ON fuel_approvals (brand, status, created_at DESC);
  `

  await sql`
    CREATE INDEX IF NOT EXISTS fuel_approvals_location_idx ON fuel_approvals (location, created_at DESC);
  `

  await sql`
    CREATE INDEX IF NOT EXISTS fuel_approvals_submitted_by_idx ON fuel_approvals (submitted_by_id, created_at DESC);
  `

  console.log('fuel_approvals table and indexes created successfully!')
  await sql.end()
}

main().catch(console.error)
