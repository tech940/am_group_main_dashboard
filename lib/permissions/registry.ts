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
  /*
   * Insurance, 2026-09-15: ONE cross-brand section became THREE brand-owned ones.
   *
   * ⚠️ `parentKey` is the BRAND, not its Service or Sales child — the owner's instruction is that
   * insurance sits beside them, not inside either. It belongs to neither: a policy is sold with the
   * car and renewed against the workshop's customer base.
   *
   * ⚠️ `edit` is a SEPARATE action from `view`, and it is the whole point of the split. The person
   * who telephones a customer about a lapsing policy needs to record what they said; they have no
   * business reading the group's whole premium book to do it. Granting `<brand>.insurance.edit`
   * from the Access Map is what makes an insurance desk possible without a new role. `edit` rather
   * than a new `update` verb because the action vocabulary is a closed union — see PermissionAction.
   *
   * The former `insurance_analysis` group and its /insurance route are GONE. Nothing inherits its
   * grants: the key no longer exists, so a stored override against it resolves to nothing rather
   * than silently carrying over to a brand.
   */
  {
    key: 'kia.insurance',
    name: 'Insurance',
    parentKey: 'kia',
    description: 'AM Kia insurance policy book — renewals due, lapsed customers, retention and the calling desk.',
    sortOrder: 168,
    actions: ['view', 'edit'],
  },
  {
    key: 'hyundai.insurance',
    name: 'Insurance',
    parentKey: 'hyundai',
    description: 'AM Hyundai insurance policy book — renewals due, lapsed customers, retention and the calling desk.',
    sortOrder: 169,
    actions: ['view', 'edit'],
  },
  {
    key: 'platinum.insurance',
    name: 'Insurance',
    parentKey: 'platinum',
    description: 'AM Platinum insurance policy book — renewals due, lapsed customers, retention and the calling desk.',
    sortOrder: 170,
    actions: ['view', 'edit'],
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
    /*
     * ⚠️ THE NAME MUST MATCH THE SIDEBAR LABEL FOR THE SAME HREF. An admin ticking a box in the
     * Access Map and a user looking for the link in the sidebar have to be talking about the same
     * thing; two names for one section reads as a section that is missing. Asserted by
     * `npm run verify:permissions` (scenario 8), which compares every group carrying a SECTION_ROUTES
     * href against the label the sidebar renders for it. ⚠️ Change the NAME only — renaming the KEY
     * orphans every grant stored against it.
     */
    key: 'kia.proforma',
    name: 'Bookings',
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
    /*
     * ⚠️ THE KEY STAYS `kia.sales_performance` — only the label changed when the section became the
     * Sales Target Plan on 2026-09-16. Renaming a permission KEY orphans every grant already stored
     * against it (see the Access-Map incident); the label is display text and is safe to change.
     * Until this was updated the sidebar said "Sales Target Plan" and the Access Map column said
     * "Sales Performance", so admins looking for it concluded it was missing.
     */
    key: 'kia.sales_performance',
    name: 'Sales Target Plan',
    parentKey: 'kia.sales',
    description: 'Daily and monthly commitments per consultant against actuals read from the DMS feeds.',
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
    /*
     * CUSTOMER 360 — one customer's whole relationship with the group.
     *
     * Top-level, not under kia.*, because it is multi-brand by design. That distinction is not
     * cosmetic: applyBrandDefault() grants every non-restricted `kia.*` key to any user whose brand
     * is KIA, so a kia-prefixed key here would silently reach every KIA user regardless of intent.
     *
     * Deliberately NOT in DEFAULT_VISIBLE_SECTIONS: it concentrates more customer contact detail on
     * one screen than anything else in the app, so it starts at MD + Developer and is granted
     * outwards from the Access Map. Contact details are separately masked unless the viewer is MD or
     * Super Admin.
     *
     * ⚠️ sortOrder MUST be an integer. A fractional one fails the registry sync with 22P02 and takes
     * the whole Access Map down with it.
     */
    key: 'customer_360',
    name: 'Customer 360',
    parentKey: null,
    description: 'One customer end to end across every brand — enquiries, bookings, vehicles, insurance, service, spend and what to do next.',
    sortOrder: 9,
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
    // MD queue for payment-window extension requests raised at allotment. Restricted-by-default —
    // it is deliberately absent from DEFAULT_VISIBLE_SECTIONS, which is what puts it into
    // RESTRICTED_DEFAULT_SECTIONS and so excludes it from applyBrandDefault's blanket grant of
    // every kia.* key. Without that, every KIA user would silently get the MD's approval screen.
    // 'approve' is separate from 'view' so an observer can be granted read-only later.
    key: 'kia.payment_window_requests',
    name: 'Payment Window Requests',
    parentKey: 'kia.sales',
    description: 'AM KIA requests for extra customer payment time on an allotted vehicle — MD approves or rejects.',
    sortOrder: 46,
    actions: ['view', 'approve'],
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
    name: 'Booking Follow-ups',
    parentKey: 'kia.sales',
    description: 'AM KIA lead follow-up pipeline — scheduled next-touch on bookings so no lead goes cold.',
    sortOrder: 42,
    actions: ['view', 'create', 'edit'],
  },
  {
    key: 'kia.call_analytics',
    name: 'Call Analytics',
    parentKey: 'kia.sales',
    description: 'AM KIA manager analytics — call volume, contact rate, dispositions, follow-up completion and leaderboards.',
    sortOrder: 43,
    actions: ['view'],
  },
  /*
   * AM Kia · Sales · Walk-in Leads (owner, 2026-09-17). Showroom staff add leads through a NO-LOGIN link;
   * this key governs only the signed-in section. Create = hand out the form link; Edit = follow-up
   * (remarks, expected booking, booked); Delete = remove spam with a reason. Restricted by default (not in
   * DEFAULT_VISIBLE_SECTIONS): tick people in the Access Map. Phones stay masked outside the KIA PII roles.
   * `name` must equal the sidebar label (verify:permissions scenario 8).
   */
  {
    key: 'kia.walk_in_leads',
    name: 'Walk-in Leads',
    parentKey: 'kia.sales',
    description: 'AM KIA showroom walk-ins captured from the no-login form: visits, test drives, exchange and booking intent.',
    sortOrder: 47,
    actions: ['view', 'create', 'edit', 'delete'],
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
    key: 'hyundai.sales_report',
    name: 'Sales Report',
    parentKey: 'hyundai.sales',
    description: 'AM Hyundai sales report analytics workspace, charts, and raw report tables.',
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
    key: 'platinum.sales_report',
    name: 'Sales Report',
    parentKey: 'platinum.sales',
    description: 'AM Platinum sales report analytics, trend analysis, consultant performance, and raw feeds.',
    // ⚠️ MUST be a whole number — permission_groups.sort_order is an integer column. This was 153.1
    // (an attempt to slot between 153 and 154) and Postgres rejected the whole registry sync with
    // 22P02, which took out the entire Access Map and this section with it. Ordering is resolved
    // within a parentKey, and duplicate sortOrder values already exist elsewhere in this file, so
    // sharing 154 with platinum.h_promise (a child of a different parent) is unambiguous.
    sortOrder: 154,
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
    key: 'fuel_approvals',
    name: 'Fuel Approvals',
    parentKey: null,
    description: 'Vehicle, genset and yard fuel requisition orders, slip verification, and CEO approval workflow.',
    sortOrder: 59,
    actions: ['view', 'create', 'edit', 'approve', 'audit'],
  },
  {
    key: 'fuel_management',
    name: 'Fuel Management',
    parentKey: null,
    description: 'Fleet fuel telemetry, demo gate pass trip mileage correlation, and fuel requisition management.',
    sortOrder: 58,
    actions: ['view', 'create', 'edit', 'approve', 'audit'],
  },
  {
    key: 'gate_pass',
    name: 'Demo Car GatePass',
    parentKey: null,
    description: 'Demo car gate passes: request with auto-filled vehicle details, Sales Manager approval, QR-based guard verification at exit and entry, and the full gate audit trail.',
    // ⚠️ Integer only. A fractional sortOrder (153.1) failed the registry sync with 22P02 and took
    // down the entire Access Map along with the section that introduced it.
    sortOrder: 60,
    actions: ['view', 'create', 'edit', 'approve', 'audit'],
  },
  {
    key: 'showroom_images',
    name: 'Showroom Images',
    parentKey: null,
    description: 'Multi-brand showroom photos captured across all dealerships, with brand & location filters and full-screen inspection.',
    sortOrder: 61,
    actions: ['view', 'create', 'delete'],
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
    key: 'bank_sanctions',
    name: 'Bank Sanctions',
    parentKey: null,
    description: 'Group bank credit facilities, sanction limits, outstandings and security details.',
    sortOrder: 58,
    actions: ['view'],
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

  /*
   * ── GRANT-ONLY SECTIONS ────────────────────────────────────────────────────────────────────
   *
   * These six were "fixed by role" until 2026-09-16: no permission key at all, listed read-only in
   * the Access Map, unreachable however many boxes an admin ticked. The owner reversed that —
   * "nothing should be fixed by role, if I want I can give access to those sections as well" — so
   * each now has a real key and a tickable column.
   *
   * ⚠️ THEY ARE NOT ORDINARY KEYS. The reason they had none was stated in lib/permissions/
   * locked-sections.ts: a key reaches `admin` and `hr`, which are family 'super', and that tier's
   * bundle is EVERY key there is — so simply adding one would have handed all six to two roles
   * nobody meant to give them to. GRANT_ONLY_SECTIONS below is what stops that: no role template,
   * no tier bundle and no blanket ever sets them. Only a hand-tick in the Access Map does (and
   * MD/Developer, who can never be locked out of anything).
   */
  {
    key: 'targets',
    name: 'Targets',
    parentKey: null,
    description: 'MD monthly sales and service targets per brand and branch.',
    sortOrder: 171,
    actions: ['view'],
  },
  {
    key: 'data_health',
    name: 'Data Health',
    parentKey: null,
    description: 'Ingestion and table health across every feed. Exposes table names and row counts.',
    sortOrder: 172,
    actions: ['view'],
  },
  {
    key: 'call_analysis',
    name: 'Call Analysis',
    parentKey: null,
    description: 'CRE call records. ⚠️ Carries customer names and numbers for thousands of vehicles.',
    sortOrder: 173,
    actions: ['view'],
  },
  {
    key: 'social_media_leads',
    name: 'Social Media Leads',
    parentKey: null,
    description: 'Leads captured from social campaigns.',
    sortOrder: 174,
    actions: ['view'],
  },
  {
    key: 'kia.vehicle_tracker',
    name: 'Vehicle Tracker',
    parentKey: 'kia',
    description: 'Service-floor camera logger for AM KIA.',
    sortOrder: 175,
    actions: ['view'],
  },
  {
    /*
     * ⚠️ GRANTING THIS GRANTS THE ADMIN CONSOLE — Users, Access Map, Roles, Audit and Settings. A
     * person who holds it can edit permissions, including their own, so it is the one key that can
     * be used to take every other key. Flagged to the owner; granted at their explicit instruction.
     * `user_management` and friends still gate the individual admin tabs.
     */
    key: 'admin_panel',
    name: 'Admin Panel',
    parentKey: null,
    description: 'The admin console. ⚠️ Whoever holds this can change permissions, including their own.',
    sortOrder: 176,
    actions: ['view'],
  },
  /*
   * ── AM Tata · H Promise (pre-owned car desk), owner decision 2026-09-17 ─────────────────────────
   *
   * One Access Map tick per area, and write actions granted per person in Access Control. Every one of
   * these is GRANT-ONLY (see GRANT_ONLY_SECTIONS): without that, the legacy `admin` role (family 'super'
   * in tiers.ts) would receive every action including approve, and applyBrandDefault would hand the
   * unrouted groups to every Tata-brand user. Buyers' and sellers' PAN/Aadhaar live behind these keys.
   *
   * `name` must equal the sidebar label (scripts/verify-permission-resolution.ts, scenario 8).
   */
  {
    key: 'tata.h_promise',
    name: 'H Promise',
    parentKey: 'tata',
    description: 'AM Tata pre-owned car desk: purchases, bookings, sales, paperwork, approvals and MIS.',
    sortOrder: 177,
    actions: ['view'],
  },
  {
    key: 'tata.h_promise.register',
    name: 'Vehicle Register',
    parentKey: 'tata.h_promise',
    description: 'The H Promise vehicle register. Create = new purchase and exchange bonus; Edit = booking, sale, documents, broker RC; Delete = remove a record (with a reason).',
    sortOrder: 178,
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'tata.h_promise.approvals',
    name: 'Purchase & Sale Approvals',
    parentKey: 'tata.h_promise',
    description: 'Approve = the GSM / Sales Manager approval (first stage) of H Promise purchases and sales. The MD gives the final approval and may give it before the GSM / SM. Nobody can decide an entry they made.',
    sortOrder: 179,
    actions: ['view', 'approve'],
  },
  {
    key: 'tata.h_promise.payments',
    name: 'Payment Verification',
    parentKey: 'tata.h_promise',
    description: 'Upload and check the payment ledger for sold H Promise vehicles.',
    sortOrder: 180,
    actions: ['view', 'edit'],
  },
  {
    key: 'tata.h_promise.insights',
    name: 'Insights',
    parentKey: 'tata.h_promise',
    description: 'H Promise insights dashboards, Excel exports and the printable monthly summary.',
    sortOrder: 181,
    actions: ['view'],
  },
  {
    key: 'tata.h_promise.settings',
    name: 'H Promise Settings',
    parentKey: 'tata.h_promise',
    description: 'The H Promise name lists (staff, WhatsApp approvers, locations) and the rates behind profit and interest.',
    sortOrder: 182,
    actions: ['view', 'edit'],
  },
]

/*
 * `permission_groups.sort_order` is an INTEGER column, and the registry is synced into it on the
 * first permission read of a process. A fractional value therefore does not fail where it is
 * written — it fails later, inside `getPermissionCatalog()`, as Postgres 22P02
 * ("invalid input syntax for type integer"), which throws before any permission resolves.
 *
 * That is not a small blast radius: a single `sortOrder: 153.1` on `platinum.sales_report` took out
 * the whole Admin > Access Map with "Failed to load the access map." AND made the section it was
 * added for unreachable, because its permission key never made it into the database.
 *
 * Failing loudly here — at module load, naming the offending key — turns a confusing production
 * 500 into an obvious error the moment someone adds a group. Ordering is resolved within a
 * parentKey, so use the next whole number rather than trying to slot between two existing ones.
 */
const NON_INTEGER_SORT_ORDERS = PERMISSION_GROUPS.filter((g) => !Number.isInteger(g.sortOrder))
if (NON_INTEGER_SORT_ORDERS.length > 0) {
  throw new Error(
    `[permissions/registry] sortOrder must be a whole number — permission_groups.sort_order is an ` +
      `integer column and a fractional value fails the registry sync with Postgres 22P02, taking ` +
      `down the Access Map and every section. Offending group(s): ` +
      NON_INTEGER_SORT_ORDERS.map((g) => `${g.key}=${g.sortOrder}`).join(', '),
  )
}

// Single source of truth for the route each navigable section lives at. The sidebar's
// href→permission gating map and route guards are generated from this (see
// lib/permissions/navigation.ts), so adding a section means adding it here — not editing a
// separate hand-maintained map in the sidebar. `aliases` are additional paths that resolve to
// the same section (e.g. a Business Excellence landing page vs. its /overview route).
/**
 * Sections whose permission KEY has no brand prefix but which are filed under a brand on screen.
 * Owner decision 2026-09-16: "these are for KIA, no need for them to be in common".
 *
 * ⚠️ DISPLAY ONLY. The Access Map reads this to put the column in the brand's band; the sidebar and
 * search list the same three under AM Kia (scripts/verify-nav-map.ts checks they agree). It never
 * feeds access: the keys keep their names — renaming one discards every grant made on it — and no
 * brand scoping is applied to them, so nobody gains or loses a section.
 */
export const SECTION_DISPLAY_BRAND: Record<string, string> = {
  gate_pass: 'kia',
  fuel_approvals: 'kia',
  fuel_management: 'kia',
}

export const SECTION_ROUTES: Record<string, { href: string; aliases?: string[] }> = {
  // Grant-only sections — see GRANT_ONLY_SECTIONS below and the note on their groups above.
  targets: { href: '/targets' },
  data_health: { href: '/data-health' },
  call_analysis: { href: '/call-analysis' },
  social_media_leads: { href: '/social-media-leads' },
  admin_panel: { href: '/admin' },
  'kia.vehicle_tracker': { href: '/brands/kia/vehicle-tracker' },
  // AM Tata · H Promise. The container `tata.h_promise` and `tata.h_promise.settings` have no route on purpose:
  // the four areas below are the Access Map columns; settings is granted in Access Control.
  'tata.h_promise.register': { href: '/brands/tata/h-promise/register' },
  'tata.h_promise.approvals': { href: '/brands/tata/h-promise/approvals' },
  'tata.h_promise.payments': { href: '/brands/tata/h-promise/payments' },
  'tata.h_promise.insights': { href: '/brands/tata/h-promise/insights' },

  cockpit: { href: '/cockpit' },
  delegation_tasks: { href: '/delegation-tasks' },
  purchase_orders: { href: '/purchase-orders' },
  petty_cash: { href: '/petty-cash' },
  am_finance: { href: '/am-finance' },
  ca: { href: '/ca' },
  finance: { href: '/finance' },
  bank_sanctions: { href: '/bank-sanctions' },
  fuel_management: { href: '/fuel-management' },
  fuel_approvals: { href: '/fuel-approvals', aliases: ['/brands/kia/fuel-approvals'] },
  // The guard-facing /gate/<token> page is deliberately NOT registered here. It is unauthenticated
  // by design (guards have no accounts) and is protected by an HMAC token, not by this section.
  gate_pass: { href: '/gate-pass' },
  showroom_images: { href: '/showroom-images' },
  scrap_erp: { href: '/scrap-erp' },
  // The old '/insurance' is deliberately absent: it now redirects and is registered nowhere, so it
  // cannot appear in the sidebar, in either search surface or in the Access Map.
  'kia.insurance': { href: '/brands/kia/insurance' },
  'hyundai.insurance': { href: '/brands/hyundai/insurance' },
  'platinum.insurance': { href: '/brands/platinum/insurance' },
  'kia.booking_payment_history': { href: '/brands/kia/booking-payment-history' },
  customer_360: { href: '/customer-360' },
  'kia.business_excellence': { href: '/brands/kia/business-excellence', aliases: ['/brands/kia/business-excellence/executive-dashboard', '/brands/kia/business-excellence/overview'] },
  'kia.service_appointment': { href: '/brands/kia/service-appointment' },
  'kia.demo_job_cards': { href: '/brands/kia/demo-job-cards' },
  'kia.demo_cars_list': { href: '/brands/kia/demo-cars-list' },
  'kia.sales_report': { href: '/brands/kia/sales-report' },
  'kia.stock_report': { href: '/brands/kia/stock-report' },
  'kia.sales_performance': { href: '/brands/kia/sales-performance' },
  'kia.call_center': { href: '/brands/kia/call-center' },
  'kia.lead_followups': { href: '/brands/kia/follow-ups' },
  'kia.walk_in_leads': { href: '/brands/kia/walk-in-leads' },
  // Lives as a TAB inside Bookings (the Kia Proforma shell), not as its own sidebar item. The old
  // standalone route still resolves and redirects here, so existing links keep working.
  'kia.allocation_history': { href: '/brands/kia/proforma/allocation-history', aliases: ['/brands/kia/allocation-history'] },
  // Also a TAB inside Bookings, for the same reason. Being listed here (and NOT in
  // DEFAULT_VISIBLE_SECTIONS) is what makes it restricted-by-default.
  'kia.payment_window_requests': { href: '/brands/kia/proforma/payment-window-requests' },
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
  'hyundai.sales_report': { href: '/brands/hyundai/sales-report' },
  'hyundai.sales.discount_approvals': { href: '/brands/hyundai/sales/discount-approvals', aliases: ['/brands/platinum/sales/discount-approvals'] },
  'platinum.business_excellence': { href: '/brands/platinum/business-excellence', aliases: ['/brands/platinum/business-excellence/executive-dashboard', '/brands/platinum/business-excellence/overview'] },
  'platinum.service_appointment': { href: '/brands/platinum/service-appointment' },
  'platinum.demo_job_cards': { href: '/brands/platinum/demo-job-cards' },
  'platinum.demo_cars_list': { href: '/brands/platinum/demo-cars-list' },
  'platinum.proforma': { href: '/brands/platinum/proforma' },
  'platinum.warranty_list': { href: '/brands/platinum/warranty-list' },
  'platinum.warranty_claim_list': { href: '/brands/platinum/warranty-claim-list' },
  'platinum.sales_report': { href: '/brands/platinum/sales-report' },
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
  'purchase_orders', 'finance_orders', 'petty_cash', 'am_finance', 'user_management', 'scrap_erp', 'showroom_images',
  // ⚠️ fuel_management and fuel_approvals were on this list until 2026-09-11 and are deliberately GONE —
  // the owner restricted both. Taking them off only makes them restricted-by-default; WHO still gets
  // them by default is FUEL_SECTION_DEFAULT_GRANTS in lib/permissions/service.ts (the same split
  // SENSITIVE_REPORT_SECTIONS uses): Fuel Management → EA; Fuel Approvals → EA, the CEO (its final
  // approver) and HR (who raises the requests); MD and Developer always. An individual Access-Map tick
  // still wins.
  'kia.business_excellence', 'kia.service_appointment', 'kia.demo_job_cards', 'kia.demo_cars_list',
  'kia.sales_report', 'kia.stock_report', 'kia.bookings', 'kia.proforma',
  'hyundai.business_excellence', 'hyundai.service_appointment', 'hyundai.demo_job_cards',
  'hyundai.demo_cars_list', 'hyundai.proforma', 'hyundai.warranty_list', 'hyundai.warranty_claim_list',
  'hyundai.sales_report', 'hyundai.sales.discount_approvals',
  'platinum.business_excellence', 'platinum.service_appointment', 'platinum.demo_job_cards',
  'platinum.demo_cars_list', 'platinum.proforma', 'platinum.warranty_list', 'platinum.warranty_claim_list',
  'platinum.sales_report',
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
/**
 * Sections that NO role default may ever grant — not a role template, not a tier bundle, not the
 * brand blanket, not the global-access blanket. The ONLY ways in are a hand-tick in the Access Map
 * and being a super admin (MD / Developer), who can never be locked out of anything.
 *
 * ⚠️ WHY THIS CLASS HAS TO EXIST. `RESTRICTED_DEFAULT_SECTIONS` below already keeps a section out of
 * the brand and global-access blankets — but NOT out of the super-tier bundle, which sets every key
 * true for family 'super' (`admin` and `hr`, on top of MD/Developer). These six were left without a
 * permission key at all precisely to dodge that, at the cost of being ungrantable. This set is what
 * lets them have a key AND stay off by default.
 *
 * ⚠️ Adding a key here does NOT hide it from anyone who already holds an explicit grant — overrides
 * are applied after every default, by design.
 */
export const GRANT_ONLY_SECTIONS = new Set<string>([
  'targets',
  'data_health',
  'call_analysis',
  'social_media_leads',
  'admin_panel',
  'kia.vehicle_tracker',
  // AM Tata · H Promise — all six, including the two unrouted groups (see the note on their definitions).
  'tata.h_promise',
  'tata.h_promise.register',
  'tata.h_promise.approvals',
  'tata.h_promise.payments',
  'tata.h_promise.insights',
  'tata.h_promise.settings',
])

/** The concrete permission keys under a grant-only section. */
export const GRANT_ONLY_PERMISSION_KEYS = new Set<string>(
  PERMISSIONS.filter((permission) => GRANT_ONLY_SECTIONS.has(permission.groupKey)).map((permission) => permission.key)
)

/**
 * The ONLY default audience a grant-only key has beyond MD / Developer (who hold everything anyway).
 * Applied by stripGrantOnly in lib/permissions/service.ts, in the same place the keys are stripped, so a
 * per-person Deny in the Access Map still wins.
 *
 * Owner, 2026-09-17: AM Tata and H Promise stay "hidden by default for others except MD, DEVELOPER, EA".
 * ⚠️ EA gets VIEW only — the four areas and their container, not Settings. Entering, approving and
 * verifying payments stay per-person ticks: they are money decisions, and `approve` is what opens buyers'
 * PAN and Aadhaar scans (lib/h-promise/access-shared.ts).
 */
export const GRANT_ONLY_ROLE_DEFAULTS: Readonly<Partial<Record<PermissionRole, readonly string[]>>> = {
  ea: [
    'tata.h_promise.view',
    'tata.h_promise.register.view',
    'tata.h_promise.approvals.view',
    'tata.h_promise.payments.view',
    'tata.h_promise.insights.view',
  ],
  h_promise_head: [
    'tata.h_promise.view',
    'tata.h_promise.register.view',
    'tata.h_promise.register.create',
    'tata.h_promise.register.edit',
    'tata.h_promise.register.delete',
    'tata.h_promise.approvals.view',
    'tata.h_promise.approvals.approve',
    'tata.h_promise.payments.view',
    'tata.h_promise.payments.edit',
    'tata.h_promise.insights.view',
    'tata.h_promise.settings.view',
    'tata.h_promise.settings.edit',
  ],
}

export const RESTRICTED_DEFAULT_PERMISSION_KEYS = new Set<string>(
  PERMISSIONS.filter((permission) => RESTRICTED_DEFAULT_SECTIONS.has(permission.groupKey)).map((permission) => permission.key)
)

// Sensitive analytics sections: visible by DEFAULT only to top management — MD & Developer (super
// admins) plus EBA. Denied by default to everyone else, including CEO/EA and every brand role, but
// still grantable per-user via the Access Map. Distinct from RESTRICTED_DEFAULT_SECTIONS (super
// admins only) because EBA is additionally allowed. The allowed-role set lives in
// lib/permissions/service.ts (SENSITIVE_REPORT_DEFAULT_ROLES).
export const SENSITIVE_REPORT_SECTIONS = new Set<string>(['kia.sales_report', 'kia.stock_report', 'hyundai.sales_report', 'platinum.sales_report'])

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
  dgm: 'DGM (Deputy General Manager)',
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
  group_service_manager: 'Group Service Manager',
  sales_head: 'Sales Head',
  sales_executive: 'Sales Executive',
  sales_manager: 'Sales Manager',
  assistant_manager: 'Assistant Manager (Sales + Service)',
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
  process_coordinator: 'Process Coordinator (PC)',
  hr: 'HR (Human Resources)',
  h_promise_head: 'H-Promise Head',
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
  'hyundai.sales_report',
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
  'platinum.sales_report',
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
    'fuel_approvals',
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
    'fuel_approvals',
    'am_finance',
    'bank_sanctions',
    'scrap_erp',
    'kia.booking_payment_history',
    // MD is the approver for payment-window extensions. isSuperAdminRole already short-circuits
    // every permission check for md/developer, so this is belt-and-braces — but listing it keeps the
    // grant visible in the Access Map instead of looking like an accidental omission.
    'kia.payment_window_requests',
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
    'kia.call_analytics',
    ...hyundaiPlatinumExecutiveGroups,
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'scrap_erp',
    'reports',
  ], ['view', 'approve', 'audit']),
  process_coordinator: keysForGroups([
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
    'kia.booking_payment_history',
    'kia.allocation_history',
    ...hyundaiPlatinumExecutiveGroups,
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'bank_sanctions',
    'scrap_erp',
    'reports',
  ], ['view', 'create', 'edit', 'approve', 'audit']),
  ea: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.bookings',
    'kia.proforma',
    'kia.call_analytics',
    'purchase_orders',
    'finance_orders',
    'petty_cash',
    'am_finance',
    'bank_sanctions',
    'scrap_erp',
    'kia.booking_payment_history',
    'kia.allocation_history',
    'gate_pass',
  ], ['view', 'create', 'approve']),
  purchase_manager: [
    ...keysForGroups(['purchase_orders'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  finance_head: [
    ...keysForGroups(['finance_orders'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view', 'create', 'edit', 'audit']),
    // KIA Proforma workflow: final approver — reviews & approves after Sales Manager / GM.
    ...keysForGroups(['kia', 'kia.bookings'], ['view']),
    ...keysForGroups(['kia.proforma'], ['view', 'approve']),
    ...keysForGroups(['finance'], ['view', 'approve', 'edit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  accounts: [
    ...keysForGroups(['purchase_orders', 'finance_orders'], ['view', 'edit', 'approve']),
    // Confirms payment against an allocation, so they get the trail of the ones that lapsed.
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.bookings'], ['view', 'edit', 'audit']),
    ...keysForGroups(['am_finance'], ['view', 'create', 'edit']),
    ...keysForGroups(['bank_sanctions'], ['view']),
    ...keysForGroups(['kia.approvals'], ['view']),    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.sales', 'kia.stock_management', 'kia.bookings', 'kia.proforma'], ['view', 'create', 'edit', 'approve']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'edit', 'approve', 'audit']),    // Raises and tracks gate passes for their branch. Approval stays with the Sales Manager.
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  technician: [
    ...keysForGroups(['kia.service', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.proforma'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  viewer: [
    ...keysForGroups(['kia.service', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.bookings', 'kia.proforma'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  service_manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'bajaj', 'mg'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['am_finance'], ['view']),    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  general_manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.stock_management', 'kia.bookings', 'kia.proforma', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'bajaj', 'mg'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.approvals'], ['view']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'edit', 'approve', 'audit']),    // Fallback gate pass approver, so a demo car is never stuck behind one Sales Manager on leave.
    ...keysForGroups(['gate_pass'], ['view', 'create', 'edit', 'approve', 'audit']),
  ],
  // General Service Manager: service-side oversight. Views KIA service modules; the
  // Vehicle Tracker is additionally role-gated in lib/kia/vehicle-tracker-access.ts.
  service_general_manager: [
    ...keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  group_service_manager: [
    ...keysForGroups(['hyundai', 'hyundai.service', 'hyundai.business_excellence', 'hyundai.service_appointment', 'hyundai.repair_orders'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['platinum', 'platinum.service', 'platinum.business_excellence', 'platinum.service_appointment'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.approvals'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'create']),    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  sales_head: [
    ...keysForGroups(['kia', 'kia.proforma', 'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'bajaj', 'mg'], ['view', 'create', 'edit', 'approve', 'audit']),
    // First stage on KIA sales — see the note on general_manager above.
    ...keysForGroups(['kia.approvals'], ['view']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  dgm: [
    ...keysForGroups(['kia.approvals'], ['view', 'approve']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // KIA Proforma workflow: front-line executive — locked to the Bookings section
  // (Booking CRM + generating proformas). No stock, insurance, approve or audit.
  sales_executive: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    // Raises demo car gate passes — the front-line role that actually takes a customer out on a
    // test drive. No approve: their own request is signed off by the Sales Manager.
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // KIA Proforma workflow: reviews & approves/declines proformas.
  sales_manager: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma', 'kia.stock_management'], ['view', 'create', 'edit', 'approve', 'audit']),
    // First stage on KIA sales — see the note on general_manager above.
    ...keysForGroups(['kia.approvals'], ['view']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'create', 'edit']),    ...keysForGroups(['gate_pass'], ['view', 'create', 'edit', 'approve', 'audit']),
  ],
  assistant_manager: [
    ...keysForGroups([
      'kia.insurance', 'hyundai.insurance', 'platinum.insurance',
      'kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment',
      'kia.demo_cars_list', 'kia.sales', 'kia.stock_management', 'kia.bookings', 'kia.proforma',
      'tata', 'hyundai', 'platinum', 'honda', 'ktm', 'bajaj', 'mg',
    ], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  ed: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma', 'kia.stock_management'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['kia.approvals'], ['view', 'approve', 'audit']),
    ...keysForGroups(['purchase_orders'], ['view', 'approve', 'audit']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['petty_cash'], ['view', 'approve', 'audit']),    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // KIA Proforma workflow: final approver alongside the Finance Head — reviews & approves/declines
  // proformas (stage 2), and confirms payment received at the booking finance stage.
  finance_team: [
    ...keysForGroups(['finance_orders'], ['view', 'edit']),
    ...keysForGroups(['kia'], ['view']),
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    ...keysForGroups(['kia.proforma'], ['view', 'approve']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // Call Agent (telecaller): the masked Call Center + the follow-up pipeline they schedule from
  // calls — no numbers, no other modules.
  call_agent: [
    ...keysForGroups(['kia.call_center'], ['view']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // CA (Chartered Accountant): read-only, cross-branch, ONLY the CA section (approved POs + petty cash).
  ca: [
    ...keysForGroups(['ca'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // CRM (Customer Relationship Manager): the booking pipeline, so they can mark vehicles Delivered.
  crm: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // IDT (Internal Development Trainee): the booking pipeline, so they can allot vehicles to bookings.
  idt: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    // IDT is TEMPLATE_ONLY, so this line is the only route to the trail of their own allotments.
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // CRE (Customer Relationship Executive): calls customers and owns Booking Follow-ups.
  cre: [
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.bookings'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  edp: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // CXM (Customer Experience Management): the booking pipeline, so they can mark vehicles Delivered.
  cxm: [
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // CCM (Customer Care Manager): manages customer care, delivery backup & lead follow-up pipeline.
  ccm: [
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.bookings'], ['view', 'edit']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  vp: [
    ...keysForGroups(['kia', 'kia.bookings', 'kia.proforma', 'kia.stock_management', 'hyundai.sales.discount_approvals'], ['view', 'create', 'edit', 'approve', 'audit']),
    ...keysForGroups(['kia.lead_followups'], ['view', 'create', 'edit']),
    ...keysForGroups(['kia.allocation_history'], ['view']),
    ...keysForGroups(['kia.call_analytics'], ['view']),
    ...keysForGroups(['am_finance'], ['view']),
    ...keysForGroups(['gate_pass'], ['view', 'create']),
  ],
  // HR previously read `allPermissionKeys` — literally every permission in the system, the same
  // as `admin` and `developer`, and broader than `md`. That silently defeated deny-by-default:
  // any section added to SECTION_ROUTES and deliberately kept OUT of DEFAULT_VISIBLE_SECTIONS
  // still reached HR through this template, so "restricted-by-default" was never true for them.
  // It was caught when Customer Profile — a screen full of customer phone numbers and email
  // addresses — resolved as visible to HR despite being specified MD + Developer only.
  //
  // HR now gets everything EXCEPT the restricted-default sections. Anyone in HR who genuinely
  // needs one of those is granted it explicitly from the Access Map, which is the mechanism that
  // was designed for exactly this.
  hr: allPermissionKeys.filter((key) => !RESTRICTED_DEFAULT_PERMISSION_KEYS.has(key)),
  h_promise_head: [
    ...keysForGroups([
      'tata.h_promise',
      'tata.h_promise.register',
      'tata.h_promise.approvals',
      'tata.h_promise.payments',
      'tata.h_promise.insights',
      'tata.h_promise.settings',
      'hyundai.h_promise',
      'platinum.h_promise',
      'kia.h_promise',
      'mg.h_promise',
    ], ['view', 'create', 'edit', 'delete', 'approve', 'audit']),
  ],
}

export function getTemplateMap(role: PermissionRole) {
  const allowed = new Set(ROLE_PERMISSION_TEMPLATES[role] || [])
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, allowed.has(permission.key)]))
}
