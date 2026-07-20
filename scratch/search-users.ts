import 'dotenv/config'
import { db } from '../lib/db'
import { users } from '../lib/db/schema'
import { eq, ilike } from 'drizzle-orm'

async function main() {
  console.log('Searching for users named "Anchal" or similar...')
  const list = await db
    .select()
    .from(users)
    .where(ilike(users.fullName, '%Anchal%'))
  console.log('Anchal users:', list)

  console.log('\nSearching for user "Sahil katoch"...')
  const sahil = await db
    .select()
    .from(users)
    .where(ilike(users.fullName, '%Sahil%'))
  console.log('Sahil users:', sahil)
}

main()
