import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const oilMonths = await sql`
    SELECT 
      to_char(sold_date, 'YYYY-MM') as ym,
      to_char(sold_date, 'Month YYYY') as month_label,
      count(*)::int as txns,
      sum(weight_qty)::numeric as barrels,
      sum(amount_received)::numeric as revenue
    FROM scrap_transactions
    WHERE scrap_type_name ILIKE '%oil%' OR description ILIKE '%oil%'
    GROUP BY ym, month_label
    ORDER BY ym ASC
  `
  console.log('=== Used Oil Transactions by Month ===')
  console.log(oilMonths)
  await sql.end()

  const txnsToUpdate = await sql`
    SELECT id, location_name, group_name
    FROM scrap_transactions
  `
  let willChange = 0
  const changesSummary: Record<string, { to: string; count: number }> = {}

  for (const t of txnsToUpdate) {
    const norm = normalizeScrapLocationName(t.location_name, t.group_name)
    if (norm && norm !== t.location_name) {
      willChange++
      const key = `"${t.location_name}" -> "${norm}"`
      if (!changesSummary[key]) changesSummary[key] = { to: norm, count: 0 }
      changesSummary[key].count++
    }
  }

  console.log(`Updating ${txnsToUpdate.length} transactions in database...`)
  let updatedCount = 0
  for (const t of txnsToUpdate) {
    const norm = normalizeScrapLocationName(t.location_name, t.group_name)
    if (norm && norm !== t.location_name) {
      await sql`
        UPDATE scrap_transactions 
        SET location_name = ${norm}, updated_at = NOW() 
        WHERE id = ${t.id}
      `
      updatedCount++
    }
  }
  console.log(`Successfully updated ${updatedCount} transactions in database to standard names!`)

  const afterCheck = await sql`
    SELECT location_name, count(*)::int as count 
    FROM scrap_transactions 
    GROUP BY location_name 
    ORDER BY location_name ASC
  `
  console.log(`\n=== Verified DB State: ${afterCheck.length} distinct canonical locations ===`)
  for (const row of afterCheck) {
    console.log(` - ${row.location_name}: ${row.count} txns`)
  }

  await sql.end()
}

main().catch(console.error)
