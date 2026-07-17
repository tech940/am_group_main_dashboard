import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function run() {
  try {
    const res = await db.execute(sql`SELECT brand, COUNT(*) FROM kia_approval_requests GROUP BY brand;`)
    console.log('BRANDS:', res)
    
    const count = await db.execute(sql`SELECT COUNT(*) FROM kia_approval_requests;`)
    console.log('TOTAL COUNT:', count)
  } catch (err) {
    console.error(err)
  }
}
run()
