import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

async function time(fn: () => Promise<unknown>, n = 7) {
  const t: number[] = []
  for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s) }
  return med(t)
}

async function main() {
  // warm
  for (let i = 0; i < 3; i++) await sql`SELECT 1`

  const base = await time(() => sql`SELECT 1`, 11)
  console.log(`BASE RTT (SELECT 1, no params) = ${base.toFixed(1)}ms`)

  const oneParam = await time(() => sql`SELECT ${1}::int`, 7)
  console.log(`SELECT $1 (1 param)            = ${oneParam.toFixed(1)}ms  -> ${(oneParam / base).toFixed(2)}x base`)

  // BEGIN/COMMIT empty txn
  const empty = await time(() => sql.begin(async () => { }), 7)
  console.log(`empty txn (BEGIN+COMMIT)       = ${empty.toFixed(1)}ms  -> ${(empty / base).toFixed(2)}x base`)

  // ladder: N parameterized statements inside a txn
  console.log('\n--- ladder: N parameterized stmts in a txn (READ-ONLY selects) ---')
  const results: Array<{ n: number; ms: number; rtt: number }> = []
  for (const n of [1, 2, 3, 4, 6, 8, 10]) {
    const ms = await time(() => sql.begin(async (tx) => {
      for (let i = 0; i < n; i++) await tx`SELECT id FROM kia_bookings WHERE status = ${'booking_created'} LIMIT 1`
    }), 5)
    const rtt = ms / base
    results.push({ n, ms, rtt })
    console.log(`N=${String(n).padStart(2)}  ${ms.toFixed(1).padStart(7)}ms   ${rtt.toFixed(2).padStart(5)} RTT   (predicted 2+2N = ${2 + 2 * n})`)
  }

  // linear fit -> marginal cost per statement
  const nAvg = results.reduce((a, r) => a + r.n, 0) / results.length
  const yAvg = results.reduce((a, r) => a + r.ms, 0) / results.length
  const slope = results.reduce((a, r) => a + (r.n - nAvg) * (r.ms - yAvg), 0) / results.reduce((a, r) => a + (r.n - nAvg) ** 2, 0)
  const intercept = yAvg - slope * nAvg
  const ssTot = results.reduce((a, r) => a + (r.ms - yAvg) ** 2, 0)
  const ssRes = results.reduce((a, r) => a + (r.ms - (slope * r.n + intercept)) ** 2, 0)
  console.log(`\nfit: ms = ${slope.toFixed(1)}*N + ${intercept.toFixed(1)}   R^2=${(1 - ssRes / ssTot).toFixed(4)}`)
  console.log(`marginal cost per stmt = ${slope.toFixed(1)}ms = ${(slope / base).toFixed(2)} RTT`)

  // ---------- REACHABILITY ----------
  console.log('\n=== REACHABILITY OF THE WORST-CASE PATHS ===')

  const status = await sql`SELECT status, count(*)::int FROM kia_bookings WHERE deleted_at IS NULL GROUP BY status ORDER BY 2 DESC`
  console.log('booking status:', JSON.stringify(status))

  const withProforma = await sql`SELECT count(*)::int AS c FROM kia_bookings WHERE deleted_at IS NULL AND proforma_id IS NOT NULL`
  console.log('bookings with proforma_id:', withProforma[0].c)

  const appr = await sql`
    SELECT upper(coalesce(p.approval_status,'(null)')) AS st, count(*)::int AS c
    FROM kia_bookings b JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`
  console.log('approval_status of proformas ATTACHED to a live booking:', JSON.stringify(appr))

  const allProformas = await sql`SELECT upper(coalesce(approval_status,'(null)')) AS st, count(*)::int AS c FROM kia_proformas GROUP BY 1 ORDER BY 2 DESC`
  console.log('approval_status across ALL kia_proformas:', JSON.stringify(allProformas))

  const alloc = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE released_at IS NULL)::int AS active FROM kia_vehicle_allocations`
  console.log('kia_vehicle_allocations:', JSON.stringify(alloc[0]))

  const transfers = await sql`SELECT count(*)::int AS c FROM kia_vehicle_transfers`
  console.log('kia_vehicle_transfers rows (has transfer EVER run?):', transfers[0].c)

  const act = await sql`SELECT activity_type, count(*)::int AS c FROM kia_booking_activity GROUP BY 1 ORDER BY 2 DESC`
  console.log('kia_booking_activity by type (what write paths have EVER executed):', JSON.stringify(act))

  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
