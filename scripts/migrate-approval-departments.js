const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function getDbUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')

  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

function classifyDepartment(dept, approvalType) {
  const d = (dept || '').toString().trim().toUpperCase()
  const a = (approvalType || '').toString().trim().toUpperCase()

  if (
    d === 'SERVICE' ||
    d.includes('SERVICE') ||
    d.includes('SPARE') ||
    d.includes('BODY') ||
    d.includes('LABOUR') ||
    a.includes('PARTS') ||
    a.includes('WORKSHOP') ||
    a.includes('LABOUR') ||
    a.includes('MAINTENANCE') ||
    a.includes('SERVICE')
  ) {
    return 'SERVICE'
  }
  return 'SALES'
}

async function main() {
  const dbUrl = getDbUrl()
  console.log('[Migration] Connecting to database...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
  })

  try {
    const rows = await sql`SELECT id, department, approval_type FROM public.kia_approval_requests`
    console.log(`[Migration] Found ${rows.length} approval requests in total.`)

    let salesCount = 0
    let serviceCount = 0
    let updatedCount = 0

    for (const row of rows) {
      const targetDept = classifyDepartment(row.department, row.approval_type)
      if (targetDept === 'SERVICE') serviceCount++
      else salesCount++

      if (row.department !== targetDept) {
        await sql`
          UPDATE public.kia_approval_requests 
          SET department = ${targetDept}, updated_at = NOW() 
          WHERE id = ${row.id}
        `
        updatedCount++
      }
    }

    console.log(`[Migration] Done! Updated ${updatedCount} rows. Total Sales: ${salesCount}, Total Service: ${serviceCount}`)
  } catch (err) {
    console.error('[Migration] Error:', err)
  } finally {
    await sql.end()
  }
}

main().catch(console.error)
