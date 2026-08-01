import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString)

async function test() {
  console.log('--- Checking table columns for demo_car_list vs kia_demo_car_list ---')

  const colsDemoCarList = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'demo_car_list';
  `
  console.log("Columns for 'demo_car_list':", colsDemoCarList.map(c => c.column_name))

  const colsKiaDemoCarList = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'kia_demo_car_list';
  `
  console.log("Columns for 'kia_demo_car_list':", colsKiaDemoCarList.map(c => c.column_name))

  await sql.end()
}

test()
