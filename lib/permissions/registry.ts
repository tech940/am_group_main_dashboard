import type { AppUser } from '@/lib/auth/app-user'

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'audit'] as const

export type PermissionAction = typeof PERMISSION_ACTIONS[number]
export type PermissionRole = AppUser['role']

export type PermissionGroupDefinition = {
  key: string
  name: string
  parentKey: string | null
  description: string
  sortOrder: number
  actions: PermissionAction[]
}

export type PermissionDefinition = {
  key: string
  groupKey: string
  label: string
  description: string
  resource: string
  action: PermissionAction
  sortOrder: number
}

export const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  {
    key: 'cockpit',
    name: 'Group Cockpit',
    parentKey: null,
    description: 'Executive cross-brand cockpit: group service revenue, approved cash, and KIA sales & stock, month-to-date.',
    sortOrder: 5,
    actions: ['view'],
  },
  {
    // Only 'view' — the section is broadly visible (in DEFAULT_VISIBLE_SECTIONS) so everyone sees
    // their own task inbox. WHO may delegate is gated by ROLE in lib/delegation/access.ts, not by a
    // permission (a permission cannot restrict an action here).
    key: 'delegation_tasks',
    name: 'Delegation Tasks',
    parentKey: null,
    description: 'Cross-brand top-down task delegation: leaders assign action items down to staff and track them to completion.',
    sortOrder: 6,
    actions: ['view'],
  },
  {
    key: 'scrap_erp',
    name: 'Scrap ERP',
    parentKey: null,
    description: 'Scrap material disposal, dynamic master records, reports, valuation & sales analytics.',
    sortOrder: 7,
    actions: ['view'],
  },
  {
    key: 'insurance_analysis',
    name: 'Insurance Analysis',
    parentKey: null,
    description: 'Hyundai and Platinum insurance policy analytics, executive KPIs, revenue, company performance, and dealer-wise breakdowns.',
    sortOrder: 8,
    actions: ['view'],
  },
  {
    key: 'kia',
    name: 'KIA',
    parentKey: null,
    description: 'AM KIA analytics and workshop modules.',
    sortOrder: 10,
    actions: ['view'],
  },
  {
    key: 'tata',
    name: 'Tata',
    parentKey: null,
    description: 'AM Tata branch modules.',
    sortOrder: 11,
    actions: ['view'],
  },
  {
    key: 'hyundai',
    name: 'Hyundai',
    parentKey: null,
    description: 'AM Hyundai branch modules.',
    sortOrder: 12,
    actions: ['view'],
  },
  {
    key: 'platinum',
    name: 'Platinum',
    parentKey: null,
    description: 'AM Platinum branch modules.',
    sortOrder: 13,
    actions: ['view'],
  },
  {
    key: 'honda',
    name: 'Honda',
    parentKey: null,
    description: 'AM Diamond Honda branch modules.',
    sortOrder: 14,
    actions: ['view'],
  },
  {
    key: 'ktm',
    name: 'KTM',
    parentKey: null,
    description: 'AM KTM branch modules.',
    sortOrder: 15,
    actions: ['view'],
  },
  {
    key: 'triumph',
    name: 'Triumph',
    parentKey: null,
    description: 'AM Triumph branch modules.',
    sortOrder: 16,
    actions: ['view'],
  },
  {
    key: 'bajaj',
    name: 'Bajaj',
    parentKey: null,
    description: 'AM Bajaj branch modules.',
    sortOrder: 17,
    actions: ['view'],
  },
  {
    key: 'mg',
    name: 'MG',
    parentKey: null,
    description: 'AM MG branch modules.',
    sortOrder: 18,
    actions: ['view'],
  },
  {
    key: 'kia.service',
    name: 'Service',
    parentKey: 'kia',
    description: 'AM KIA service department modules.',
    sortOrder: 19,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence',
    name: 'Business Excellence',
    parentKey: 'kia.service',
    description: 'Executive Business Excellence dashboards and reports.',
    sortOrder: 20,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.ro_billing',
    name: 'RO Billing',
    parentKey: 'kia.business_excellence',
    description: 'RO Billing Report tables, KPIs, and trends.',
    sortOrder: 21,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.workshop_performance',
    name: 'Workshop Performance',
    parentKey: 'kia.business_excellence',
    description: 'Workshop performance KPIs, service type tables, and revenue cards.',
    sortOrder: 22,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.open_ro',
    name: 'Open RO',
    parentKey: 'kia.business_excellence',
    description: 'Open repair order aging, delay reasons, and WIP controls.',
    sortOrder: 23,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.complaints',
    name: 'Complaints',
    parentKey: 'kia.business_excellence',
    description: 'Complaint analytics, movement, and customer complaint register.',
    sortOrder: 24,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.rsa',
    name: 'RSA',
    parentKey: 'kia.business_excellence',
    description: 'RSA add-on analytics sourced from RSA report data.',
    sortOrder: 25,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.ew',
    name: 'EW',
    parentKey: 'kia.business_excellence',
    description: 'Extended warranty analytics sourced from EW report data.',
    sortOrder: 26,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.mcp',
    name: 'MCP',
    parentKey: 'kia.business_excellence',
    description: 'MCP analytics sourced from MCP report data.',
    sortOrder: 27,
    actions: ['view'],
  },
  {
    key: 'kia.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'kia.service',
    description: 'Demo vehicle aging, alerts, and job card analytics.',
    sortOrder: 30,
    actions: ['view'],
  },
  {
    key: 'kia.service_appointment',
    name: 'Service Appointment',
    parentKey: 'kia.service',
    description: 'AM KIA service appointment register and calendar.',
    sortOrder: 32,
    actions: ['view'],
  },
  {
    key: 'kia.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'kia.service',
    description: 'Active test-drive demo stock list and vehicle remarks tracking.',
    sortOrder: 31,
    actions: ['view', 'edit'],
  },
  {
    key: 'kia.proforma',
    name: 'Kia Proforma',
    parentKey: 'kia.service',
    description: 'Kia proforma generation, approvals, finance remarks, user database, and analytics.',
    sortOrder: 35,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'kia.sales',
    name: 'Sales',
    parentKey: 'kia',
    description: 'AM KIA sales department modules.',
    sortOrder: 36,
    actions: ['view'],
  },
  {
    key: 'kia.sales_report',
    name: 'Sales Report',
    parentKey: 'kia.sales',
    description: 'AM KIA sales report analytics workspace, charts, and raw report tables.',
    sortOrder: 37,
    actions: ['view'],
  },
  {
    key: 'kia.stock_report',
    name: 'Stock Report',
    parentKey: 'kia.sales',
    description: 'AM KIA vehicle stock analytics workspace and purchase report table.',
    sortOrder: 38,
    actions: ['view'],
  },
  {
    key: 'kia.sales_performance',
    name: 'Sales Performance',
    parentKey: 'kia.sales',
    description: 'AM KIA consultant sales targets and leaderboard (bookings, deliveries, conversion).',
    sortOrder: 38,
    actions: ['view'],
  },
  {
    key: 'kia.stock_management',
    name: 'Stock Management',
    parentKey: 'kia.sales',
    description: 'AM KIA local stock status management for BBND and Retail vehicles.',
    sortOrder: 39,
    actions: ['view', 'edit', 'audit'],
  },
  {
    key: 'kia.bookings',
    name: 'Bookings CRM',
    parentKey: 'kia.sales',
    description: 'AM KIA customer booking, proforma, vehicle allocation, and delivery workflow.',
    sortOrder: 40,
    actions: ['view', 'create', 'edit', 'audit'],
  },
  {
    // Gates BOTH sidebar pages that check kia.approvals.view: "Vendor Payments" (/brands/kia/
    // payment-approvals) and "Vendor Registry" (/brands/kia/vendors). Without this group the key
    // kia.approvals.view did not exist, so the section was ungrantable and MISSING from the Access
    // Map (reachable only by super-admins). Restricted-by-default (not in DEFAULT_VISIBLE_SECTIONS)
    // — grant it per-user in Admin → Access. Only 'view' is used anywhere in code.
    key: 'kia.approvals',
    name: 'Vendor Payments & Registry',
    parentKey: 'kia.sales',
    description: 'AM KIA vendor payment approvals and the vendor registry.',
    sortOrder: 42,
    actions: ['view'],
  },
  {
    key: 'kia.booking_payment_history',
    name: 'Booking Payment History',
    parentKey: 'kia.sales',
    description: 'AM KIA booking payment receipts and daily collections register.',
    sortOrder: 44,
    actions: ['view'],
  },
  {
    // Read-only audit trail over kia_vehicle_allocations. Restricted-by-default (not in
    // DEFAULT_VISIBLE_SECTIONS): it names the user who allocated each vehicle and why it was pulled
    // back, which is oversight information, not day-to-day booking work. Only 'view' exists because
    // nothing may edit an audit trail — see app/api/brands/kia/allocation-history/route.ts.
    key: 'kia.allocation_history',
    name: 'Vehicle Allocation History',
    parentKey: 'kia.sales',
    description: 'AM KIA permanent audit trail of every vehicle allocation and release back to free stock.',
    sortOrder: 45,
    actions: ['view'],
  },
  {
    key: 'kia.call_center',
    name: 'Call Center',
    parentKey: 'kia.sales',
    description: 'AM KIA masked click-to-call — agents call customers without ever seeing the number.',
    sortOrder: 41,
    actions: ['view'],
  },
  {
    key: 'kia.lead_followups',
    name: 'Follow-ups',
    parentKey: 'kia.sales',
    description: 'AM KIA lead follow-up pipeline — scheduled next-touch on bookings so no lead goes cold.',
    sortOrder: 42,
    actions: ['view', 'create', 'edit'],
  },
  {
    key: 'kia.call_analytics',
    name: 'Call & Follow-up Analytics',
    parentKey: 'kia.sales',
    description: 'AM KIA manager analytics — call volume, contact rate, dispositions, follow-up completion and leaderboards.',
    sortOrder: 43,
    actions: ['view'],
  },
  {
    key: 'kia.h_promise',
    name: 'H Promise',
    parentKey: 'kia',
    description: 'AM KIA H Promise department modules.',
    sortOrder: 41,
    actions: ['view'],
  },
  {
    key: 'hyundai.service',
    name: 'Service',
    parentKey: 'hyundai',
    description: 'AM Hyundai service department modules.',
    sortOrder: 120,
    actions: ['view'],
  },
  {
    key: 'hyundai.repair_orders',
    name: 'Repair Orders',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai repair order register inside Business Excellence.',
    sortOrder: 123,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence',
    name: 'Business Excellence',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai Business Excellence dashboards and reports.',
    sortOrder: 121,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.ro_billing',
    name: 'RO Billing',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai RO Billing Report tables, KPIs, and trends.',
    sortOrder: 124,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.workshop_performance',
    name: 'Workshop Performance',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai workshop performance KPIs and service type tables.',
    sortOrder: 125,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.open_ro',
    name: 'Open RO',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai open repair order aging and WIP controls.',
    sortOrder: 126,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.complaints',
    name: 'Complaints',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai complaint analytics and customer register.',
    sortOrder: 127,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.rsa',
    name: 'RSA',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai RSA add-on analytics.',
    sortOrder: 128,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.ew',
    name: 'EW',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai extended warranty analytics.',
    sortOrder: 129,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.mcp',
    name: 'MCP',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai MCP analytics.',
    sortOrder: 130,
    actions: ['view'],
  },
  {
    key: 'hyundai.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai demo vehicle job card tracking.',
    sortOrder: 131,
    actions: ['view'],
  },
  {
    key: 'hyundai.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai active demo stock list and vehicle details tracking.',
    sortOrder: 132,
    actions: ['view', 'edit'],
  },
  {
    key: 'hyundai.service_appointment',
    name: 'Service Appointment',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai service appointment calendar.',
    sortOrder: 133,
    actions: ['view'],
  },
  {
    key: 'hyundai.warranty_list',
    name: 'Claim YTP',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai Claim YTP tracking, SLA remarks, and audit history.',
    sortOrder: 134,
    actions: ['view', 'edit', 'audit'],
  },
  {
    key: 'hyundai.warranty_claim_list',
    name: 'Warranty Claim List',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai warranty claim tracking, evidence, and management insights.',
    sortOrder: 135,
    actions: ['view', 'edit', 'audit'],
  },
  {
    key: 'hyundai.proforma',
    name: 'Hyundai Proforma',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai proforma generation, approvals, finance remarks, and analytics.',
    sortOrder: 136,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'hyundai.sales',
    name: 'Sales',
    parentKey: 'hyundai',
    description: 'AM Hyundai sales department modules.',
    sortOrder: 137,
    actions: ['view'],
  },
  {
    key: 'hyundai.sales.discount_approvals',
    name: 'Discount Approvals',
    parentKey: 'hyundai.sales',
    description: 'AM Hyundai and Platinum discount approval tracking.',
    sortOrder: 137,
    actions: ['view', 'approve'],
  },
  {
    key: 'hyundai.h_promise',
    name: 'H Promise',
    parentKey: 'hyundai',
    description: 'AM Hyundai H Promise department modules.',
    sortOrder: 138,
    actions: ['view'],
  },
  {
    key: 'platinum.service',
    name: 'Service',
    parentKey: 'platinum',
    description: 'AM Platinum service department modules.',
    sortOrder: 140,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence',
    name: 'Business Excellence',
    parentKey: 'platinum.service',
    description: 'AM Platinum Business Excellence dashboards and reports.',
    sortOrder: 141,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.ro_billing',
    name: 'RO Billing',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum RO Billing Report tables, KPIs, and trends.',
    sortOrder: 142,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.workshop_performance',
    name: 'Workshop Performance',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum workshop performance KPIs and service type tables.',
    sortOrder: 143,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.open_ro',
    name: 'Open RO',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum open repair order aging and WIP controls.',
    sortOrder: 144,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.complaints',
    name: 'Complaints',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum complaint analytics and customer register.',
    sortOrder: 145,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.rsa',
    name: 'RSA',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum RSA add-on analytics.',
    sortOrder: 146,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.ew',
    name: 'EW',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum extended warranty analytics.',
    sortOrder: 147,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.mcp',
    name: 'MCP',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum MCP analytics.',
    sortOrder: 148,
    actions: ['view'],
  },
  {
    key: 'platinum.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'platinum.service',
    description: 'AM Platinum demo vehicle job card tracking.',
    sortOrder: 149,
    actions: ['view'],
  },
  {
    key: 'platinum.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'platinum.service',
    description: 'AM Platinum active demo stock list and vehicle details tracking.',
    sortOrder: 150,
    actions: ['view', 'edit'],
  },
  {
    key: 'platinum.service_appointment',
    name: 'Service Appointment',
    parentKey: 'platinum.service',
    description: 'AM Platinum service appointment calendar.',
    sortOrder: 151,
    actions: ['view'],
  },
  {
    key: 'platinum.proforma',
    name: 'Platinum Proforma',
    parentKey: 'platinum.service',
    description: 'AM Platinum proforma generation, approvals, finance remarks, and analytics.',
    sortOrder: 152,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'platinum.warranty_list',
    name: 'Claim YTP',
    parentKey: 'platinum.service',
    description: 'AM Platinum Claim YTP tracking, SLA remarks, and audit history.',
    sortOrder: 154,
    actions: ['view', 'edit', 'audit'],
  },
  {
    key: 'platinum.warranty_claim_list',
    name: 'Warranty Claim List',
    parentKey: 'platinum.service',
    description: 'AM Platinum warranty claim tracking, evidence, and management insights.',
    sortOrder: 155,
    actions: ['view', 'edit', 'audit'],
  },
  {
    key: 'platinum.sales',
    name: 'Sales',
    parentKey: 'platinum',
    description: 'AM Platinum sales department modules.',
    sortOrder: 153,
    actions: ['view'],
  },
  {
    key: 'platinum.h_promise',
    name: 'H Promise',
    parentKey: 'platinum',
    description: 'AM Platinum H Promise department modules.',
    sortOrder: 154,
    actions: ['view'],
  },
  {
    key: 'mg.service',
    name: 'Service',
    parentKey: 'mg',
    description: 'AM MG service department modules.',
    sortOrder: 160,
    actions: ['view'],
  },
  {
    key: 'mg.business_excellence',
    name: 'Business Excellence',
    parentKey: 'mg.service',
    description: 'AM MG Business Excellence dashboards and reports.',
    sortOrder: 161,
    actions: ['view'],
  },
  {
    key: 'mg.service_appointment',
    name: 'Service Appointment',
    parentKey: 'mg.service',
    description: 'AM MG service appointment calendar.',
    sortOrder: 162,
    actions: ['view'],
  },
  {
    key: 'mg.proforma',
    name: 'MG Proforma',
    parentKey: 'mg.service',
    description: 'AM MG proforma generation, approvals, finance remarks, and analytics.',
    sortOrder: 163,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'mg.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'mg.service',
    description: 'AM MG demo vehicle job card tracking.',
    sortOrder: 164,
    actions: ['view'],
  },
  {
    key: 'mg.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'mg.service',
    description: 'AM MG active demo stock list and vehicle details tracking.',
    sortOrder: 165,
    actions: ['view', 'edit'],
  },
  {
    key: 'mg.sales',
    name: 'Sales',
    parentKey: 'mg',
    description: 'AM MG sales department modules.',
    sortOrder: 166,
    actions: ['view'],
  },
  {
    key: 'mg.h_promise',
    name: 'H Promise',
    parentKey: 'mg',
    description: 'AM MG H Promise department modules.',
    sortOrder: 167,
    actions: ['view'],
  },
  {
    key: 'purchase_orders',
    name: 'Purchase Orders',
    parentKey: null,
    description: 'Purchase order workflow and approvals.',
    sortOrder: 40,
    actions: ['view', 'create', 'edit', 'delete', 'approve'],
  },
  {
    key: 'finance_orders',
    name: 'Finance Orders',
    parentKey: null,
    description: 'Finance order workflow, accounts verification, and approvals.',
    sortOrder: 50,
    actions: ['view', 'create', 'edit', 'delete', 'approve'],
  },
  {
    key: 'petty_cash',
    name: 'Petty Cash',
    parentKey: null,
    description: 'Petty cash requests, allocations, expense approvals, ledger, and reports.',
    sortOrder: 52,
    actions: ['view', 'create', 'edit', 'approve', 'audit'],
  },
  {
    key: 'am_finance',
    name: 'AM Finance',
    parentKey: null,
    description: 'Finance sheet register, payout status, bank performance analytics, and entry form.',
    sortOrder: 55,
    actions: ['view', 'create', 'edit', 'audit'],
  },
  {
    key: 'ca',
    name: 'CA',
    parentKey: null,
    description: 'Read-only chartered-accountant view of approved purchase orders and petty cash, branch-wise.',
    sortOrder: 56,
    actions: ['view'],
  },
  {
    key: 'finance',
    name: 'Finance',
    parentKey: null,
    description: 'Customer vehicle-financing workflow: final proforma approval, financing status/timeline, bank management, remarks, and completion.',
    sortOrder: 57,
    // 'view' gates the section + sidebar; 'approve' gates the final finance approval + all proforma
    // finance mutations; 'edit' gates the post-delivery payout ledger — its own key so payout
    // editing can be granted WITHOUT granting proforma approval authority.
    actions: ['view', 'approve', 'edit'],
  },
  {
    key: 'reports',
    name: 'Reports',
    parentKey: null,
    description: 'Shared operational reports and exports.',
    sortOrder: 60,
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'user_management',
    name: 'User Management',
    parentKey: null,
    description: 'User creation, profile management, branch, brand, and role assignment.',
    sortOrder: 70,
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'access_control',
    name: 'Access Control',
    parentKey: null,
    description: 'Admin permission center and user access overrides.',
    sortOrder: 80,
    actions: ['view', 'edit'],
  },
  {
    key: 'admin_audit',
    name: 'Admin Audit',
    parentKey: null,
    description: 'Scoped user lifecycle and permission administration history.',
    sortOrder: 85,
    actions: ['view'],
  },
  {
    key: 'dashboard_settings',
    name: 'Dashboard Settings',
    parentKey: null,
    description: 'Application settings, backup configuration, and dashboard preferences.',
    sortOrder: 90,
    actions: ['view', 'edit'],
  },
]

// Single source of truth for the route each navigable section lives at. The sidebar's
// href→permission gating map and route guards are generated from this (see
// lib/permissions/navigation.ts), so adding a section means adding it here — not editing a
// separate hand-maintained map in the sidebar. `aliases` are additional paths that resolve to
// the same section (e.g. a Business Excellence landing page vs. its /overview route).
export const SECTION_ROUTES: Record<string, { href: string; aliases?: string[] }> = {
  cockpit: { href: '/cockpit' },
  delegation_tasks: { href: '/delegation-tasks' },
  purchase_orders: { href: '/purchase-orders' },
  petty_cash: { href: '/petty-cash' },
  am_finance: { href: '/am-finance' },
  ca: { href: '/ca' },
  finance: { href: '/finance' },
  scrap_erp: { href: '/scrap-erp' },
  insurance_analysis: { href: '/insurance' },
  'kia.booking_payment_history': { href: '/brands/kia/booking-payment-history' },
  'kia.business_excellence': { href: '/brands/kia/business-excellence', aliases: ['/brands/kia/business-excellence/executive-dashboard', '/brands/kia/business-excellence/overview'] },
  'kia.service_appointment': { href: '/brands/kia/service-appointment' },
  'kia.demo_job_cards': { href: '/brands/kia/demo-job-cards' },
  'kia.demo_cars_list': { href: '/brands/kia/demo-cars-list' },
  'kia.sales_report': { href: '/brands/kia/sales-report' },
  'kia.stock_report': { href: '/brands/kia/stock-report' },
  'kia.sales_performance': { href: '/brands/kia/sales-performance' },
  'kia.call_center': { href: '/brands/kia/call-center' },
  'kia.lead_followups': { href: '/brands/kia/follow-ups' },
  // Lives as a TAB inside Bookings (the Kia Proforma shell), not as its own sidebar item. The old
  // standalone route still resolves and redirects here, so existing links keep working.
  'kia.allocation_history': { href: '/brands/kia/proforma/allocation-history', aliases: ['/brands/kia/allocation-history'] },
  'kia.call_analytics': { href: '/brands/kia/call-analytics' },
  'kia.bookings': { href: '/brands/kia/bookings' },
  'kia.approvals': { href: '/brands/kia/payment-approvals', aliases: ['/brands/kia/vendors'] },
  'kia.proforma': { href: '/brands/kia/proforma' },
  'hyundai.business_excellence': { href: '/brands/hyundai/business-excellence', aliases: ['/brands/hyundai/business-excellence/executive-dashboard', '/brands/hyundai/business-excellence/overview'] },
  'hyundai.service_appointment': { href: '/brands/hyundai/service-appointment' },
  'hyundai.demo_job_cards': { href: '/brands/hyundai/demo-job-cards' },
  'hyundai.demo_cars_list': { href: '/brands/hyundai/demo-cars-list' },
  'hyundai.proforma': { href: '/brands/hyundai/proforma' },
  'hyundai.warranty_list': { href: '/brands/hyundai/warranty-list' },
  'hyundai.warranty_claim_list': { href: '/brands/hyundai/warranty-claim-list' },
  'hyundai.sales.discount_approvals': { href: '/brands/hyundai/sales/discount-approvals', aliases: ['/brands/platinum/sales/discount-approvals'] },
  'platinum.business_excellence': { href: '/brands/platinum/business-excellence', aliases: ['/brands/platinum/business-excellence/executive-dashboard', '/brands/platinum/business-excellence/overview'] },
  'platinum.service_appointment': { href: '/brands/platinum/service-appointment' },
  'platinum.demo_job_cards': { href: '/brands/platinum/demo-job-cards' },
  'platinum.demo_cars_list': { href: '/brands/platinum/demo-cars-list' },
  'platinum.proforma': { href: '/brands/platinum/proforma' },
  'platinum.warranty_list': { href: '/brands/platinum/warranty-list' },
  'platinum.warranty_claim_list': { href: '/brands/platinum/warranty-claim-list' },
  'mg.business_excellence': { href: '/brands/mg/business-excellence/overview' },
  'mg.service_appointment': { href: '/brands/mg/service-appointment' },
  'mg.demo_job_cards': { href: '/brands/mg/demo-job-cards' },
  'mg.demo_cars_list': { href: '/brands/mg/demo-cars-list' },
  'mg.proforma': { href: '/brands/mg/proforma' },
}

export const PERMISSIONS: PermissionDefinition[] = PERMISSION_GROUPS.flatMap((group) =>
  group.actions.map((action, index) => ({
    key: `${group.key}.${action}`,
    groupKey: group.key,
    label: `${group.name}: ${action[0].toUpperCase()}${action.slice(1)}`,
    description: `${action[0].toUpperCase()}${action.slice(1)} access for ${group.name}.`,
    resource: group.key,
    action,
    sortOrder: group.sortOrder * 10 + index,
  }))
)

// --- Default section visibility (DENY-BY-DEFAULT for new sidebar sections) ---------------------
// Sidebar sections are visible-by-default ONLY if their key is on this frozen allowlist. Everything
// else — including every NEW section added to SECTION_ROUTES from now on — is restricted to MD &
// Developer (super admins, who can never be locked out) until it is either (a) added here to make
// it broadly visible again, or (b) granted per-user / per-role in Admin → Access.
//
// IMPORTANT: this is a FROZEN list, intentionally hand-maintained. Do NOT replace it with a
// computed `Object.keys(SECTION_ROUTES)` expression — that would re-grant every future section by
// default and defeat the deny-by-default guarantee. To expose a new section to everyone, add its
// key here deliberately.
export const DEFAULT_VISIBLE_SECTIONS = new Set<string>([
  // Broadly visible on purpose: every user gets a personal task inbox. Who may DELEGATE is role-gated
  // (lib/delegation/access.ts), and the list only shows tasks a user created or was assigned.
  'delegation_tasks',
  'purchase_orders', 'finance_orders', 'petty_cash', 'am_finance', 'user_management', 'scrap_erp',
  'kia.business_excellence', 'kia.service_appointment', 'kia.demo_job_cards', 'kia.demo_cars_list',
  'kia.sales_report', 'kia.stock_report', 'kia.bookings', 'kia.proforma',
  'hyundai.business_excellence', 'hyundai.service_appointment', 'hyundai.demo_job_cards',
  'hyundai.demo_cars_list', 'hyundai.proforma', 'hyundai.warranty_list', 'hyundai.warranty_claim_list',
  'hyundai.sales.discount_approvals',
  'platinum.business_excellence', 'platinum.service_appointment', 'platinum.demo_job_cards',
  'platinum.demo_cars_list', 'platinum.proforma', 'platinum.warranty_list', 'platinum.warranty_claim_list',
  'mg.business_excellence', 'mg.service_appointment', 'mg.demo_job_cards', 'mg.demo_cars_list', 'mg.proforma',
])

// Every navigable section NOT on the allowlist is restricted-by-default. Derived from SECTION_ROUTES
// so a newly-added section automatically lands here (deny-by-default) with no extra wiring.
export const RESTRICTED_DEFAULT_SECTIONS = new Set<string>(
  Object.keys(SECTION_ROUTES).filter((key) => !DEFAULT_VISIBLE_SECTIONS.has(key))
)

// The concrete permission keys (e.g. 'kia.call_center.view') under restricted sections. The resolver
// uses this to exclude them from the blanket brand-default and global-access-role defaults, so only
// super admins (MD/Developer) and explicitly-granted users/roles get them.
export const RESTRICTED_DEFAULT_PERMISSION_KEYS = new Set<string>(
  PERMISSIONS.filter((permission) => RESTRICTED_DEFAULT_SECTIONS.has(permission.groupKey)).map((permission) => permission.key)
)

// Sensitive analytics sections: visible by DEFAULT only to top management — MD & Developer (super
// admins) plus EBA. Denied by default to everyone else, including CEO/EA and every brand role, but
// still grantable per-user via the Access Map. Distinct from RESTRICTED_DEFAULT_SECTIONS (super
// admins only) because EBA is additionally allowed. The allowed-role set lives in
// lib/permissions/service.ts (SENSITIVE_REPORT_DEFAULT_ROLES).
export const SENSITIVE_REPORT_SECTIONS = new Set<string>(['kia.sales_report', 'kia.stock_report'])

export const SENSITIVE_REPORT_PERMISSION_KEYS = new Set<string>(
  PERMISSIONS.filter((permission) => SENSITIVE_REPORT_SECTIONS.has(permission.groupKey)).map((permission) => permission.key)
)

const permissionKeysByGroup = new Map(
  PERMISSION_GROUPS.map((group) => [group.key, group.actions.map((action) => `${group.key}.${action}`)])
)

function keysForGroups(groups: string[], actions?: PermissionAction[]) {
  const actionSet = actions ? new Set(actions) : null
  return groups.flatMap((group) => (permissionKeysByGroup.get(group) || [])
    .filter((key) => {
      if (!actionSet) return true
      const action = key.split('.').at(-1) as PermissionAction | undefined
      return Boolean(action && actionSet.has(action))
    }))
}

const allPermissionKeys = PERMISSIONS.map((permission) => permission.key)

export const ROLE_PERMISSION_TEMPLATE_LABELS: Record<PermissionRole, string> = {
  admin: 'Legacy Admin',
  developer: 'Developer',
  branch_admin: 'Branch Admin',
  ceo: 'CEO',
  md: 'MD',
  ea: 'EA',
  eba: 'EBA',
  purchase_manager: 'Purchase Manager',
  finance_head: 'Finance Head',
  accounts: 'Accounts',
  manager: 'Manager',
  technician: 'Technician',
  viewer: 'Employee',
  service_manager: 'Service Manager',
  general_manager: 'General Sales Manager',
  service_general_manager: 'General Service Manager',
  sales_head: 'Sales Head',
  sales_executive: 'Sales Executive',
  sales_manager: 'Sales Manager',
  ed: 'ED',
  vp: 'VP (Vice President)',
  finance_team: 'Finance Team',
  call_agent: 'Call Agent',
  ca: 'CA',
  // CRM / CRE / CXM / CCM are all one letter apart and grant very different things (delivery vs
  // follow-ups). Spell the job out so nobody mis-assigns them from a dropdown.
  crm: 'CRM (Relationship Manager) — retired, use CXM',
  idt: 'IDT (Internal Dev Trainee)',
  cre: 'CRE (Relationship Executive)',
  edp: 'EDP (Electronic Data Processing)',
  cxm: 'CXM (Customer Experience) — marks Delivered',
  ccm: 'CCM (Customer Care Manager) — Delivered backup',
}

const hyundaiPlatinumExecutiveGroups = [
  'hyundai',
  'hyundai.service',
  'hyundai.business_excellence',
  'hyundai.business_excellence.ro_billing',
  'hyundai.business_excellence.workshop_performance',
  'hyundai.business_excellence.open_ro',
  'hyundai.business_excellence.complaints',
  'hyundai.business_excellence.rsa',
  'hyundai.business_excellence.ew',
  'hyundai.business_excellence.mcp',
  'hyundai.repair_orders',
  'hyundai.demo_job_cards',
  'hyundai.service_appointment',
  'hyundai.demo_cars_list',
  'hyundai.proforma',
  'hyundai.warranty_list',
  'hyundai.warranty_claim_list',
  'hyundai.sales',
  'hyundai.h_promise',
  'platinum',
  'platinum.service',
  'platinum.business_excellence',
  'platinum.business_excellence.ro_billing',
  'platinum.business_excellence.workshop_performance',
  'platinum.business_excellence.open_ro',
  'platinum.business_excellence.complaints',
  'platinum.business_excellence.rsa',
  'platinum.business_excellence.ew',
  'platinum.business_excellence.mcp',
  'platinum.demo_job_cards',
  'platinum.service_appointment',
  'platinum.demo_cars_list',
  'platinum.proforma',
  'platinum.warranty_list',
  'platinum.warranty_claim_list',
  'platinum.sales',
  'platinum.h_promise',
]

export const ROLE_PERMISSION_TEMPLATES: Record<PermissionRole, string[]> = {
  admin: allPermissionKeys,
  developer: allPermissionKeys,
  // Branch Admin is locked to Petty Cash only (scoped to their own branch);
  // no brand modules, user management, access control or audit.
  branch_admin: [
    ...keysForGroups(['petty_cash'], ['view', 'create', 'edit', 'audit']),
  ],
  ceo: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.business_excellence.rsa',
    'kia.business_excellence.ew',
    'kia.business_excellence.mcp',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.proforma',
    ...hyundaiPlatinumExecutiveGroups,
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'reports',
  ], ['view', 'approve', 'audit']),
  md: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.sales_report',
    'kia.stock_report',
    'kia.stock_management',
    'kia.bookings',
    'kia.proforma',
    ...hyundaiPlatinumExecutiveGroups,
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'scrap_erp',
    'kia.booking_payment_history',
    'reports',
  ], ['view', 'approve', 'audit']),
  eba: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.sales_report',
    'kia.stock_report',
    'kia.stock_management',
    'kia.bookings',
    'kia.proforma',
    ...hyundaiPlatinumExecutiveGroups,
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'scrap_erp',
    'reports',
  ], ['view', 'approve', 'audit']),
  ea: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'scrap_erp',
    'kia.booking_payment_history',
    'kia.allocation_history',
  ], ['view', 'approve']),
  purchase_manager: [
    ...keysForGroups(['purchase_orders'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  finance_head: [
    ...keysForGroups(['finance_orders'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view', 'create', 'edit', 'audit']),
    // KIA Proforma workflow: final approver — reviews & approves after Sales Manager / GM.
    ...keysForGroups(['kia', 'kia.bookings'], ['view']),
    ...keysForGroups(['kia.proforma'], ['view', 'approve']),
    ...keysForGroups(['finance'], ['view', 'approve', 'edit']),
  ],
  accounts: [
    ...keysForGroups(['purchase_orders', 'finance_orders'], ['view', 'edit', 'approve']),
    // Confirms payment against an allocation, so they get the trail of the ones that lapsed.
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.bookings'], ['view', 'edit', 'audit']),
    ...keysForGroups(['am_finance'], ['view', 'create', 'edit']),
  ],
  manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.sales', 'kia.stock_management', 'kia.bookings', 'kia.proforma'], ['view', 'create', 'edit', 'approve']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'edit', 'approve', 'audit']),
  ],
  technician: [
    ...keysForGroups(['kia.service', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.proforma'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  viewer: [
    ...keysForGroups(['kia.service', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.bookings', 'kia.proforma'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  service_manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'triumph', 'bajaj', 'mg'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  general_manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.stock_management', 'kia.bookings', 'kia.proforma', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'triumph', 'bajaj', 'mg'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'edit', 'approve', 'audit']),
  ],
  // General Service Manager: service-side oversight. Views KIA service modules; the
  // Vehicle Tracker is additionally role-gated in lib/kia/vehicle-tracker-access.ts.
  service_general_manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  sales_head: [
    ...keysForGroups(['kia', 'kia.proforma', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'triumph', 'bajaj', 'mg'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  // KIA Proforma workflow: front-line executive — locked to the Bookings section
  // (Booking CRM + generating proformas). No stock, insurance, approve or audit.
  sales_executive: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
  ],
  // KIA Proforma workflow: reviews & approves/declines proformas.
  sales_manager: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma', 'kia.stock_management'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  ed: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma', 'kia.stock_management'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  // KIA Proforma workflow: final approver alongside the Finance Head — reviews & approves/declines
  // proformas (stage 2), and confirms payment received at the booking finance stage.
  finance_team: [
    ...keysForGroups(['finance_orders'], ['view', 'edit']),
    ...keysForGroups(['kia'], ['view']),
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    ...keysForGroups(['kia.proforma'], ['view', 'approve']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
  // Call Agent (telecaller): the masked Call Center + the follow-up pipeline they schedule from
  // calls — no numbers, no other modules.
  call_agent: [
    ...keysForGroups(['kia.call_center'], ['view']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
  ],
  // CA (Chartered Accountant): read-only, cross-branch, ONLY the CA section (approved POs + petty cash).
  ca: [
    ...keysForGroups(['ca'], ['view']),
  ],
  // CRM (Customer Relationship Manager): the booking pipeline, so they can mark vehicles Delivered.
  // NOTE this template only decides what they can SEE. Delivery itself is gated by ROLE in
  // lib/kia/workflow-access.ts, because a kia.* permission cannot restrict an action — the brand
  // default (service.ts applyBrandDefault) grants kia.bookings.edit to every KIA user whose role is
  // not template-only, so a permission check here would exclude nobody.
  crm: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
  ],
  // IDT (Internal Development Trainee): the booking pipeline, so they can allot vehicles to bookings.
  // Allotment is gated by ROLE in lib/kia/workflow-access.ts — same reasoning as CRM above.
  idt: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    // IDT is TEMPLATE_ONLY, so this line is the only route to the trail of their own allotments.
    ...keysForGroups(['kia.allocation_history'], ['view']),
  ],
  // CRE (Customer Relationship Executive): calls customers and owns Booking Follow-ups. Gets the
  // follow-up pipeline and read-only sight of the bookings behind it — deliberately NOT
  // kia.call_analytics (the leaderboard ranks CREs; same reason sales_executive doesn't get it).
  cre: [
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.bookings'], ['view']),
  ],
  edp: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
  ],
  // CXM (Customer Experience Management): the booking pipeline, so they can mark vehicles Delivered.
  // Successor to CRM — same template, for the same reason: this only decides what they can SEE.
  // Delivery itself is gated by ROLE in lib/kia/workflow-access.ts.
  //
  // `edit` is NOT optional here. app/api/brands/kia/bookings/[id]/deliver/route.ts:14 runs
  // requirePermission(appUser, 'kia.bookings.edit') BEFORE the role gate is ever consulted, so a
  // view-only template 403s on every delivery no matter how correct canDeliverKiaBooking is.
  cxm: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
  ],
  // CCM (Customer Care Manager): manages customer care, delivery backup & lead follow-up pipeline.
  ccm: [
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
  ],
  vp: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma', 'kia.stock_management', 'hyundai.sales.discount_approvals'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
  ],
}

export function getTemplateMap(role: PermissionRole) {
  const allowed = new Set(ROLE_PERMISSION_TEMPLATES[role] || [])
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, allowed.has(permission.key)]))
}
