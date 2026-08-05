import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectApprovalsCommonData() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  const types = await sql`
    SELECT id, brand, category, value 
    FROM approvals_common_data 
    WHERE category = 'approval_type'
  `
  console.log('--- approval_type in approvals_common_data ---')
  console.log(types)

  await sql.end()
}

inspectApprovalsCommonData().catch(console.error)
