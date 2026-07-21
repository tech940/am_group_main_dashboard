import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING RSA DATE PARSING ===\n')

  const sample = await sql`
    SELECT 
      invoice_date,
      CASE 
        WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
        WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'MM/DD/YYYY')
        ELSE NULL
      END AS parsed_date
    FROM rsa_report
    LIMIT 20
  `
  console.log('Sample parsed dates:', JSON.stringify(sample))

  const countJulyStandard = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM rsa_report
    WHERE (
      CASE 
        WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
        WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'MM/DD/YYYY')
        ELSE NULL
      END
    ) >= '2026-07-01'::date
    AND (
      CASE 
        WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
        WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'MM/DD/YYYY')
        ELSE NULL
      END
    ) <= '2026-07-31'::date
  `
  console.log('July 2026 RSA count with robust date parsing:', countJulyStandard[0].cnt)

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
