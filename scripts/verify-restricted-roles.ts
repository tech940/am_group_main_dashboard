/**
 * Verifies that the resolution layer (post Phase-3 reshaping) produces the intended effective
 * visibility for each role — especially the restricted roles that were formerly hardcoded in
 * the sidebar. Uses the real `resolveEffectiveSnapshot` with each role's real template as the
 * base (via getTemplateMap), no DB.
 *
 * Run:  npm run verify:roles
 */
import 'dotenv/config'
import { getTemplateMap, type PermissionRole } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot } from '../lib/permissions/service'

let failures = 0
function check(label: string, got: boolean | undefined, want: boolean) {
  const ok = got === want
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label} — got ${got}, want ${want}`)
}

type Case = { role: PermissionRole; brand: string; label: string; expect: Record<string, boolean> }

const CASES: Case[] = [
  { role: 'branch_admin', brand: 'kia', label: 'Branch Admin → Petty Cash only', expect: {
    'petty_cash.view': true, 'kia.business_excellence.view': false, 'kia.bookings.view': false } },
  { role: 'sales_executive', brand: 'kia', label: 'Sales Executive → Bookings only', expect: {
    'kia.view': true, 'kia.bookings.view': true, 'kia.proforma.view': true,
    'kia.business_excellence.view': false, 'kia.sales_report.view': false, 'kia.stock_management.view': false } },
  { role: 'manager', brand: 'kia', label: 'Manager → sees brand, not sensitive reports', expect: {
    'kia.business_excellence.view': true, 'kia.bookings.view': true,
    'kia.sales_report.view': false, 'kia.stock_report.view': false } },
  { role: 'service_manager', brand: 'kia', label: 'Service Manager → sees brand, not reports', expect: {
    'kia.business_excellence.view': true, 'kia.sales_report.view': false } },
  { role: 'viewer', brand: 'kia', label: 'Employee/Viewer → brand service, not reports', expect: {
    'kia.service_appointment.view': true, 'kia.sales_report.view': false } },
  { role: 'md', brand: 'kia', label: 'MD → everything incl. sensitive reports', expect: {
    'kia.business_excellence.view': true, 'kia.sales_report.view': true, 'kia.stock_report.view': true } },
  { role: 'eba', brand: 'kia', label: 'EBA → global incl. sensitive reports', expect: {
    'kia.business_excellence.view': true, 'kia.sales_report.view': true } },
  { role: 'ceo', brand: 'kia', label: 'CEO → global but NOT sensitive reports', expect: {
    'kia.business_excellence.view': true, 'kia.sales_report.view': false, 'kia.stock_report.view': false } },
  { role: 'developer', brand: 'kia', label: 'Developer → absolute', expect: {
    'kia.sales_report.view': true, 'access_control.view': true } },
  { role: 'manager', brand: 'hyundai', label: 'Manager (Hyundai) → brand default projects', expect: {
    'hyundai.business_excellence.view': true, 'kia.business_excellence.view': false } },
  // CRM / IDT are single-purpose: Bookings only, nothing else. They are deny-by-default
  // (family 'special' + TEMPLATE_ONLY_ROLES) — without the template-only membership the KIA brand
  // default would blanket-grant them every non-restricted kia.* key, so these cases are what proves
  // the deny-by-default actually holds.
  { role: 'crm', brand: 'kia', label: 'CRM → Bookings only (delivery is role-gated, not permission-gated)', expect: {
    'kia.bookings.view': true, 'kia.bookings.edit': true,
    'kia.business_excellence.view': false, 'kia.sales_report.view': false,
    'kia.stock_management.view': false, 'kia.proforma.view': false } },
  { role: 'idt', brand: 'kia', label: 'IDT → Bookings only (allotment is role-gated, not permission-gated)', expect: {
    'kia.bookings.view': true, 'kia.bookings.edit': true,
    'kia.business_excellence.view': false, 'kia.sales_report.view': false,
    'kia.stock_management.view': false, 'kia.proforma.view': false } },
  // CRE owns Booking Follow-ups. Deliberately NOT call_analytics — that leaderboard ranks CREs,
  // same reason sales_executive is kept off it.
  { role: 'cre', brand: 'kia', label: 'CRE → Booking Follow-ups + read-only bookings, nothing else', expect: {
    'kia.lead_followups.view': true, 'kia.lead_followups.create': true, 'kia.lead_followups.edit': true,
    'kia.bookings.view': true, 'kia.bookings.edit': false,
    'kia.call_analytics.view': false, 'kia.business_excellence.view': false,
    'kia.sales_report.view': false, 'kia.stock_management.view': false } },
]

console.log('\n=== Phase 3 resolution: restricted-role matrix (no DB) ===\n')
for (const c of CASES) {
  console.log(`${c.label}  [${c.role} · ${c.brand}]`)
  const snap = resolveEffectiveSnapshot(getTemplateMap(c.role), {}, c.role, c.brand)
  for (const [key, want] of Object.entries(c.expect)) check(key, snap.effective[key], want)
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
