const Module = require('node:module')
const originalRequire = Module.prototype.require

Module.prototype.require = function (id) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments)
}

const fs = require('node:fs')
const path = require('node:path')

function loadEnv() {
  const envFiles = ['.env.local', '.env']
  for (const file of envFiles) {
    const p = path.resolve(process.cwd(), file)
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim()
          let val = trimmed.slice(idx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          if (!process.env[key]) {
            process.env[key] = val
          }
        }
      }
    }
  }
}

loadEnv()

async function main() {
  const { analyticsDb } = require('../lib/analytics/db')
  const { sql } = require('drizzle-orm')

  console.log('=== Checking August 2026 with lost_reason OR cancel ===')
  const lostAug = await analyticsDb.execute(sql`
    SELECT
      COUNT(*)::int AS total_lost,
      COALESCE(NULLIF(TRIM(lost_reason::text), ''), 'Other') AS reason,
      COALESCE(NULLIF(TRIM(consultant_name::text), ''), 'Unassigned') AS consultant,
      COALESCE(NULLIF(TRIM(model::text), ''), 'Unknown') AS model,
      COALESCE(NULLIF(TRIM(sub_source::text), ''), 'Unknown') AS source
    FROM hyundai_enquiry_report
    WHERE enquiry_date >= '2026-08-01' AND enquiry_date < '2026-09-01'
      AND (NULLIF(TRIM(lost_reason::text), '') IS NOT NULL OR LOWER(TRIM(COALESCE(enquiry_status::text, ''))) LIKE '%cancel%' OR LOWER(TRIM(COALESCE(enquiry_status::text, ''))) LIKE '%lost%')
    GROUP BY 2, 3, 4, 5
    LIMIT 10
  `)
  console.table(lostAug.rows || lostAug)

  const lostRowsSample = await analyticsDb.execute(sql`
    SELECT
      enquiry_date,
      name_of_the_customer,
      contact_number,
      model,
      sub_source as source,
      consultant_name,
      enquiry_status,
      lost_reason,
      lost_due_to,
      lost_remark
    FROM hyundai_enquiry_report
    WHERE enquiry_date >= '2026-08-01' AND enquiry_date < '2026-09-01'
      AND (NULLIF(TRIM(lost_reason::text), '') IS NOT NULL OR LOWER(TRIM(COALESCE(enquiry_status::text, ''))) LIKE '%cancel%' OR LOWER(TRIM(COALESCE(enquiry_status::text, ''))) LIKE '%lost%')
    ORDER BY enquiry_date DESC
    LIMIT 5
  `)
  console.table(lostRowsSample.rows || lostRowsSample)
}

main().catch(console.error)
