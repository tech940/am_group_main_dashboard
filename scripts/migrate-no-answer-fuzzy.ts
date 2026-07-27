import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function migrateNoAnswerFuzzy() {
  console.log('=== Running Fuzzy Migration for "No Answer / Not Connected" records ===')

  const res = await db.execute(sql.raw(`
    UPDATE kia_lead_followups
    SET outcome = 'no_answer',
        updated_at = NOW()
    WHERE (
      notes ILIKE '%not answering%' OR
      notes ILIKE '%no answer%' OR
      notes ILIKE '%not reachable%' OR
      notes ILIKE '%did not answer%' OR
      notes ILIKE '%no response%' OR
      notes ILIKE '%retry%' OR
      reason = 'no_answer' OR
      reason ILIKE '%no answer%'
    )
    RETURNING id, booking_id, notes, outcome
  `))

  console.log(`Migrated ${res.length} follow-up records to outcome = 'no_answer':`)
  console.log(res)
}

migrateNoAnswerFuzzy().catch(console.error).finally(() => process.exit(0))
