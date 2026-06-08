import 'dotenv/config'

import { sendServiceDashboardEmail, getServiceDashboardEmailSettings } from '../lib/reports/service-dashboard-email'

async function main() {
  const settings = await getServiceDashboardEmailSettings()
  if (!settings.enabled) {
    console.log('[service-dashboard-email] skipped: email schedule is disabled')
    return
  }

  const result = await sendServiceDashboardEmail({
    brand: 'kia',
    reportKey: 'service-dashboard',
    dealerCode: settings.defaultDealerCode,
    trigger: 'scheduler',
  })

  console.log(`[service-dashboard-email] sent ${result.fileName} to ${result.recipients.join(', ')}`)
  if (result.cc.length > 0) console.log(`[service-dashboard-email] cc ${result.cc.join(', ')}`)
  if (result.bcc.length > 0) console.log(`[service-dashboard-email] bcc ${result.bcc.join(', ')}`)
  if (result.rejected.length > 0) console.error(`[service-dashboard-email] rejected ${result.rejected.join(', ')}`)
}

main().catch((error) => {
  console.error('[service-dashboard-email] failed:', error)
  process.exitCode = 1
})
