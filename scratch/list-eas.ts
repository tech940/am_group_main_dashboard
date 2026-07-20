import 'dotenv/config'
import { db } from '../lib/db'
import { users } from '../lib/db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  const sahil = await db
    .select()
    .from(users)
    .where(eq(users.email, 'ea@amkia.in'))
  console.log('Aakriti user now:', sahil)
}

main()
