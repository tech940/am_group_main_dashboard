import 'dotenv/config'

import {
  dispatchDueWalkInFeedbackEmails,
  getEligibleWalkInFeedbackLeads,
} from '../lib/kia/walk-in-leads/feedback-email'

async function main() {
  console.log('[walk-in-feedback-email] Checking for walk-in leads enquired >= 1 hour ago without sent feedback emails...')

  const eligible = await getEligibleWalkInFeedbackLeads()
  console.log(`[walk-in-feedback-email] Found ${eligible.length} eligible customer(s):`)

  for (const lead of eligible) {
    console.log(`  • Lead #${lead.id}: ${lead.customerName} (${lead.email}) | Model: ${lead.model} | Showroom: ${lead.dealerCode} | Enquired: ${lead.createdAt}`)
  }

  if (eligible.length === 0) {
    console.log('[walk-in-feedback-email] No pending feedback emails to send at this moment.')
    return
  }

  console.log('[walk-in-feedback-email] Dispatching feedback emails...')
  const summary = await dispatchDueWalkInFeedbackEmails()

  console.log('\n--- Summary ---')
  console.log(`Eligible: ${summary.eligibleCount}`)
  console.log(`Sent:     ${summary.sentCount}`)
  console.log(`Failed:   ${summary.failedCount}`)
  for (const r of summary.results) {
    console.log(`  [${r.status.toUpperCase()}] ${r.customerName} <${r.email}> ${r.error ? `- ${r.error}` : ''}`)
  }
}

main().catch((error) => {
  console.error('[walk-in-feedback-email] Fatal error:', error)
  process.exitCode = 1
})
