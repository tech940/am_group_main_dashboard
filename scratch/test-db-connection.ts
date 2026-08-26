import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
  connect_timeout: 15,
  max: 1,
  prepare: false,
})

async function main() {
  console.log('--- Checking database user table schema & role enum ---')
  
  // 1. Get columns
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `
  console.log('\nColumns in users table:')
  console.table(cols)

  // 2. Get role enum values
  const enumVals = await sql`
    SELECT enumlabel 
    FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'role'
  `
  console.log('\nRole enum values in Postgres:')
  console.log(enumVals.map(r => r.enumlabel))

  // 3. Try a mock insert (in a transaction that we roll back)
  console.log('\nTesting insert...')
  try {
    await sql.begin(async (tx) => {
      const result = await tx`
        INSERT INTO users (
          supabase_id,
          email,
          full_name,
          role,
          brand,
          is_active
        ) VALUES (
          'test-supabase-id-123',
          'test-user-creation@example.com',
          'Test User Creation',
          'viewer',
          'kia',
          true
        ) RETURNING *
      `
      console.log('✅ Mock insert succeeded! Result:', result)
      // Rollback transaction to avoid polluting database
      throw new Error('ROLLBACK_TEST')
    })
  } catch (error: any) {
    if (error.message === 'ROLLBACK_TEST') {
      console.log('✅ Insert SQL is valid and succeeded!')
    } else {
      console.error('❌ Insert failed! Error:', error)
      console.error('Error Code:', error.code)
      console.error('Error Detail:', error.detail)
      console.error('Error Hint:', error.hint)
    }
  }

  await sql.end()
}

main().catch(e => {
  console.error('Fatal error:', e)
})
