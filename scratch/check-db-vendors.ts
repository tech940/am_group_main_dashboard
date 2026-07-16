import 'dotenv/config'
import { db } from '../lib/db'
import { vendors } from '../lib/db/schema'
import { isNull } from 'drizzle-orm'

async function checkVendors() {
  try {
    const list = await db.select().from(vendors).where(isNull(vendors.deletedAt))
    console.log('ACTIVE VENDORS COUNT:', list.length)
    console.log('ACTIVE VENDORS:', JSON.stringify(list, null, 2))
    
    const all = await db.select().from(vendors)
    console.log('TOTAL VENDORS COUNT:', all.length)
    console.log('ALL VENDORS:', JSON.stringify(all, null, 2))
  } catch (error) {
    console.error('ERROR CHECKING VENDORS:', error)
  }
}

checkVendors()
