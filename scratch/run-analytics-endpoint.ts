import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'
import { getKiaProformaVisibilityFilter } from '../lib/kia-proforma/access'

async function main() {
  const email = 'sahil.katoch@gmail.com'
  const [appUser] = await db.execute(sql`SELECT id, email, role, full_name FROM users WHERE email = ${email} LIMIT 1`)
  console.log('AppUser:', appUser)
  if (!appUser) {
    console.error('User not found')
    process.exit(1)
  }

  const [profile] = await db.execute(sql`SELECT * FROM kia_user_profiles WHERE email = ${email} LIMIT 1`)
  console.log('Profile:', profile)

  const visibility = profile && profile.approver
    ? sql`TRUE`
    : sql`login_email = ${email}`

  console.log('Visibility:', visibility)

  try {
    const pivotRows = await db.execute(sql`
      WITH base AS (
        SELECT COALESCE(NULLIF(TRIM(bank_name), ''), 'Unassigned Bank') AS category, 
               to_char(proforma_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS period
        FROM kia_proformas
        WHERE deleted_at IS NULL AND ${visibility}
      ),
      totals AS (
        SELECT category, COUNT(*)::int AS grand_total
        FROM base
        GROUP BY category
        ORDER BY grand_total DESC, category ASC
        LIMIT 1000
      )
      SELECT base.category, base.period, COUNT(*)::int AS value, totals.grand_total
      FROM base
      JOIN totals ON totals.category = base.category
      GROUP BY base.category, base.period, totals.grand_total
      ORDER BY totals.grand_total DESC, base.category ASC, base.period ASC
    `)
    console.log('Pivot Rows count:', pivotRows.length)
  } catch (error) {
    console.error('Query failed:', error)
  }
  process.exit(0)
}

main()
