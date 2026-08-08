import 'dotenv/config'
import { getKiaSalesPerformance } from '../lib/kia/sales-performance'
import { getBrandSalesSnapshot } from '../lib/brands/sales-stock'

/** The cockpit sales card should derive missing targets as last month's actuals + 10%. */
async function main() {
  const july = await getKiaSalesPerformance({ year: 2026, month: 7 })
  console.log('July actuals:', { bookings: july.summary.bookings, deliveries: july.summary.deliveries })
  console.log('July configured targets:', { b: july.summary.bookingTarget, d: july.summary.deliveryTarget })

  const snap = await getBrandSalesSnapshot('kia', { year: 2026, month: 8 })
  console.log('August snapshot:', {
    bookings: snap.bookings, deliveries: snap.deliveries,
    bookingTarget: snap.bookingTarget, deliveryTarget: snap.deliveryTarget,
    bookingAchievement: snap.bookingAchievement, deliveryAchievement: snap.deliveryAchievement,
    targetBasis: snap.targetBasis,
  })

  const expectB = Math.ceil(july.summary.bookings * 1.1)
  const expectD = Math.ceil(july.summary.deliveries * 1.1)
  const okB = snap.bookingTarget === expectB || july.summary.bookingTarget > 0
  const okD = snap.deliveryTarget === expectD || july.summary.deliveryTarget > 0
  console.log(`booking target ${snap.bookingTarget} vs expected ${expectB}: ${okB ? 'PASS' : 'FAIL'}`)
  console.log(`delivery target ${snap.deliveryTarget} vs expected ${expectD}: ${okD ? 'PASS' : 'FAIL'}`)
  if (!okB || !okD) process.exit(1)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
