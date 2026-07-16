import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  const total = await sql`SELECT count(*)::int AS n FROM kia_bookings WHERE deleted_at IS NULL`
  const withProforma = await sql`SELECT count(*)::int AS n FROM kia_bookings WHERE deleted_at IS NULL AND proforma_id IS NOT NULL`
  const dist = await sql`
    SELECT coalesce(upper(p.approval_status::text),'<null-proforma-row>') AS approval_status, count(*)::int AS n
    FROM kia_bookings b
    LEFT JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND b.proforma_id IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC`
  const approvedIds = await sql`
    SELECT b.id, b.model, b.variant, upper(p.approval_status::text) AS st
    FROM kia_bookings b JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND upper(p.approval_status::text) = 'APPROVED' LIMIT 10`

  console.log('total live bookings        :', total[0].n)
  console.log('bookings WITH proforma_id  :', withProforma[0].n)
  console.log('approval_status dist       :', JSON.stringify(dist, null, 1))
  console.log('APPROVED bookings (gate=T) :', approvedIds.length, JSON.stringify(approvedIds, null, 1))
  await sql.end()
}
main()
