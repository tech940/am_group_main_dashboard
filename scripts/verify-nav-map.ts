/**
 * Proves the registry-generated href→permission map equals the map currently hardcoded in
 * components/layout/sidebar.tsx, so swapping the sidebar to the generated map is provably
 * behavior-preserving.
 *
 * Run:  npx tsx scripts/verify-nav-map.ts
 */
import { SIDEBAR_PERMISSION_BY_HREF } from '../lib/permissions/navigation'

// Verbatim snapshot of the map currently in components/layout/sidebar.tsx (the baseline we
// must reproduce exactly).
const CURRENT: Record<string, string> = {
  '/cockpit': 'cockpit.view',
  '/delegation-tasks': 'delegation_tasks.view',
  '/purchase-orders': 'purchase_orders.view',
  '/petty-cash': 'petty_cash.view',
  '/am-finance': 'am_finance.view',
  '/ca': 'ca.view',
  '/finance': 'finance.view',
  '/brands/kia/business-excellence': 'kia.business_excellence.view',
  '/brands/kia/business-excellence/executive-dashboard': 'kia.business_excellence.view',
  '/brands/kia/business-excellence/overview': 'kia.business_excellence.view',
  '/brands/kia/service-appointment': 'kia.service_appointment.view',
  '/brands/kia/demo-job-cards': 'kia.demo_job_cards.view',
  '/brands/kia/demo-cars-list': 'kia.demo_cars_list.view',
  '/brands/kia/sales-report': 'kia.sales_report.view',
  '/brands/kia/stock-report': 'kia.stock_report.view',
  '/brands/kia/sales-performance': 'kia.sales_performance.view',
  '/brands/kia/call-center': 'kia.call_center.view',
  '/brands/kia/follow-ups': 'kia.lead_followups.view',
  '/brands/kia/call-analytics': 'kia.call_analytics.view',
  '/brands/kia/bookings': 'kia.bookings.view',
  '/brands/kia/payment-approvals': 'kia.approvals.view',
  '/brands/kia/proforma': 'kia.proforma.view',
  '/brands/hyundai/business-excellence': 'hyundai.business_excellence.view',
  '/brands/hyundai/business-excellence/executive-dashboard': 'hyundai.business_excellence.view',
  '/brands/hyundai/business-excellence/overview': 'hyundai.business_excellence.view',
  '/brands/hyundai/service-appointment': 'hyundai.service_appointment.view',
  '/brands/hyundai/demo-job-cards': 'hyundai.demo_job_cards.view',
  '/brands/hyundai/demo-cars-list': 'hyundai.demo_cars_list.view',
  '/brands/hyundai/proforma': 'hyundai.proforma.view',
  '/brands/hyundai/warranty-list': 'hyundai.warranty_list.view',
  '/brands/hyundai/warranty-claim-list': 'hyundai.warranty_claim_list.view',
  '/brands/platinum/business-excellence': 'platinum.business_excellence.view',
  '/brands/platinum/business-excellence/executive-dashboard': 'platinum.business_excellence.view',
  '/brands/platinum/business-excellence/overview': 'platinum.business_excellence.view',
  '/brands/platinum/service-appointment': 'platinum.service_appointment.view',
  '/brands/platinum/demo-job-cards': 'platinum.demo_job_cards.view',
  '/brands/platinum/demo-cars-list': 'platinum.demo_cars_list.view',
  '/brands/platinum/proforma': 'platinum.proforma.view',
  '/brands/platinum/warranty-list': 'platinum.warranty_list.view',
  '/brands/platinum/warranty-claim-list': 'platinum.warranty_claim_list.view',
  '/brands/mg/business-excellence/overview': 'mg.business_excellence.view',
  '/brands/mg/service-appointment': 'mg.service_appointment.view',
  '/brands/mg/demo-job-cards': 'mg.demo_job_cards.view',
  '/brands/mg/demo-cars-list': 'mg.demo_cars_list.view',
  '/brands/mg/proforma': 'mg.proforma.view',
  '/admin': 'user_management.view',
}

let failures = 0
const generated = SIDEBAR_PERMISSION_BY_HREF

for (const [href, key] of Object.entries(CURRENT)) {
  if (generated[href] !== key) {
    failures++
    console.log(`  [FAIL] "${href}" expected ${key}, generated ${generated[href] ?? '(missing)'}`)
  }
}
for (const href of Object.keys(generated)) {
  if (!(href in CURRENT)) {
    failures++
    console.log(`  [FAIL] generated extra href "${href}" -> ${generated[href]} (not in current map)`)
  }
}

console.log(`\nCurrent entries: ${Object.keys(CURRENT).length} · Generated entries: ${Object.keys(generated).length}`)
console.log(failures === 0 ? '=== NAV MAP MATCHES — swap is behavior-preserving ===' : `=== ${failures} MISMATCH(ES) ===`)
process.exit(failures === 0 ? 0 : 1)
