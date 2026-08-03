const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function getDbUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')

  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function main() {
  const dbUrl = getDbUrl()
  console.log('[Check-Warranty] Connecting to DB...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
  })

  try {
    const claimListCount = await sql`SELECT count(*) FROM public.hyundai_warranty_claim_list`
    const ytpCount = await sql`SELECT count(*) FROM public.hyundai_warranty_claim_ytp`
    const dealersClaim = await sql`SELECT DISTINCT source_dealer_code FROM public.hyundai_warranty_claim_list`
    const dealersYtp = await sql`SELECT DISTINCT source_dealer_code FROM public.hyundai_warranty_claim_ytp`

    console.log('[Check-Warranty] hyundai_warranty_claim_list count:', claimListCount[0].count)
    console.log('[Check-Warranty] hyundai_warranty_claim_ytp count:', ytpCount[0].count)
    console.log('[Check-Warranty] Dealers in claim list:', dealersClaim.map(d => d.source_dealer_code))
    console.log('[Check-Warranty] Dealers in YTP:', dealersYtp.map(d => d.source_dealer_code))
  } catch (err) {
    console.error('[Check-Warranty] Error:', err)
  } finally {
    await sql.end()
  }
}

main()
