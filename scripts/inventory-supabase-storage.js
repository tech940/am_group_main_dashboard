/**
 * Read-only Supabase storage inventory for BigQuery migration planning.
 * Usage: node scripts/inventory-supabase-storage.js [--json] [--out docs/bigquery-migration-inventory-YYYY-MM-DD.md]
 */
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

const APP_TABLES = new Set([
  'users', 'admin_audit_logs', 'permission_groups', 'permissions', 'role_permissions',
  'user_permissions', 'permission_audit_logs', 'dashboard_settings', 'user_preferences',
  'purchase_orders', 'workflow_history', 'purchase_order_approvals', 'notifications',
  'finance_orders', 'finance_order_workflow', 'finance_order_comments', 'finance_sheet',
  'am_finance_audit_logs', 'vehicles', 'workshop_jobs', 'recon_workflows', 'inventory_items',
  'inventory_transactions', 'tasks', 'comments', 'attachments', 'activity_logs',
  'kia_user_profiles', 'kia_price_details', 'kia_proforma_lookup_options', 'kia_proformas',
  'mg_user_profiles', 'mg_price_details', 'mg_proforma_lookup_options', 'mg_proformas',
  'demo_vehicle_details', 'demo_vehicle_remarks',
  'hyundai_warranty_claim_actions', 'hyundai_warranty_claim_evidence', 'hyundai_warranty_dealer_mappings',
])

const ANALYTICS_FACTS = new Set([
  'am_platinum_ro_billing_report', 'am_platinum_repair_order_list', 'am_platinum_call_center_complaints',
  'am_platinum_operation_wise_analysis_report', 'am_platinum_ew_report', 'am_platinum_trust_package',
  'am_platinum_service_appointment', 'am_platinum_rsa_report', 'am_platinum_operation_wise_analysis_advisor_report',
  'ro_billing_report', 'operation_wise_analysis_report', 'operation_wise_analysis_advisor_report',
  'open_ro_yearly', 'kia_call_center_complaints', 'ew_report', 'mcp_report', 'rsa_report',
  'adv_wise_lubricants_vas', 'psf_yearly', 'demo_car_list', 'service_appointment', 'demo_job_cards',
  'hyundai_ro_billing_report', 'hyundai_repair_order_list', 'hyundai_call_center_complaints',
  'hyundai_operation_wise_analysis_report', 'hyundai_ew_report', 'am_hyundai_rsa_report',
  'am_hyundai_mcp_report', 'hyundai_warranty_claim_list', 'hyundai_warranty_claim_ytp',
  'business_excellence_am_kia_new',
])

const ANALYTICS_AGGREGATES = new Set([
  'am_platinum_ro_billing_daily_summary_v1', 'am_platinum_ro_billing_daily_summary_v2',
  'am_platinum_workshop_performance_jc_summary_v2', 'am_platinum_vas_period_summary_v1',
  'am_platinum_open_ro_daily_summary_v1', 'am_platinum_complaints_daily_summary_v1',
  'workshop_performance_jc_summary_v1', 'workshop_operation_addon_summary_v1',
  'ro_billing_daily_summary_v2', 'ro_billing_daily_summary', 'workshop_performance_summary_v2',
  'am_hyundai_workshop_performance_jc_summary_v1',
])

const ANALYTICS_VIEWS = new Set([
  'am_platinum_service_appointment_resolved_v1',
])

const BORDERLINE = new Set(['finance_sheet', 'hyundai_warranty_claim_list'])

function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${n} B`
}

function classify(name, kind) {
  if (APP_TABLES.has(name)) return { destination: 'Supabase', reason: 'Application / auth / workflow table (Drizzle schema)' }
  if (ANALYTICS_FACTS.has(name)) return { destination: 'BigQuery', reason: 'Cron-imported dashboard fact table' }
  if (ANALYTICS_AGGREGATES.has(name)) return { destination: 'BigQuery', reason: 'Materialized summary — recreate as BQ aggregate table' }
  if (ANALYTICS_VIEWS.has(name)) return { destination: 'BigQuery', reason: 'Reporting view — recreate as BQ view or scheduled query' }
  if (BORDERLINE.has(name)) return { destination: 'Supabase (initially)', reason: 'Hybrid workflow + analytics; revisit after inventory sizing' }
  if (name.startsWith('am_platinum_') || name.startsWith('hyundai_') || name.startsWith('am_hyundai_')) {
    return { destination: 'BigQuery', reason: 'Brand analytics object (inferred from naming)' }
  }
  if (['ro_billing_report', 'open_ro_yearly', 'ew_report', 'mcp_report', 'rsa_report', 'demo_car_list', 'service_appointment', 'demo_job_cards'].includes(name)) {
    return { destination: 'BigQuery', reason: 'KIA analytics table' }
  }
  if (kind === 'materialized view') return { destination: 'BigQuery', reason: 'Unclassified MV — likely analytics aggregate' }
  return { destination: 'Review', reason: 'Not classified — manual review required' }
}

function findCodeReferences(root, tableName) {
  try {
    const output = execSync(
      `rg -l "${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" --glob "!node_modules" --glob "!.next" --glob "!docs/bigquery-migration-inventory*" .`,
      { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 10 * 1024 * 1024 }
    )
    return output.trim().split('\n').filter(Boolean).slice(0, 12)
  } catch {
    return []
  }
}

async function main() {
  const root = process.cwd()
  const jsonOnly = process.argv.includes('--json')
  const outArg = process.argv.find((arg) => arg.startsWith('--out='))
  const outPath = outArg
    ? outArg.slice('--out='.length)
    : path.join(root, 'docs', `bigquery-migration-inventory-${new Date().toISOString().slice(0, 10)}.md`)

  if (!process.env.DATABASE_URL) {
    console.error('[inventory] DATABASE_URL is not configured — writing template report from classification map only')
  }

  let tables = []
  let matviews = []
  let views = []

  if (process.env.DATABASE_URL) {
    const db = postgres(process.env.DATABASE_URL, {
      ssl: { rejectUnauthorized: false },
      prepare: false,
      max: 1,
      idle_timeout: 5,
      connect_timeout: 20,
    })

    try {
      tables = await db`
        SELECT
          'table' AS kind,
          schemaname,
          relname AS name,
          n_live_tup AS row_estimate,
          pg_total_relation_size(relid)::bigint AS total_bytes,
          pg_relation_size(relid)::bigint AS heap_bytes
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(relid) DESC
      `
      matviews = await db`
        SELECT
          'materialized view' AS kind,
          schemaname,
          matviewname AS name,
          NULL::bigint AS row_estimate,
          pg_total_relation_size(format('%I.%I', schemaname, matviewname)::regclass)::bigint AS total_bytes,
          pg_relation_size(format('%I.%I', schemaname, matviewname)::regclass)::bigint AS heap_bytes
        FROM pg_matviews
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(format('%I.%I', schemaname, matviewname)::regclass) DESC
      `
      views = await db`
        SELECT
          'view' AS kind,
          schemaname,
          viewname AS name,
          NULL::bigint AS row_estimate,
          0::bigint AS total_bytes,
          0::bigint AS heap_bytes
        FROM pg_views
        WHERE schemaname = 'public'
        ORDER BY viewname ASC
      `
    } finally {
      await db.end({ timeout: 5 })
    }
  }

  const rows = [...tables, ...matviews, ...views].map((row) => {
    const { destination, reason } = classify(row.name, row.kind)
    const refs = findCodeReferences(root, row.name)
    return {
      kind: row.kind,
      name: row.name,
      row_estimate: row.row_estimate,
      total_bytes: row.total_bytes,
      heap_bytes: row.heap_bytes,
      destination,
      reason,
      referenced_by: refs,
    }
  })

  if (jsonOnly) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  const totalAnalyticsBytes = rows
    .filter((r) => r.destination === 'BigQuery')
    .reduce((sum, r) => sum + Number(r.total_bytes || 0), 0)

  const lines = [
    '# BigQuery Migration Inventory',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Objects inventoried: **${rows.length}**`,
    `- Recommended for BigQuery: **${rows.filter((r) => r.destination === 'BigQuery').length}**`,
    `- Stay in Supabase: **${rows.filter((r) => r.destination === 'Supabase').length}**`,
    `- Estimated analytics storage (BQ candidates): **${formatBytes(totalAnalyticsBytes)}**`,
    '',
    '## Full inventory',
    '',
    '| Kind | Name | Rows (est.) | Total size | Heap | Destination | Reason | Referenced by (sample) |',
    '|------|------|-------------|------------|------|-------------|--------|------------------------|',
  ]

  for (const row of rows) {
    const refs = row.referenced_by.length
      ? row.referenced_by.map((f) => `\`${f}\``).join(', ')
      : '_none found_'
    lines.push(
      `| ${row.kind} | \`${row.name}\` | ${row.row_estimate ?? '—'} | ${formatBytes(row.total_bytes)} | ${formatBytes(row.heap_bytes)} | ${row.destination} | ${row.reason} | ${refs} |`
    )
  }

  lines.push('', '## Regenerate', '', '```bash', 'node scripts/inventory-supabase-storage.js', '```', '')

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
  console.log(`[inventory] wrote ${outPath} (${rows.length} objects)`)
}

main().catch((error) => {
  console.error('[inventory] failed', error)
  process.exit(1)
})
