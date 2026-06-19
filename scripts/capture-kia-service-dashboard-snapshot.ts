import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { normalizeKiaDealerCode } from '../lib/kia/dealer-branch'
import {
  buildLiveServiceDashboardMetrics,
  type ServiceDashboardMetrics,
} from '../lib/kia/service-dashboard-export'

function argument(name: string) {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`))
  if (direct) return direct.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : null
}

function indiaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function saveSnapshot(metrics: ServiceDashboardMetrics, dealerCode: string | null) {
  const dealerKey = dealerCode || 'all'
  const result = await db.execute(sql`
    INSERT INTO kia_service_dashboard_snapshots (
      dealer_code,
      report_date,
      metrics,
      cell_overrides,
      source_label,
      is_verified
    )
    VALUES (
      ${dealerKey},
      ${metrics.exportDate}::date,
      ${JSON.stringify(metrics)}::jsonb,
      '{}'::jsonb,
      ${`Cron capture after source imports for ${metrics.exportDate}`},
      false
    )
    ON CONFLICT (dealer_code, report_date)
    DO UPDATE SET
      metrics = EXCLUDED.metrics,
      source_label = EXCLUDED.source_label,
      updated_at = now()
    WHERE kia_service_dashboard_snapshots.is_verified = false
    RETURNING report_date, dealer_code, is_verified
  `)

  return Array.isArray(result) ? result[0] : null
}

async function main() {
  const reportDate = argument('date') || indiaDate()
  const dealerCode = normalizeKiaDealerCode(argument('dealer'))
  const metrics = await buildLiveServiceDashboardMetrics(reportDate, dealerCode)
  const saved = await saveSnapshot(metrics, dealerCode)

  if (!saved) {
    console.log(`[kia-service-dashboard] kept existing verified snapshot for ${dealerCode || 'all'} @ ${reportDate}`)
    return
  }

  console.log(`[kia-service-dashboard] captured ${dealerCode || 'all'} @ ${reportDate}`)
  console.log(`[kia-service-dashboard] warnings: ${(metrics.sourceWarnings || []).join(' | ') || 'none'}`)
}

main().catch((error) => {
  console.error('[kia-service-dashboard] snapshot capture failed', error)
  process.exit(1)
})
