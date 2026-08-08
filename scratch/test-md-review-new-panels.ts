import 'dotenv/config'
import { getKiaBookingsPanel, getKiaEnquiryPanel } from '../lib/kia/retail-review-pipeline'
import { getKiaAccessoriesPanel, getKiaConversionPanel } from '../lib/kia/retail-review-panels'

async function main() {
  const year = 2026

  const bookings = await getKiaBookingsPanel(year)
  console.log('--- bookings monthly (combined, Jan-Aug) ---')
  console.log(bookings.combined.months.slice(0, 8).map((m) => `${m.month}: bkd=${m.booked} cxl=${m.cancelled} ret=${m.retailed} open=${m.open}`).join('\n'))
  console.log('combined:', { booked: bookings.combined.booked, cancelled: bookings.combined.cancelled, cancelRate: bookings.combined.cancelRate.toFixed(1) })
  console.log('backlog total:', JSON.stringify(bookings.backlog.total))
  console.log('backlog outlets:', bookings.backlog.outlets.map((o) => `${o.outlet}: open=${o.open} amt=${Math.round(o.amountReceived)} overdue=${o.overdue} aging=${JSON.stringify(o.aging)}`).join(' | '))
  console.log('top models:', bookings.backlog.topModels.map((m) => `${m.model}=${m.count}`).join(', '))

  const enquiries = await getKiaEnquiryPanel(year)
  console.log('\n--- enquiry model funnel ---')
  for (const m of enquiries.models) console.log(`  ${m.model}: enq=${m.enquiries} td=${m.testDrives} bkg=${m.bookings} ret=${m.retails} e2ret=${m.e2ret.toFixed(1)}%`)
  console.log('total:', JSON.stringify(enquiries.modelTotal))
  console.log('lost months (Jan-Aug):', enquiries.lostMonths.slice(0, 8).map((m) => `${m.month}:${m.lost}/${m.enquiries}`).join(' '))
  console.log('lost reasons:', enquiries.lostReasons.map((r) => `${r.reason}=${r.count}`).join(', '))

  const acc = await getKiaAccessoriesPanel(year)
  console.log('\n--- accessories topItems ---')
  for (const i of acc.topItems.slice(0, 5)) console.log(`  ${i.item}: qty=${i.qty} ndp=${Math.round(i.ndp)}`)

  // Consistency: conversion panel total enquiries should equal enquiry panel total (same cohort)
  const conv = await getKiaConversionPanel(year)
  const convEnq = conv.outlets.reduce((s, o) => s + o.total.enquiries, 0)
  console.log(`\ncross-check: conversion enq=${convEnq} vs model-funnel enq=${enquiries.modelTotal.enquiries} -> ${convEnq === enquiries.modelTotal.enquiries ? 'MATCH' : 'check outlet filter (conversion is per known outlet; funnel is all)'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
