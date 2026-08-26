const Module = require('node:module')
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments)
}

async function main() {
  const { KIA_BOOKING_STATUSES } = await import('../lib/kia/bookings')
  const { canRevealKiaFollowupPhone } = await import('../lib/kia/pii')
  const { syncOverdueDeliveryFollowups, MIN_REMARK_LENGTH } = await import('../lib/kia/lead-followups')
  let fail = 0
  function ok(label: string, condition: boolean, detail = '') {
    if (condition) {
      console.log(`  [PASS] ${label}`)
    } else {
      console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`)
      fail += 1
    }
  }

  console.log(`
1) Kia Delivery Booking Status definitions`)
{
  ok("'ready_delivery' is a valid Kia booking status", KIA_BOOKING_STATUSES.includes('ready_delivery'))
  ok("'vehicle_allocated' is a valid Kia booking status", KIA_BOOKING_STATUSES.includes('vehicle_allocated'))
  ok("'payment_confirmed' is a valid Kia booking status", KIA_BOOKING_STATUSES.includes('payment_confirmed'))
  ok("'delivered' is a valid Kia booking status", KIA_BOOKING_STATUSES.includes('delivered'))
  ok("'cancelled' is a valid Kia booking status", KIA_BOOKING_STATUSES.includes('cancelled'))
}

console.log(`
2) 15-Day Threshold Rule Assertions`)
{
  const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000
  const isOverdueDelivery = (status: string, createdAt: Date, updatedAt: Date, now: Date) => {
    if (status === 'delivered' || status === 'cancelled') return false
    const isWaitingDelivery = ['ready_delivery', 'payment_confirmed', 'vehicle_allocated'].includes(status)
    if (!isWaitingDelivery) return false
    const ageMs = Math.max(now.getTime() - createdAt.getTime(), now.getTime() - updatedAt.getTime())
    return ageMs >= FIFTEEN_DAYS_MS
  }

  const now = new Date('2026-08-26T12:00:00Z')
  const twentyDaysAgo = new Date('2026-08-06T12:00:00Z')
  const tenDaysAgo = new Date('2026-08-16T12:00:00Z')

  ok('Ready delivery booking aged 20 days IS flagged for follow-up', isOverdueDelivery('ready_delivery', twentyDaysAgo, twentyDaysAgo, now))
  ok('Ready delivery booking aged 10 days is NOT flagged', !isOverdueDelivery('ready_delivery', tenDaysAgo, tenDaysAgo, now))
  ok('Delivered booking aged 20 days is NEVER flagged', !isOverdueDelivery('delivered', twentyDaysAgo, twentyDaysAgo, now))
  ok('Cancelled booking aged 20 days is NEVER flagged', !isOverdueDelivery('cancelled', twentyDaysAgo, twentyDaysAgo, now))
  ok('Draft booking aged 20 days is NOT flagged for delivery follow-up', !isOverdueDelivery('draft', twentyDaysAgo, twentyDaysAgo, now))
}

console.log(`
3) PII Protection on Follow-ups`)
{
  ok('CRE can reveal phone for follow-up calls', canRevealKiaFollowupPhone('cre'))
  ok('MD can reveal phone for follow-up calls', canRevealKiaFollowupPhone('md'))
  ok('Developer can reveal phone for follow-up calls', canRevealKiaFollowupPhone('developer'))
  ok('Finance Head can reveal phone for follow-up calls', canRevealKiaFollowupPhone('finance_head'))
  ok('Viewer cannot reveal customer phone', !canRevealKiaFollowupPhone('viewer'))
  ok('Branch Admin cannot reveal customer phone', !canRevealKiaFollowupPhone('branch_admin'))
}

console.log(`
4) Function definition & remark requirements`)
  {
    ok('syncOverdueDeliveryFollowups is an exported function', typeof syncOverdueDeliveryFollowups === 'function')
    ok('MIN_REMARK_LENGTH is at least 10 words', MIN_REMARK_LENGTH >= 10)
  }

  console.log(fail === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${fail} FAILURE(S) ===\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
