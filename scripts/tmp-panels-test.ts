import 'dotenv/config'
import { getKiaConversionPanel, getKiaExchangePanel, getKiaAccessoriesPanel } from '../lib/kia/retail-review-panels'
const p = (n: number) => `${n.toFixed(1)}%`
async function main() {
  const t0 = Date.now()
  const c = await getKiaConversionPanel(2026)
  console.log(`conversion: ${Date.now()-t0}ms`)
  console.log('DECK Jammu: ENQ 3278 TD 1824 BKG 390 RET 263 | 55.6% 11.9% 8.0%')
  console.log('DECK Udham: ENQ 1645 TD  833 BKG 178 RET 104 | 50.6% 10.8% 6.3%')
  for (const o of c.outlets) {
    const t = o.total
    console.log(`  ${o.outlet}: ENQ ${t.enquiries} TD ${t.testDrives} BKG ${t.bookings} RET ${t.retails} | ${p(t.e2td)} ${p(t.e2bkg)} ${p(t.e2ret)}`)
    for (const s of o.sources.slice(0,7)) console.log(`     ${s.label.padEnd(12)} ENQ ${String(s.enquiries).padStart(5)} TD ${String(s.testDrives).padStart(5)} BKG ${String(s.bookings).padStart(4)} RET ${String(s.retails).padStart(4)}`)
  }
  const e = await getKiaExchangePanel(2026)
  console.log('\nEXCHANGE (deck Jan-Jun: exchEnq 45/16/38/53/80/69, ratio 6/3/5/7/10/12%, eval 23/13/34/43/40/36)')
  for (const m of e.months.slice(0,7)) console.log(`  M${m.month}: enq ${m.totalEnquiries} exchEnq ${m.exchangeEnquiries} (${p(m.exchangeEnquiryRatio)}) eval ${m.evaluations} (${p(m.evaluationRatio)}) exchNet ${m.exchangeNet} retailNet ${m.retailNet} pen ${p(m.exchangePenetration)}`)
  const a = await getKiaAccessoriesPanel(2026)
  console.log('\nACCESSORIES (deck: Accy/Car MRP 13461/15591/16440/14021/15458/15792, NDP 9048/10407/10877/9346/10211/10380)')
  for (const m of a.months.slice(0,7)) console.log(`  M${m.month}: perCarMRP ${Math.round(m.perCarMrp)} perCarNDP ${Math.round(m.perCarNdp)} vehicles ${m.vehicleRetail}`)
  console.log('  unavailable:', a.unavailableFields.join(', '))
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})
