import 'dotenv/config'
import { db } from '../lib/db'
import { approvalsCommonData } from '../lib/db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  const rows = await db.select().from(approvalsCommonData).where(eq(approvalsCommonData.category, 'vendor')).limit(50)
  console.log('approvalsCommonData vendors:', rows)
}

main()
