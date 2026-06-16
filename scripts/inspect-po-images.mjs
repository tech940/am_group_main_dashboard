import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[po-img]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const rows = await db.unsafe(`
  SELECT id, order_number, vendor_images, grn_images, vendor_details
  FROM purchase_orders
  WHERE deleted_at IS NULL
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 8
`)

for (const row of rows) {
  console.log(JSON.stringify(row, null, 2))
  console.log('---')
}

await db.end()
