require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[dealer-codes]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  console.log('ro_billing_report dealer codes (top):')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) AS code, COUNT(*)::int AS n
    FROM ro_billing_report
    GROUP BY 1 ORDER BY n DESC LIMIT 20
  `))

  console.log('\nadv_wise dealer_code / retail_dealer_code (top):')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) AS code, COUNT(*)::int AS n
    FROM adv_wise_lubricants_vas
    GROUP BY 1 ORDER BY n DESC LIMIT 20
  `))

  console.log('\noperation_wise dealer_code (top):')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(COALESCE(dealer_code, ''))) AS code, COUNT(*)::int AS n
    FROM operation_wise_analysis_report
    GROUP BY 1 ORDER BY n DESC LIMIT 20
  `))

  console.log('\nrsa_report dealer_workshop_code:')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(COALESCE(dealer_workshop_code, ''))) AS code, COUNT(*)::int AS n
    FROM rsa_report GROUP BY 1 ORDER BY n DESC LIMIT 10
  `))

  console.log('\new_report outlet/main:')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(COALESCE(NULLIF(outlet_code, ''), NULLIF(main_dealer_code, '')))) AS code, COUNT(*)::int AS n
    FROM ew_report GROUP BY 1 ORDER BY n DESC LIMIT 10
  `))

  console.log('\nmcp_report dealer_code:')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(COALESCE(dealer_code, ''))) AS code, COUNT(*)::int AS n
    FROM mcp_report GROUP BY 1 ORDER BY n DESC LIMIT 10
  `))

  console.log('\nadv_wise columns:')
  console.log(await db.unsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'adv_wise_lubricants_vas'
    AND column_name ILIKE '%part%' OR column_name ILIKE '%dealer%'
    ORDER BY column_name
  `))

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
