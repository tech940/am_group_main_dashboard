import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function migrateNoAnswer() {
  console.log('=== Starting Migration for "No answer — retry" records ===')

  const res = await db.execute(sql.raw(`
    UPDATE kia_lead_followups
    SET outcome = 'no_answer',
        updated_at = NOW()
    WHERE (
      notes ILIKE '%no answer%' OR
      notes ILIKE '%retry%' OR
      reason = 'no_answer' OR
      reason ILIKE '%no answer%'
    ) AND (outcome IS NULL OR outcome != 'no_answer')
    RETURNING id, booking_id, notes, reason, outcome
  `))

  console.log(`Migrated ${res.length} follow-up records to outcome = 'no_answer'.`)
  if (res.length > 0) {
    console.log('Sample updated records:', res.slice(0, 5))
  }

  // Also check if any booking activities have 'no_answer' remarks
  const actRes = await db.execute(sql.raw(`
    SELECT count(*)::int as count FROM kia_lead_followups WHERE outcome = 'no_answer'
  `))
  console.log('Total follow-ups now with outcome = no_answer:', actRes[0]?.count)
}

migrateNoAnswer().catch(console.error).finally(() => process.exit(0))
