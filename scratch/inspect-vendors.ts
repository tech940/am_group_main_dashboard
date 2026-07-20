import 'dotenv/config'
import { db } from '../lib/db'
import { vendors } from '../lib/db/schema'

async function main() {
  const allVendors = await db.select().from(vendors).limit(50)
  console.log('Vendors list in database:', allVendors)
}

main()
