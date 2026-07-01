import dotenv from 'dotenv'
dotenv.config()

async function test() {
  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')

    const columnsResult = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'kia_enquiry_report'
      ORDER BY ordinal_position
    `);
    const columns = columnsResult.map((row: any) => String(row.column_name || '').trim()).filter(Boolean)
    console.log('Columns of kia_enquiry_report:', columns)
  } catch (err) {
    console.error('Error in test:', err);
  }
}

test()
