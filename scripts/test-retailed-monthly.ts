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

  console.log('=== Checking Sales Retailed monthly counts by confirm_date for 2026 ===')
  const q = await analyticsDb.execute(sql`
    SELECT
      EXTRACT(MONTH FROM COALESCE(s.confirm_date, s.delivery_date))::int AS mo,
      COUNT(DISTINCT UPPER(BTRIM(s.vin_number)))::int AS unique_vins,
      COUNT(*)::int AS raw_rows
    FROM hyundai_sales_report s
    WHERE (s.confirm_date IS NOT NULL OR s.delivery_date IS NOT NULL)
      AND EXTRACT(YEAR FROM COALESCE(s.confirm_date, s.delivery_date)) = 2026
    GROUP BY 1
    ORDER BY 1
  `)
  console.table(q.rows || q)
}

main().catch(console.error)
