import 'dotenv/config'
import postgres from 'postgres'

// READ-ONLY. Only SELECTs.
const RAW = process.env.DATABASE_URL!

function withPort(p: string) {
  const u = new URL(RAW)
  u.port = p
  u.searchParams.delete('pgbouncer')
  return u.toString()
}

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function timeIt(fn: () => Promise<unknown>, n: number) {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = process.hrtime.bigint()
    await fn()
    out.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  return out
}

async function run(label: string, url: string, prepare: boolean) {
  const sql = postgres(url, { max: 1, prepare, ssl: { rejectUnauthorized: false }, idle_timeout: 60 })
  try {
    // pin the connection + get a real booking id
    const [row] = await sql`select id from kia_bookings where deleted_at is null limit 1`
    const id = row.id as string

    const baseline = await timeIt(() => sql`select 1 as x`, 6)

    // EXACTLY what drizzle emits at lib/kia/bookings.ts:980 -> where id=$1 and deleted_at is null limit $2
    const twoParam = await timeIt(
      () => sql`select * from kia_bookings where id = ${id} and deleted_at is null limit ${1}`,
      12,
    )

    // finding's "safe half": inline the LIMIT, keep the id bound -> 1 param
    const oneParam = await timeIt(
      () => sql`select * from kia_bookings where id = ${id} and deleted_at is null limit 1`,
      12,
    )

    console.log(`\n=== ${label}  (prepare:${prepare}) ===`)
    console.log(`  SELECT 1 (0 param)      med ${med(baseline).toFixed(1)}ms`)
    const rtt = med(baseline)
    const fmt = (xs: number[]) => {
      const first = xs[0]
      const warm = med(xs.slice(2))
      return `first ${first.toFixed(1)}ms | warm-med ${warm.toFixed(1)}ms (${(warm / rtt).toFixed(2)} RTT)`
    }
    console.log(`  id+limit bound (2 param) ${fmt(twoParam)}`)
    console.log(`  id bound, limit inlined  ${fmt(oneParam)}`)
    console.log(`  raw 2-param series: ${twoParam.map((x) => x.toFixed(0)).join(', ')}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main() {
  // 6543 = transaction pooler = WHAT PRODUCTION USES (lib/db/index.ts:44-46)
  await run('6543 TRANSACTION pooler [PROD]', withPort('6543'), false)
  await run('6543 TRANSACTION pooler [PROD]', withPort('6543'), true)
  // 5432 = session pooler = what dev rewrites to (lib/db/index.ts:52-54)
  await run('5432 SESSION pooler [DEV]', withPort('5432'), false)
  await run('5432 SESSION pooler [DEV]', withPort('5432'), true)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
