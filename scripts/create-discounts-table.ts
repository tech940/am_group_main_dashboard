import * as dotenv from 'dotenv'
import * as path from 'path'
import postgres from 'postgres'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function run() {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('DATABASE_URL is not set')
  
  const url = new URL(rawUrl)
  if (url.port === '6543') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  
  console.log('Connecting to database:', url.host)
  const client = postgres(url.toString(), { ssl: { rejectUnauthorized: false } })
  
  console.log('Creating table kia_booking_discounts...')
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS kia_booking_discounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL REFERENCES kia_bookings(id) ON DELETE CASCADE,
      requested_amount DECIMAL(14, 2) NOT NULL,
      approved_amount DECIMAL(14, 2),
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_by UUID NOT NULL REFERENCES users(id),
      requested_by_name TEXT NOT NULL,
      action_by UUID REFERENCES users(id),
      action_by_name TEXT,
      action_remarks TEXT,
      action_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  
  console.log('Creating indexes on kia_booking_discounts...')
  await client.unsafe(`
    CREATE INDEX IF NOT EXISTS kia_booking_discounts_booking_idx ON kia_booking_discounts(booking_id);
    CREATE INDEX IF NOT EXISTS kia_booking_discounts_status_idx ON kia_booking_discounts(status);
  `)
  
  console.log('Table and indexes created successfully!')
  await client.end()
  process.exit(0)
}

run().catch(err => {
  console.error('Error creating table:', err)
  process.exit(1)
})
