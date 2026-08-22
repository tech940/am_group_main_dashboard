import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('Unifying scrap location names in database...')
  let success = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Attempt ${attempt}...`)
      const result = await db.execute(sql.raw(`
        UPDATE scrap_transactions
        SET location_name = 'AM HYUNDAI AUTO SQUARE - GANGYAL'
        WHERE location_name ILIKE '%AUTO SQUARE%GANGYAL%'
           OR location_name ILIKE '%AUTO SQUARE%-%GANGYAL%'
           OR location_name ILIKE 'AM HYUNDAI AUTO SQUARE GANGYAL';
      `))
      console.log('Update executed successfully!')

      const distinct = await db.execute(sql.raw(`
        SELECT DISTINCT location_name FROM scrap_transactions WHERE location_name ILIKE '%GANGYAL%' ORDER BY location_name;
      `))
      console.log('Distinct GANGYAL locations now:', distinct)
      success = true
      break
    } catch (err) {
      console.warn(`Attempt ${attempt} failed:`, err)
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!success) {
    throw new Error('Failed after 3 attempts')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
