import 'dotenv/config'
import { getKiaBookingDetail, getKiaBookingMatchingVehicles } from '@/lib/kia/bookings'

const APPROVED = '4f22c55b-c0b4-4658-a6e2-62f8b89bab26'

async function main() {
  console.log('start', new Date().toISOString())
  let t0 = performance.now()
  await getKiaBookingDetail(APPROVED)
  console.log('detail cold  :', (performance.now() - t0).toFixed(0), 'ms')
  t0 = performance.now()
  const r = await getKiaBookingMatchingVehicles(APPROVED)
  console.log('matching cold:', (performance.now() - t0).toFixed(0), 'ms  rows=', (r as unknown[]).length)
  for (let i = 0; i < 3; i++) {
    t0 = performance.now(); await getKiaBookingDetail(APPROVED)
    const d = performance.now() - t0
    t0 = performance.now(); await getKiaBookingMatchingVehicles(APPROVED)
    const m = performance.now() - t0
    console.log(`warm#${i} detail=${d.toFixed(0)} matching=${m.toFixed(0)} serial=${(d + m).toFixed(0)} parallel=${Math.max(d, m).toFixed(0)}`)
  }
  process.exit(0)
}
main()
