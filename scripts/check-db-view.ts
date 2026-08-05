import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function checkDbView() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  // View definition of v_cre_performance
  const viewDef = await sql`
    SELECT view_definition 
    FROM information_schema.views 
    WHERE table_name = 'v_cre_performance'
  `
  console.log('--- View Definition ---')
  console.log(viewDef[0]?.view_definition)

  // Direct aggregation of call_recordings by CRE
  const creAgg = await sql`
    SELECT 
      cr.cre_id,
      up.full_name as cre_name,
      COUNT(*) as total_calls,
      COUNT(*) FILTER (WHERE cr.duration_seconds > 0) as connected_calls,
      COUNT(*) FILTER (WHERE cr.duration_seconds = 0 OR cr.call_type IN ('missed', 'rejected', 'not_answered')) as missed_calls
    FROM call_recordings cr
    LEFT JOIN user_profiles up ON up.id = cr.cre_id
    GROUP BY cr.cre_id, up.full_name
  `
  console.log('\n--- Direct SQL Aggregation on call_recordings ---')
  console.log(creAgg)

  await sql.end()
}

checkDbView().catch(console.error)
