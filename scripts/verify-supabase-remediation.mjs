#!/usr/bin/env node
/**
 * Pre-flight and smoke-test helper for Supabase security/performance remediation.
 *
 * Usage:
 *   node scripts/verify-supabase-remediation.mjs preflight
 *   node scripts/verify-supabase-remediation.mjs smoke [--base-url http://localhost:3000]
 *
 * Production steps (manual in Supabase Dashboard):
 *   1. Run scripts/supabase-query-performance-fixes.sql (or -concurrent.sql via psql)
 *   2. Run scripts/supabase-security-linter-fixes.sql
 *   3. Re-run Database Linter and Query Performance reports
 *   4. Authentication → Providers → Email → Enable leaked password protection
 */

import 'dotenv/config'
import pg from 'pg'

const { Client } = pg

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL
    || process.env.ANALYTICS_DATABASE_URL
    || process.env.DATABASE_DIRECT_URL
    || process.env.POSTGRES_URL
    || ''
  )
}

async function withClient(fn) {
  const url = getDatabaseUrl()
  if (!url) {
    console.error('DATABASE_URL or ANALYTICS_DATABASE_URL is required.')
    process.exit(1)
  }
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function preflight() {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      SELECT current_user,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls
    `)
    const row = rows[0] || {}
    console.log('Pre-flight RLS check:')
    console.log(`  current_user: ${row.current_user}`)
    console.log(`  bypass_rls:   ${row.bypass_rls}`)
    if (!row.bypass_rls) {
      console.warn('\nWARNING: Drizzle role does not bypass RLS.')
      console.warn('Revoking anon/authenticated on analytics tables may break server queries.')
      console.warn('Grant BYPASSRLS to the pooler role or add narrow server policies before security script.')
      process.exit(2)
    }
    console.log('\nOK: Server role bypasses RLS — safe to run supabase-security-linter-fixes.sql RLS section.')
  })
}

async function verifyFunctions() {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      SELECT proname,
             proconfig
      FROM pg_proc
      WHERE proname IN (
        'generate_order_number',
        'update_purchase_orders_updated_at',
        'log_workflow_action',
        'kia_proforma_is_approver',
        'mg_proforma_is_approver',
        'set_demo_vehicle_remarks_updated_at'
      )
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY proname
    `)
    console.log('Function search_path verification:')
    for (const row of rows) {
      const hasSearchPath = Array.isArray(row.proconfig) && row.proconfig.some((entry) => String(entry).startsWith('search_path='))
      console.log(`  ${row.proname}: ${hasSearchPath ? 'OK' : 'MISSING search_path'}`)
    }
  })
}

async function verifyIndexes() {
  await withClient(async (client) => {
    const { rows } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE indexname IN (
        'idx_open_ro_yearly_status_date',
        'idx_ro_billing_dealer_norm',
        'idx_hyundai_warranty_claim_dealer_norm',
        'idx_hyundai_repair_order_list_row_hash'
      )
      ORDER BY indexname
    `)
    console.log('Performance index verification:')
    rows.forEach((row) => console.log(`  OK ${row.indexname}`))
  })
}
async function smoke(baseUrl) {
  const endpoints = [
    '/api/brands/kia/business-excellence/overview?dealerCode=JK402&chunk=summary',
    '/api/brands/hyundai/warranty-claims?dealerCodes=N5203',
  ]

  console.log(`Smoke-testing APIs at ${baseUrl} (expect 401 without auth — confirms routes respond):`)
  for (const path of endpoints) {
    const url = `${baseUrl.replace(/\/$/, '')}${path}`
    try {
      const res = await fetch(url)
      console.log(`  ${res.status} ${path}`)
    } catch (error) {
      console.log(`  FAIL ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

const [command, ...rest] = process.argv.slice(2)
const baseUrlFlag = rest.find((arg) => arg.startsWith('--base-url='))?.split('=')[1]
  || (rest.includes('--base-url') ? rest[rest.indexOf('--base-url') + 1] : null)
  || 'http://localhost:3000'

if (command === 'preflight') {
  await preflight()
} else if (command === 'verify') {
  await verifyFunctions()
  await verifyIndexes()
} else if (command === 'smoke') {
  await smoke(baseUrlFlag)
} else {
  console.log('Commands: preflight | verify | smoke [--base-url URL]')
  process.exit(1)
}
