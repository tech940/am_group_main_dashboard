import 'dotenv/config'
import { db } from '../lib/db'
import { users } from '../lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function main() {
  console.log('Updating Aakriti brand to "kia"...')
  const result = await db
    .update(users)
    .set({ brand: 'kia' })
    .where(and(eq(users.email, 'ea@amkia.in'), eq(users.role, 'ea')))
  console.log('Update result:', result)
}

main()
