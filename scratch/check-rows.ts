import { db } from '../lib/db'
import { kiaApprovalRequests } from '../lib/db/schema'

async function run() {
  try {
    const rows = await db.select().from(kiaApprovalRequests).limit(5)
    console.log('ROWS:', rows.map(r => ({ id: r.id, name: r.name, brand: r.brand })))
  } catch (err) {
    console.error(err)
  }
}
run()
