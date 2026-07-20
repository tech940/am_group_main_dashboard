import 'dotenv/config'
import { db } from '../lib/db'
import { delegationContacts } from '../lib/db/schema'
import { eq, ilike } from 'drizzle-orm'

async function main() {
  const sahil = await db
    .select()
    .from(delegationContacts)
    .where(ilike(delegationContacts.name, '%Sahil%'))
  console.log('Sahil contacts now:', sahil)
}

main()
