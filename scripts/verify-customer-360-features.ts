/**
 * The five Customer 360 additions of 2026-08-26, each verified against a LIVE customer picked to
 * exercise it: deduped accessories (the feed is ~45% snapshot duplicates), the NVI-aware win-back
 * prompt, the collections flag (worded to never state an amount owed — the feed has no balance
 * column), the premium-carrying renewal prompt, and the live-RO strip (the open-RO feed APPENDS
 * daily batches and never closes a row, so "open" must be cross-checked against ro_billing_report).
 *
 * Read-only. Run: npm run verify:customer-360-features
 */
import 'dotenv/config'
import { getKiaCustomerProfile } from '../lib/kia/customer-profile/reader'
import { parseCustomerKey } from '../lib/kia/customer-profile/identity'
import { buildCustomerTimeline, buildNextBestActions, availableCategories } from '../lib/kia/customer-profile/timeline'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

const inr = (v: number | null | undefined) =>
  (v === null || v === undefined ? '—' : '₹' + Number(v).toLocaleString('en-IN'))

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

const pickKey = async (where: string) => {
  const [row] = await analyticsExecute<{ cid: string; outlet: string }>(sql.raw(`
    WITH b AS (
      SELECT UPPER(BTRIM(s.customerid)) cid,
             UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), s.dealer_code, ''))) outlet,
             UPPER(BTRIM(s.vin_number)) vin
      FROM kia_sales_report s
      WHERE COALESCE(s.vin_number, '') <> '' AND COALESCE(s.customerid, '') <> ''
    )
    SELECT b.cid, b.outlet FROM b WHERE ${where} LIMIT 1`))
  return row ? parseCustomerKey(`cid:${row.outlet}:${row.cid}`)! : null
}

async function main() {
  console.log('1) ACCESSORIES — a buyer with counter sales, deduped')
  const accKey = await pickKey(`EXISTS (
    SELECT 1 FROM kia_accessories_counter_sales_report a
    WHERE UPPER(BTRIM(a.vin)) = b.vin AND a.bill_status <> 'Cancel' AND COALESCE(a.type_of_party,'') <> 'B2B'
    GROUP BY UPPER(BTRIM(a.vin)) HAVING COUNT(*) >= 6)`)
  const accProfile = accKey ? await getKiaCustomerProfile(accKey, {}) : null
  const accVehicle = accProfile?.vehicles.find((v) => (v.accessoriesSpend ?? 0) > 0)
  console.log(`   ${accProfile?.name}: spend ${inr(accVehicle?.accessoriesSpend)} across ${accVehicle?.accessories.length} lines`)
  for (const a of (accVehicle?.accessories || []).slice(0, 3)) console.log(`     ${a.billDate}  ${a.description}  ${inr(a.amount)}`)
  check(Boolean(accVehicle && accVehicle.accessoriesSpend! > 0), 'accessories spend present and positive')
  const seen = new Set((accVehicle?.accessories || []).map((a) => `${a.billNo}|${a.description}|${a.amount}|${a.qty}`))
  check(seen.size === (accVehicle?.accessories || []).length, 'no duplicate lines survived the dedupe')
  const timeline = accProfile ? buildCustomerTimeline(accProfile) : []
  const accEvents = timeline.filter((e) => e.category === 'accessories')
  console.log(`   timeline: ${accEvents.length} accessory event(s); first: "${accEvents[0]?.detail}"`)
  check(accEvents.length > 0 && accEvents.length < (accVehicle?.accessories.length || 99), 'events grouped per bill, not per line')
  check(availableCategories(timeline).includes('accessories'), 'accessories filter pill offered')

  console.log('\n2) NVI — a customer whose only workshop rows are our own inspection')
  const nviKey = await pickKey(`EXISTS (SELECT 1 FROM ro_billing_report r WHERE UPPER(BTRIM(r.vin)) = b.vin)
    AND NOT EXISTS (SELECT 1 FROM ro_billing_report r WHERE UPPER(BTRIM(r.vin)) = b.vin
                    AND UPPER(BTRIM(COALESCE(r.work_type,''))) <> 'NVI')
    AND EXISTS (SELECT 1 FROM kia_sales_report s2 WHERE UPPER(BTRIM(s2.vin_number)) = b.vin
                AND s2.invoice_date IS NOT NULL)`)
  const nviProfile = nviKey ? await getKiaCustomerProfile(nviKey, {}) : null
  const nviVehicle = nviProfile?.vehicles.find((v) => v.nviOnly)
  console.log(`   ${nviProfile?.name}: serviceCount ${nviVehicle?.serviceCount}, nviOnly ${nviVehicle?.nviOnly}`)
  check(Boolean(nviVehicle?.nviOnly), 'vehicle flagged nviOnly')
  const nviActions = nviProfile ? buildNextBestActions(nviProfile) : []
  const winback = nviActions.find((a) => a.title === 'Never serviced with us')
  console.log(`   action: ${winback ? winback.title + ' — ' + winback.reason.slice(0, 90) : '(none — sold <1yr ago is legitimate)'}`)
  const soldYearsAgo = nviVehicle?.invoiceDate && nviVehicle.invoiceDate < new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  if (soldYearsAgo) check(Boolean(winback), 'win-back prompt fires for the NVI-only vehicle')
  else console.log('   (vehicle sold <1 year ago — prompt correctly not due yet)')

  console.log('\n3) UNPAID — a customer with flagged bills')
  const unpaidKey = await pickKey(`EXISTS (SELECT 1 FROM ro_billing_report r WHERE UPPER(BTRIM(r.vin)) = b.vin
    AND r.bill_status IN ('Payment Not Received', 'Partial Paymant Received') AND r.total_amt > 0)`)
  const unpaidProfile = unpaidKey ? await getKiaCustomerProfile(unpaidKey, {}) : null
  const unpaidVehicle = unpaidProfile?.vehicles.find((v) => v.unpaidCount > 0)
  console.log(`   ${unpaidProfile?.name}: ${unpaidVehicle?.unpaidCount} flagged bill(s), billed ${inr(unpaidVehicle?.unpaidBilledTotal)}`)
  check(Boolean(unpaidVehicle && unpaidVehicle.unpaidCount > 0), 'unpaid bills surfaced')
  const unpaidActions = unpaidProfile ? buildNextBestActions(unpaidProfile) : []
  const unpaidAction = unpaidActions.find((a) => a.title.includes('not marked fully collected'))
  console.log(`   action: ${unpaidAction?.reason.slice(0, 130)}`)
  check(Boolean(unpaidAction), 'collections action emitted')
  check(!/(owed|outstanding amount of|balance of)/i.test(unpaidAction?.reason || ''), 'never states an amount owed')
  check(/not recorded/.test(unpaidAction?.reason || ''), 'states that the outstanding amount is not recorded')

  console.log('\n4) RENEWAL — premium named on an expiring policy')
  const renewKey = await pickKey(`EXISTS (SELECT 1 FROM kia_insurance i WHERE UPPER(BTRIM(i.vinno)) = b.vin
    AND UPPER(BTRIM(COALESCE(i.cancelled,''))) <> 'YES' AND COALESCE(i.grosspremium,0) > 0
    AND i.policy_expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60)`)
  const renewProfile = renewKey ? await getKiaCustomerProfile(renewKey, {}) : null
  const renewActions = renewProfile ? buildNextBestActions(renewProfile) : []
  const renewal = renewActions.find((a) => a.title === 'Insurance renewal due' || a.title === 'Insurance has lapsed')
  console.log(`   ${renewProfile?.name}: ${renewal?.title} — ${renewal?.reason.slice(0, 130)}`)
  check(Boolean(renewal), 'renewal action fires inside the widened 90-day window')
  check(/Last premium ₹[\d,]+/.test(renewal?.reason || ''), 'the premium value is named in the prompt')

  console.log('\n5) LIVE RO — a customer whose car is on a ramp right now')
  const liveKey = await pickKey(`EXISTS (SELECT 1 FROM kia_open_ro_yearly o WHERE UPPER(BTRIM(o.vin)) = b.vin
    AND COALESCE(BTRIM(o.closing_date_time),'') = '' AND COALESCE(BTRIM(o.cancel_date),'') = ''
    AND UPPER(BTRIM(COALESCE(o.ro_sub_status,''))) NOT IN ('CLOSED','WORK ENDED')
    AND NOT EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(BTRIM(rb.ro_no)) = UPPER(BTRIM(o.r_o_no))))`)
  const liveProfile = liveKey ? await getKiaCustomerProfile(liveKey, {}) : null
  const ro = liveProfile?.liveRos?.[0]
  console.log(`   ${liveProfile?.name}: RO ${ro?.roNo} · ${ro?.subStatus} · est ${inr(ro?.estimate)} · ${ro?.advisor} · as of ${ro?.asOf}`)
  check(Boolean(ro), 'live RO reaches the profile')
  check(Boolean(ro?.asOf), 'the snapshot date travels with it')
  check((liveProfile?.liveRos || []).every((r) => r.subStatus !== 'Closed' && r.subStatus !== 'Work Ended'), 'no closed rows leak through')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
