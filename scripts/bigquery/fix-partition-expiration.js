/**
 * Remove default 60-day partition expiration on BigQuery fact tables (free tier default).
 * Required for historical dashboard data (2021–2026).
 */
require('dotenv').config({ quiet: true })

const TABLES = [
  'platinum_facts.ro_billing',
  'platinum_facts.repair_order_list',
  'platinum_facts.call_center_complaints',
  'platinum_facts.operation_wise_analysis',
  'platinum_facts.ew_report',
  'platinum_facts.trust_package',
  'platinum_facts.service_appointment',
  'kia_facts.ro_billing',
  'kia_facts.operation_wise_analysis',
  'kia_facts.open_ro_yearly',
  'kia_facts.call_center_complaints',
  'hyundai_facts.ro_billing',
  'hyundai_facts.repair_order_list',
  'hyundai_facts.call_center_complaints',
  'hyundai_facts.warranty_claim_list',
]

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required')
  const location = process.env.BIGQUERY_LOCATION || 'asia-south1'
  const { BigQuery } = await import('@google-cloud/bigquery')
  const bq = new BigQuery({ projectId })

  for (const tablePath of TABLES) {
    const sql = `ALTER TABLE \`${projectId}.${tablePath}\` SET OPTIONS (partition_expiration_days = NULL)`
    console.log(`[bq-fix] ${tablePath}`)
    const [job] = await bq.createQueryJob({ query: sql, location })
    await job.getQueryResults()
    console.log(`[bq-fix] OK ${tablePath}`)
  }

  console.log('[bq-fix] completed')
}

main().catch((error) => {
  console.error('[bq-fix] failed', error.message)
  process.exit(1)
})
