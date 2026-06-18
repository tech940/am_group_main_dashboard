import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    const listResult = await db.execute(sql`
      SELECT DISTINCT source_dealer_code, COUNT(*) as cnt
      FROM hyundai_warranty_claim_list
      GROUP BY source_dealer_code
    `)
    console.log('claim_list unique dealer codes:')
    console.log(listResult)

    const ytpResult = await db.execute(sql`
      SELECT DISTINCT source_dealer_code, COUNT(*) as cnt
      FROM hyundai_warranty_claim_ytp
      GROUP BY source_dealer_code
    `)
    console.log('ytp unique dealer codes:')
    console.log(ytpResult)

    // Let's also check mappings
    const mappingsResult = await db.execute(sql`
      SELECT dealer_code, dealer_name, is_active
      FROM hyundai_warranty_dealer_mappings
    `)
    console.log('mappings:')
    console.log(mappingsResult)

  } catch (error) {
    console.error(error)
  }
}

main()
