import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectVcrePerformanceDef() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  // Querypg_views for v_cre_performance
  const v = await sql`
    SELECT schemaname, viewname, definition 
    FROM pg_views 
    WHERE viewname = 'v_cre_performance'
  `
  console.log('--- v_cre_performance view definition ---')
  console.log(v)

  // Also query all functions in postgres
  const funcs = await sql`
    SELECT routine_name, routine_definition 
    FROM information_schema.routines 
    WHERE routine_schema = 'public'
  `
  console.log('--- Public functions ---')
  console.log(funcs)

  await sql.end()
}

inspectVcrePerformanceDef().catch(console.error)
