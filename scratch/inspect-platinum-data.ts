import { analyticsDb as db } from '@/lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    console.log('--- Platinum Database Tables Deep Analysis ---')

    // 1. Get all tables in public schema containing 'platinum'
    const tablesResult = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name ILIKE '%platinum%'
      ORDER BY table_name
    `)
    const tables = tablesResult.map((t) => String(t.table_name))
    console.log(`Found ${tables.length} tables related to Platinum:`, tables)

    const analysisReport: any[] = []

    for (const table of tables) {
      console.log(`\nAnalyzing table: ${table}...`)

      // Get columns for the table
      const colsResult = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = ${table}
      `)
      
      const columns = colsResult.map((c) => ({
        name: String(c.column_name),
        type: String(c.data_type)
      }))

      // Try to find a dealer code column
      const dealerCol = columns.find(c => 
        c.name.toLowerCase().includes('dealer_code') || 
        c.name.toLowerCase().includes('dealer') || 
        c.name.toLowerCase().includes('branch')
      )?.name || null

      // Try to find a date column
      const dateCol = columns.find(c => 
        (c.name.toLowerCase().includes('date') || 
         c.name.toLowerCase().includes('day') || 
         c.name.toLowerCase().includes('time')) && 
        !c.name.toLowerCase().includes('upload')
      )?.name || columns.find(c => c.name.toLowerCase().includes('upload'))?.name || null

      console.log(`  Identified dealer column: ${dealerCol}, date column: ${dateCol}`)

      if (!dealerCol || !dateCol) {
        console.log(`  Skipping details for ${table} (missing dealer or date column). Columns:`, columns.map(c => `${c.name}(${c.type})`))
        analysisReport.push({
          table,
          error: 'No dealer_code or date column identified',
          columns: columns.map(c => `${c.name} (${c.type})`)
        })
        continue
      }

      // Query data by dealer and year
      try {
        const statsQuery = sql.raw(`
          SELECT 
            COALESCE(NULLIF(TRIM(CAST(${dealerCol} AS text)), ''), 'Unspecified') AS dealer,
            EXTRACT(YEAR FROM CAST(${dateCol} AS date))::int AS year,
            COUNT(*)::int AS rows_count,
            MIN(CAST(${dateCol} AS date))::text AS min_date,
            MAX(CAST(${dateCol} AS date))::text AS max_date
          FROM "${table}"
          GROUP BY dealer, year
          ORDER BY dealer, year
        `)
        const stats = await db.execute(statsQuery)
        console.log(`  Successfully analyzed ${stats.length} dealer-year segments.`)
        analysisReport.push({
          table,
          dealerCol,
          dateCol,
          segments: stats
        })
      } catch (err: any) {
        console.error(`  Error querying stats for ${table}:`, err.message)
        analysisReport.push({
          table,
          dealerCol,
          dateCol,
          error: err.message
        })
      }
    }

    // Output formatted analysis report
    console.log('\n=============================================')
    console.log('FINAL ANALYSIS REPORT')
    console.log('=============================================')
    console.log(JSON.stringify(analysisReport, null, 2))

  } catch (error) {
    console.error('Error executing analysis script:', error)
  }
  process.exit(0)
}

main()
