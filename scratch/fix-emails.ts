import 'dotenv/config'
import { db } from '../lib/db'
import { users, delegationContacts, delegationTasks } from '../lib/db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  console.log('Fixing corrupted emails in database...')
  
  // Fix delegation contacts with "!gmail.com"
  const cResult = await db
    .update(delegationContacts)
    .set({ email: 'sk9969401@gmail.com' })
    .where(eq(delegationContacts.email, 'sk9969401@!gmail.com'))
  console.log('Updated delegation contacts:', cResult)

  // Fix delegation tasks with "!gmail.com"
  const tResult = await db
    .update(delegationTasks)
    .set({ assignedEmail: 'sk9969401@gmail.com' })
    .where(eq(delegationTasks.assignedEmail, 'sk9969401@!gmail.com'))
  console.log('Updated delegation tasks:', tResult)

  // Fix users with "!gmail.com" if any
  const uResult = await db
    .update(users)
    .set({ email: 'sk9969401@gmail.com' })
    .where(eq(users.email, 'sk9969401@!gmail.com'))
  console.log('Updated users:', uResult)
}

main()
