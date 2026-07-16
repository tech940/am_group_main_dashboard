import 'dotenv/config'
import postgres from 'postgres'
const URL_6543 = process.env.DATABASE_URL!.replace(':5432', ':6543')
const withTimeout = <T>(p: Promise<T>, ms: number, tag: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT_${tag}`)), ms))])

async function main() {
  const sql = postgres(URL_6543, { max: 6, prepare: true, ssl: { rejectUnauthorized: false }, idle_timeout: 5 })
  const [{ id }] = await sql`select id from kia_bookings where deleted_at is null limit 1`
  console.log('connected, id =', id)

  let ok = 0; const errs: string[] = []
  for (let r = 0; r < 4; r++) {
    const batch = Array.from({ length: 8 }, (_, i) =>
      withTimeout(
        (i % 2 === 0
          ? sql`select * from kia_bookings where id = ${id} and deleted_at is null limit ${1}`
          : sql`select count(*)::int as c from kia_bookings where status = ${'booking_created'} and deleted_at is null`
        ) as Promise<unknown>, 20000, `r${r}i${i}`)
        .then(() => { ok++ })
        .catch((e: any) => { errs.push(e.code || e.message) })
    )
    await Promise.all(batch)
    console.log(`  round ${r}: ok=${ok} errs=${errs.length}`)
  }
  console.log(`\nTOTAL ok=${ok} errors=${errs.length}`)
  if (errs.length) { const c: Record<string,number> = {}; for (const e of errs) c[e]=(c[e]||0)+1; console.log('ERRORS:', c) }
  else console.log('NO prepared-statement errors under concurrent transaction-pooler multiplexing.')
  await withTimeout(sql.end({ timeout: 5 }), 10000, 'end').catch(()=>console.log('(end timed out, ignoring)'))
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FATAL', e); process.exit(1)})
