import 'dotenv/config'
import postgres from 'postgres'

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  ssl: { rejectUnauthorized: false },
  max: 1,
})

async function test(label, fn) {
  const started = Date.now()
  try {
    await fn()
    console.log(`${label}: finished ${Date.now() - started}ms`)
  } catch (error) {
    console.log(`${label}: failed after ${Date.now() - started}ms`, error instanceof Error ? error.message : error)
  }
}

await test('plain sleep', () => client`SELECT pg_sleep(15)`)

await test('begin + set local + sleep', () => client.begin(async (sql) => {
  await sql`SET LOCAL statement_timeout TO 12000`
  await sql`SELECT pg_sleep(15)`
}))

await client.end()
