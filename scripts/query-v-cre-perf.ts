import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectVcrePerformance() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  const res = await sql`SELECT * FROM public.v_cre_performance`
  console.log('--- public.v_cre_performance ---')
  console.log(res)

  await sql.end()
}

inspectVcrePerformance().catch(console.error)
