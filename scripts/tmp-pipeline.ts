import 'dotenv/config'
import postgres from 'postgres'
const URL = process.env.DATABASE_URL!
const med = (a:number[]) => a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]

async function bench(label:string, max:number, n:number, param:boolean) {
  const sql = postgres(URL, { max, prepare:false, ssl:{rejectUnauthorized:false} })
  await sql`select 1`.simple()            // warm
  await Promise.all([...Array(max)].map(()=>sql`select pg_sleep(0.05)`)) // force-open all conns
  const runs:number[] = []
  for (let r=0;r<5;r++){
    const t=Date.now()
    await Promise.all([...Array(n)].map((_,i)=> param
      ? sql`select id from kia_bookings where status = ${'booking_created'} limit ${1}`
      : sql.unsafe(`select id from kia_bookings where status = 'booking_created' limit 1 /*${i}*/`)))
    runs.push(Date.now()-t)
  }
  await sql.end()
  const m = med(runs)
  console.log(`${label.padEnd(34)} max=${String(max).padEnd(2)} n=${String(n).padEnd(3)} ${param?'PARAM ':'LITERAL'} -> ${String(m).padStart(5)}ms  (${(m/RTT).toFixed(1)} RTT)`)
  return m
}
let RTT = 1
async function main(){
  const s = postgres(URL,{max:1,prepare:false,ssl:{rejectUnauthorized:false}})
  const w:number[]=[]; for(let i=0;i<10;i++){const t=Date.now(); await s`select 1`.simple(); w.push(Date.now()-t)}
  RTT = med(w); console.log(`baseline RTT (no-param SELECT 1) = ${RTT}ms\n`); await s.end()

  console.log('--- PARAMETERIZED (describeFirst=true -> conn goes `full`) ---')
  for (const n of [1,5,6,12,18]) await bench('param fan-out', 6, n, true)
  console.log('\n--- LITERAL (describeFirst=false -> conn stays `busy`, pipelines) ---')
  for (const n of [1,5,6,12,18]) await bench('literal fan-out', 6, n, false)
  console.log('\n--- LITERAL on a SINGLE connection (pipelining proof) ---')
  for (const n of [1,6,18]) await bench('literal, max=1', 1, n, false)
  console.log('\n--- PARAM on a single connection (no pipelining) ---')
  for (const n of [1,6]) await bench('param, max=1', 1, n, true)
}
main()
