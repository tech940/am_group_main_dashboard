const assert = require('node:assert/strict')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured')
  }

  const db = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    // 1. Verify Platinum workflow tables exist
    const [tables] = await db`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platinum_warranty_claim_actions') AS has_actions,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platinum_warranty_claim_evidence') AS has_evidence,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platinum_warranty_dealer_mappings') AS has_mappings
    `
    assert.ok(tables.has_actions, 'platinum_warranty_claim_actions table must exist')
    assert.ok(tables.has_evidence, 'platinum_warranty_claim_evidence table must exist')
    assert.ok(tables.has_mappings, 'platinum_warranty_dealer_mappings table must exist')

    // 2. Verify dealer mappings are seeded
    const mappings = await db`
      SELECT dealer_code, dealer_name FROM platinum_warranty_dealer_mappings ORDER BY dealer_code
    `
    const dealerCodes = mappings.map(m => m.dealer_code)
    assert.ok(dealerCodes.includes('N5211'), 'N5211 must be seeded')
    assert.ok(dealerCodes.includes('N6250'), 'N6250 must be seeded')
    assert.ok(dealerCodes.includes('N6828'), 'N6828 must be seeded')
    assert.ok(dealerCodes.includes('N6824'), 'N6824 must be seeded (legacy Rajouri)')

    // 3. Verify source tables have Platinum dealer data
    const [ytpCounts] = await db`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) IN ('N5211','N6250','N6828','N6824'))::int AS platinum_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N5211')::int AS jammu_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6250')::int AS rajouri_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6824')::int AS legacy_rajouri_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6828')::int AS poonch_rows
      FROM hyundai_warranty_claim_ytp
    `
    console.log('[YTP source rows]', ytpCounts)
    assert.ok(ytpCounts.platinum_rows > 0, 'YTP must have rows for Platinum dealer codes')

    const [claimListCounts] = await db`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) IN ('N5211','N6250','N6828','N6824'))::int AS platinum_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N5211')::int AS jammu_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6250')::int AS rajouri_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6824')::int AS legacy_rajouri_rows,
        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6828')::int AS poonch_rows
      FROM hyundai_warranty_claim_list
    `
    console.log('[Claim List source rows]', claimListCounts)
    assert.ok(claimListCounts.platinum_rows > 0, 'Claim list must have rows for Platinum dealer codes')

    // 4. Verify N6824 normalization — N6824 should exist alongside N6250
    if (ytpCounts.legacy_rajouri_rows > 0) {
      console.log(`[N6824→N6250 normalization] ${ytpCounts.legacy_rajouri_rows} legacy YTP rows exist under N6824`)
    }
    if (claimListCounts.legacy_rajouri_rows > 0) {
      console.log(`[N6824→N6250 normalization] ${claimListCounts.legacy_rajouri_rows} legacy claim list rows exist under N6824`)
    }

    // 5. Verify API endpoints respond (optional — requires running server)
    console.log('\n[Manual smoke-test instructions]')
    console.log('  npm run dev && visit:')
    console.log('  - http://localhost:3000/brands/platinum/warranty-list')
    console.log('  - http://localhost:3000/brands/platinum/warranty-claim-list')
    console.log('  - http://localhost:3000/api/brands/platinum/warranty-claims?source=ytp&limit=5')
    console.log('  - http://localhost:3000/api/brands/platinum/warranty-claims?source=claim_list&limit=5')

    console.log('\n✓ Platinum warranty claims verification passed')
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('[verify-platinum-warranty-claims] failed', error)
  process.exit(1)
})
