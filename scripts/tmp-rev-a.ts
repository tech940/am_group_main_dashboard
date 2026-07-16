import 'dotenv/config'
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })
const med = (a:number[]) => a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]
async function t(f:()=>Promise<unknown>, n=5){const r:number[]=[];for(let i=0;i<n;i++){const s=Date.now();await f();r.push(Date.now()-s)}return med(r)}
;(async () => {
  await sql`SELECT 1`
  const base = await t(()=>sql`SELECT 1`, 10)
  console.log('BASE RTT', base)

  // existing indexes / constraints on allocations
  const idx = await sql`SELECT indexdef FROM pg_indexes WHERE tablename='kia_vehicle_allocations'`
  console.log('ALLOC INDEXES:'); idx.forEach(r=>console.log('  ', r.indexdef))
  const cnt = await sql`SELECT count(*)::int c FROM kia_vehicle_allocations`
  console.log('alloc rows', cnt[0].c)

  // ladder: BEGIN + N trivial parameterized stmts + COMMIT, inside a real txn
  for (const n of [0,1,2,4,8]) {
    const ms = await t(async () => {
      await sql.begin(async (tx) => { for (let i=0;i<n;i++) await tx`SELECT ${i}::int` })
    }, 5)
    console.log(`txn N=${n}: ${ms}ms = ${(ms/base).toFixed(2)} RTT`)
  }
  // is a NON-parameterized stmt inside txn cheaper?
  for (const n of [4]) {
    const ms = await t(async () => {
      await sql.begin(async (tx) => { for (let i=0;i<n;i++) await tx.unsafe(`SELECT ${i}`) })
    }, 5)
    console.log(`txn N=${n} NO-PARAM: ${ms}ms = ${(ms/base).toFixed(2)} RTT`)
  }
  await sql.end()
})()
