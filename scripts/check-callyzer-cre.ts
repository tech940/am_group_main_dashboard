import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function checkCallyzerCreCalls() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  // Find calls for Komal, Pallavi, Asha, Karnesh, Smriti in callyzer_calls
  const cres = ['Komal', 'Pallavi', 'Asha Thakur', 'Karnesh Uttam', 'Smriti Sudan', 'AM HYUNDAI', 'AM. HYUNDAI', 'Raman']
  
  const rows = await sql`
    SELECT 
      emp_name,
      emp_number,
      call_type,
      duration,
      call_date,
      client_number,
      client_name
    FROM callyzer_calls
    WHERE emp_name ILIKE ANY(${cres.map(c => `%${c}%`)})
      OR emp_number IN ('9484200000', '9484011111')
    ORDER BY call_date DESC
    LIMIT 30
  `

  console.log('Sample callyzer_calls rows for CREs:')
  console.log(rows)

  // Get count of unanswered calls in callyzer_calls by emp_name / call_type
  const summary = await sql`
    SELECT 
      emp_name,
      call_type,
      COUNT(*) as count
    FROM callyzer_calls
    GROUP BY emp_name, call_type
    ORDER BY emp_name, call_type
  `
  console.log('\n--- Unanswered breakdown in callyzer_calls ---')
  console.table(summary)

  await sql.end()
}

checkCallyzerCreCalls().catch(console.error)
