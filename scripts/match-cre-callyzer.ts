import postgres from 'postgres'
import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

const DATABASE_URL = process.env.DATABASE_URL!

async function matchCreCallyzer() {
  const sql = postgres(DATABASE_URL, { max: 1 })
  const supabase = getCreSupabase()

  const { data: profiles } = await supabase.from('user_profiles').select('id, full_name, phone_number, branch_id')
  console.log('--- User Profiles ---')
  console.log(profiles)

  const callyzerEmps = await sql`
    SELECT DISTINCT emp_name, emp_number 
    FROM callyzer_calls
  `
  console.log('\n--- Callyzer Distinct Emp Names/Numbers ---')
  console.log(callyzerEmps)

  await sql.end()
}

matchCreCallyzer().catch(console.error)
