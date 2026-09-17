import { SIDEBAR_PERMISSION_BY_HREF, compositeViewKeysForHref } from '@/lib/permissions/navigation'
import { isSuperAdminRole, hasGlobalAccessRole } from '@/lib/auth/roles'
import { hasAllBranchAccess } from '@/lib/branches'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { canViewBookingPaymentHistory } from '@/lib/kia/booking-payment-history-access'
import {
  canViewRestrictedAnalytics,
  isRestrictedAnalyticsHref,
} from '@/lib/auth/restricted-analytics'
import { canViewMdTargets, isMdTargetsHref } from '@/lib/auth/md-targets-access'
import { canViewBankSanctions, isBankSanctionsHref } from '@/lib/auth/bank-sanctions-access'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
import { isPettyCashViewRole, isAmFinanceViewRole, isCaViewRole } from '@/lib/permissions/legacy-module-roles'

export type DepartmentType = 'sales' | 'service' | 'finance' | 'admin'
export type SectionCategory = 'common_dashboards' | 'general_modules' | 'kia' | 'hyundai' | 'platinum' | 'tata'

export interface SearchSection {
  id: string
  name: string
  description: string
  href: string
  department: DepartmentType
  brand: 'kia' | 'hyundai' | 'platinum' | 'mg' | 'tata' | 'common'
  iconName: string
  badge?: string
  initials?: string
  category?: SectionCategory
}

export const ALL_SECTIONS: SearchSection[] = [
  // ── Administration & Core ──
  {
    id: 'cockpit',
    name: 'Group Cockpit',
    description: 'Executive cross-brand dashboard: monthly revenue, retail financing, and branch metrics.',
    href: '/cockpit',
    department: 'admin',
    brand: 'common',
    iconName: 'Gauge',
    initials: 'GC',
    category: 'common_dashboards',
  },
  {
    id: 'md_targets',
    name: 'Targets',
    description: 'MD-only: set monthly sales and service targets for each branch, and track achievement.',
    href: '/targets',
    department: 'admin',
    brand: 'common',
    iconName: 'Target',
    initials: 'TG',
    category: 'common_dashboards',
  },
  {
    id: 'bank_sanctions',
    name: 'Bank Sanctions',
    description: 'Bank credit facility register: sanction limits, outstandings, expiry alerts and sanction letters.',
    href: '/bank-sanctions',
    department: 'finance',
    brand: 'common',
    iconName: 'CreditCard',
    initials: 'BK',
    category: 'general_modules',
  },
  {
    id: 'call_analysis',
    name: 'Call Analysis',
    description: 'Call volume, agent performance, timing patterns, customer matching and call recordings.',
    href: '/call-analysis',
    department: 'admin',
    brand: 'common',
    iconName: 'PhoneCall',
    initials: 'CA',
    category: 'common_dashboards',
  },
  /*
   * Insurance is no longer a common section. It belongs to each dealership, because a policy book is
   * a dealership's own customers — see the three entries under kia / hyundai / platinum below.
   */
  {
    id: 'kia.insurance',
    name: 'Kia Insurance',
    description: 'AM Kia insurance policy book — renewals falling due, lapsed customers, retention and the calling desk.',
    href: '/brands/kia/insurance',
    department: 'sales',
    brand: 'kia',
    iconName: 'ShieldCheck',
    initials: 'KI',
    category: 'kia',
  },
  {
    id: 'hyundai.insurance',
    name: 'Hyundai Insurance',
    description: 'AM Hyundai insurance policy book — renewals falling due, lapsed customers, retention and the calling desk.',
    href: '/brands/hyundai/insurance',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'ShieldCheck',
    initials: 'HI',
    category: 'hyundai',
  },
  {
    id: 'platinum.insurance',
    name: 'Platinum Insurance',
    description: 'AM Platinum insurance policy book — renewals falling due, lapsed customers, retention and the calling desk.',
    href: '/brands/platinum/insurance',
    department: 'sales',
    brand: 'platinum',
    iconName: 'ShieldCheck',
    initials: 'PI',
    category: 'platinum',
  },
  {
    id: 'delegation_tasks',
    name: 'Delegation Tasks',
    description: 'Assign action items to your team and track them to completion.',
    href: '/delegation-tasks',
    department: 'admin',
    brand: 'common',
    iconName: 'ClipboardList',
    initials: 'DT',
    category: 'common_dashboards',
  },
  {
    id: 'purchase_orders',
    name: 'Purchase Orders',
    description: 'Create, review, and approve corporate purchase orders across the group.',
    href: '/purchase-orders',
    department: 'admin',
    brand: 'common',
    iconName: 'ShoppingCart',
    initials: 'PO',
    category: 'common_dashboards',
  },
  {
    id: 'scrap',
    name: 'Scrap',
    description: 'Scrap material disposal, dynamic master records, reports, valuation & sales analytics.',
    href: '/scrap',
    department: 'admin',
    brand: 'common',
    iconName: 'Recycle',
    initials: 'SC',
    category: 'common_dashboards',
  },
  {
    id: 'admin_panel',
    name: 'Admin Panel',
    description: 'System administration, user account creation, role assignments, and permission overrides.',
    href: '/admin',
    department: 'admin',
    brand: 'common',
    iconName: 'Shield',
    initials: 'AP',
    category: 'general_modules',
  },

  // ── Finance & Accounts ──
  {
    id: 'am_finance',
    name: 'AM Finance',
    description: 'Consolidated accounts, treasury oversight, and group-level financial monitoring.',
    href: '/am-finance',
    department: 'finance',
    brand: 'common',
    iconName: 'Landmark',
    initials: 'AF',
    category: 'general_modules',
  },
  {
    id: 'petty_cash',
    name: 'Petty Cash',
    description: 'Log and track cash vouchers, local store expenses, and branch petty cash approvals.',
    href: '/petty-cash',
    department: 'finance',
    brand: 'common',
    iconName: 'Banknote',
    initials: 'PC',
    category: 'general_modules',
  },
  {
    id: 'gate_pass',
    name: 'Demo Car GatePass',
    description: 'Raise and approve demo car gate passes, and see the QR-verified exit and entry log for every demo vehicle.',
    href: '/gate-pass',
    department: 'sales',
    /*
     * 'kia' since 2026-09-16, with both fuel sections below: the owner moved all three out of Common
     * and under AM Kia in the sidebar. SEARCH PLACEMENT ONLY — nobody gains or loses them.
     *
     * ⚠️ This used to say a 'kia' tag would hide the section from anyone whose users.brand is not
     * 'kia'. That stopped being true when canUserAccessSection learned `grantedAcrossBrand`: these
     * keys carry no brand prefix, so constrainSnapshotToBranch never zeroes them, and a Hyundai login
     * holding gate_pass.view still passes the brand step exactly as before. The section's own key
     * remains the whole test. scripts/verify-fuel-management.ts pins the Hyundai case.
     */
    brand: 'kia',
    iconName: 'ScanLine',
    initials: 'GP',
    category: 'kia',
  },
  {
    id: 'fuel_approvals',
    name: 'Fuel Approvals',
    description: 'Raise fuel requests for demo, stock, display and yard vehicles with the fuel slip attached, and approve them.',
    href: '/fuel-approvals',
    department: 'finance',
    brand: 'kia',
    iconName: 'Fuel',
    initials: 'FA',
    category: 'kia',
  },
  {
    id: 'fuel_management',
    name: 'Fuel Management',
    description: 'Fuel approved by purpose and branch, demo car fuel set against gate pass and GPS distance, and fuel records that need a look.',
    href: '/fuel-management',
    department: 'finance',
    brand: 'kia',
    iconName: 'Fuel',
    initials: 'FM',
    category: 'kia',
  },
  {
    id: 'finance',
    name: 'Customer Vehicle Financing',
    description: 'Track retail vehicle financing orders, bank logins, approval status, and disbursals.',
    href: '/finance',
    department: 'finance',
    brand: 'common',
    iconName: 'HandCoins',
    initials: 'CV',
    category: 'general_modules',
  },
  {
    id: 'kia_approvals',
    // Named 'Approvals', not 'Kia Approvals': the section now receives submissions from every
    // brand (Hyundai, Platinum and MG all post through app/api/brands/[brand]/approvals).
    // The id, href and permission keys stay kia-prefixed so existing grants and links survive.
    name: 'Approvals',
    description: 'Review pending payment approval requests, attachments, and multi-stage workflows across brands.',
    href: '/brands/kia/payment-approvals',
    department: 'finance',
    brand: 'common',
    iconName: 'FileCheck',
    initials: 'VP',
    category: 'general_modules',
  },
  {
    id: 'kia_vendors',
    name: 'Vendor Registry',
    description: 'Manage registered vendors, business address records, contact info, and GSTINs.',
    href: '/brands/kia/vendors',
    department: 'finance',
    brand: 'common',
    iconName: 'Users',
    initials: 'VR',
    category: 'general_modules',
  },

  // ── AM KIA Sales ──
  {
    id: 'kia_bookings',
    name: 'KIA Bookings',
    description: 'Create customer orders, process invoices, upload cost sheets, and log vehicle files.',
    href: '/brands/kia/proforma',
    department: 'sales',
    brand: 'kia',
    iconName: 'FileText',
    initials: 'KB',
    category: 'kia',
  },
  {
    id: 'kia_sales_report',
    name: 'Sales Report',
    description: 'Track retail targets, lost cases, customer conversion ratios, and delivery volumes.',
    href: '/brands/kia/sales-report',
    department: 'sales',
    brand: 'kia',
    iconName: 'BarChart3',
    initials: 'SR',
    category: 'kia',
  },
  {
    id: 'kia_stock_report',
    name: 'Stock Report',
    description: 'Live physical inventory of vehicles: filter by status, age, model, color, and location.',
    href: '/brands/kia/stock-report',
    department: 'sales',
    brand: 'kia',
    iconName: 'Layers',
    initials: 'ST',
    category: 'kia',
  },
  {
    id: 'kia_sales_performance',
    name: 'Sales Target Plan',
    description: 'Monthly enquiry, test drive, booking and retail targets against actuals, per consultant and team.',
    href: '/brands/kia/sales-performance',
    department: 'sales',
    brand: 'kia',
    iconName: 'TrendingUp',
    initials: 'TP',
    category: 'kia',
  },
  {
    id: 'kia_call_center',
    name: 'Call Center',
    description: 'Inbound and outbound telephone lead management and customer CRM registry.',
    href: '/brands/kia/call-center',
    department: 'sales',
    brand: 'kia',
    iconName: 'PhoneCall',
    initials: 'CC',
    category: 'kia',
  },
  {
    id: 'kia_lead_followups',
    name: 'Booking Follow-up Analytics',
    description: 'Pending callback schedules, next follow-up dates, and logs of active customer conversations.',
    href: '/brands/kia/follow-ups',
    department: 'sales',
    brand: 'kia',
    iconName: 'Clock',
    initials: 'BF',
    category: 'kia',
  },
  {
    id: 'kia_allocation_history',
    name: 'Vehicle Allocation History',
    description: 'Audit trail of every vehicle allocation: who allotted it, when the countdown expired, and why it went back to free stock.',
    href: '/brands/kia/proforma/allocation-history',
    department: 'sales',
    brand: 'kia',
    iconName: 'History',
    initials: 'VAH',
    category: 'kia',
  },
  {
    id: 'kia_payment_window_requests',
    name: 'Payment Window Requests',
    description: 'Requests for extra customer payment time on an allotted vehicle, with any competing bookings for the same car. MD approves or rejects.',
    href: '/brands/kia/proforma/payment-window-requests',
    department: 'sales',
    brand: 'kia',
    iconName: 'Clock',
    initials: 'PWR',
    category: 'kia',
  },
  {
    id: 'kia_call_analytics',
    name: 'Call & Follow-up Analytics',
    description: 'Comprehensive conversion funnels, call metrics, and performance charts.',
    href: '/brands/kia/call-analytics',
    department: 'sales',
    brand: 'kia',
    iconName: 'PieChart',
    initials: 'CFA',
    category: 'kia',
  },
  {
    id: 'kia_booking_payment_history',
    name: 'Booking Payment History',
    description: 'Booking payment receipts — collections register with summary, analytics and a filterable list.',
    href: '/brands/kia/booking-payment-history',
    department: 'sales',
    brand: 'kia',
    iconName: 'Banknote',
    initials: 'BPH',
    category: 'kia',
  },
  {
    id: 'customer_360',
    name: 'Customer 360',
    description: 'Search any customer and see their whole relationship with the group — enquiries, bookings, vehicles, insurance, service, spend and what to do next.',
    href: '/customer-360',
    department: 'sales',
    // 'common', not 'kia': the section is multi-brand, and a brand tag here would have
    // canUserAccessSection apply the brand-assignment check and hide it from anyone not on KIA.
    brand: 'common',
    iconName: 'UserSearch',
    initials: 'C360',
    category: 'common_dashboards',
  },
  {
    id: 'kia_demo_cars_list',
    name: 'Demo Cars List',
    description: 'Current fleet registry of demonstrator vehicles for customer test drives.',
    href: '/brands/kia/demo-cars-list',
    department: 'sales',
    brand: 'kia',
    iconName: 'Car',
    initials: 'DCL',
    category: 'kia',
  },
  {
    id: 'kia_social_media_leads',
    name: 'Social Media Leads',
    description: 'CRE social media leads management and follow-up pipeline.',
    href: '/social-media-leads',
    department: 'sales',
    brand: 'kia',
    iconName: 'MessageCircle',
    initials: 'SML',
    category: 'kia',
  },

  // ── AM KIA Service ──
  {
    id: 'kia_business_excellence',
    name: 'Business Excellence',
    description: 'G-MS scorecards, service quality standards, and business audit checklists.',
    href: '/brands/kia/business-excellence',
    department: 'service',
    brand: 'kia',
    iconName: 'Award',
    initials: 'BE',
    category: 'kia',
  },
  {
    id: 'kia_service_appointment',
    name: 'Service Appointment',
    description: 'Schedule, log, and assign maintenance bookings for customer vehicles.',
    href: '/brands/kia/service-appointment',
    department: 'service',
    brand: 'kia',
    iconName: 'Calendar',
    initials: 'SA',
    category: 'kia',
  },
  {
    id: 'kia_vehicle_tracker',
    name: 'Vehicle Tracker',
    description: 'Live workshop tracker for vehicle status, bay occupancy, and job cards.',
    href: '/brands/kia/vehicle-tracker',
    department: 'service',
    brand: 'kia',
    iconName: 'Truck',
    initials: 'VT',
    category: 'kia',
  },
  {
    id: 'kia_demo_job_cards',
    name: 'Demo Job Cards',
    description: 'Log and track repair orders and job cards specific to demonstrator fleet cars.',
    href: '/brands/kia/demo-job-cards',
    department: 'service',
    brand: 'kia',
    iconName: 'ClipboardList',
    initials: 'DJC',
    category: 'kia',
  },

  // ── AM Hyundai Service & Sales ──
  {
    id: 'hyundai_service_appointment',
    name: 'Hyundai Service Appointment',
    description: 'Customer service slot booking calendar and advisor logs.',
    href: '/brands/hyundai/service-appointment',
    department: 'service',
    brand: 'hyundai',
    iconName: 'Calendar',
    initials: 'HSA',
    category: 'hyundai',
  },
  {
    id: 'hyundai_warranty_list',
    name: 'Claim YTP',
    description: 'Year-to-present claims list and pending warranty entries.',
    href: '/brands/hyundai/warranty-list',
    department: 'service',
    brand: 'hyundai',
    iconName: 'Sparkles',
    initials: 'CY',
    category: 'hyundai',
  },
  {
    id: 'hyundai_proforma',
    name: 'Hyundai Bookings',
    description: 'Create and print proforma invoices and sales bookings for Hyundai vehicles.',
    href: '/brands/hyundai/proforma',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'FileText',
    initials: 'HB',
    category: 'hyundai',
  },
  {
    id: 'hyundai_demo_cars_list',
    name: 'Hyundai Demo Cars',
    description: 'Active fleet registry of demonstrator vehicles for Hyundai.',
    href: '/brands/hyundai/demo-cars-list',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'Car',
    initials: 'HD',
    category: 'hyundai',
  },
  {
    id: 'hyundai_demo_job_cards',
    name: 'Hyundai Demo Job Cards',
    description: 'Repair bookings and diagnostic logs for demo vehicles.',
    href: '/brands/hyundai/demo-job-cards',
    department: 'service',
    brand: 'hyundai',
    iconName: 'ClipboardList',
    initials: 'HJD',
    category: 'hyundai',
  },
  {
    id: 'hyundai_warranty_claim_list',
    name: 'Warranty Claims',
    description: 'Comprehensive database of processed and pending parts replacement claims.',
    href: '/brands/hyundai/warranty-claim-list',
    department: 'service',
    brand: 'hyundai',
    iconName: 'ShieldAlert',
    initials: 'WC',
    category: 'hyundai',
  },
  {
    id: 'hyundai_business_excellence',
    name: 'Hyundai Business Excellence',
    description: 'Standard evaluation scoring and workshop excellence reports for Hyundai.',
    href: '/brands/hyundai/business-excellence',
    department: 'service',
    brand: 'hyundai',
    iconName: 'Award',
    initials: 'HBE',
    category: 'hyundai',
  },

  // ── AM Platinum Service & Sales ──
  {
    id: 'platinum_proforma',
    name: 'Platinum Bookings',
    description: 'Create and print proforma invoices and sales bookings for Platinum vehicles.',
    href: '/brands/platinum/proforma',
    department: 'sales',
    brand: 'platinum',
    iconName: 'FileText',
    initials: 'PB',
    category: 'platinum',
  },
  {
    id: 'platinum_service_appointment',
    name: 'Platinum Service Appointment',
    description: 'Customer service slot booking calendar and advisor logs.',
    href: '/brands/platinum/service-appointment',
    department: 'service',
    brand: 'platinum',
    iconName: 'Calendar',
    initials: 'PSA',
    category: 'platinum',
  },
  {
    id: 'platinum_warranty_list',
    name: 'Platinum Claim YTP',
    description: 'Year-to-present claims list and pending warranty entries.',
    href: '/brands/platinum/warranty-list',
    department: 'service',
    brand: 'platinum',
    iconName: 'Sparkles',
    initials: 'PCY',
    category: 'platinum',
  },
  {
    id: 'platinum_warranty_claim_list',
    name: 'Platinum Warranty Claims',
    description: 'Comprehensive database of parts replacement claims for AM Platinum.',
    href: '/brands/platinum/warranty-claim-list',
    department: 'service',
    brand: 'platinum',
    iconName: 'ShieldAlert',
    initials: 'PWC',
    category: 'platinum',
  },
  {
    id: 'platinum_demo_cars_list',
    name: 'Platinum Demo Cars',
    description: 'Active fleet registry of demonstrator vehicles for Platinum.',
    href: '/brands/platinum/demo-cars-list',
    department: 'sales',
    brand: 'platinum',
    iconName: 'Car',
    initials: 'PD',
    category: 'platinum',
  },
  {
    id: 'platinum_demo_job_cards',
    name: 'Platinum Demo Job Cards',
    description: 'Repair bookings and diagnostic logs for demo vehicles.',
    href: '/brands/platinum/demo-job-cards',
    department: 'service',
    brand: 'platinum',
    iconName: 'ClipboardList',
    initials: 'PJD',
    category: 'platinum',
  },
  {
    id: 'platinum_business_excellence',
    name: 'Platinum Business Excellence',
    description: 'Standard evaluation scoring and workshop excellence reports for AM Platinum.',
    href: '/brands/platinum/business-excellence',
    department: 'service',
    brand: 'platinum',
    iconName: 'Award',
    initials: 'PBE',
    category: 'platinum',
  },

  // ── Added 2026-09-11: sections in the sidebar that search could not find ──
  // Each is gated in canUserAccessSection by the rule its sidebar link uses: an explicit branch above for
  // Data Health and the CA Portal, the generated permission key for the rest.
  {
    id: 'hyundai_sales_report',
    name: 'Hyundai Sales Report',
    description: 'Hyundai sales performance and retail figures.',
    href: '/brands/hyundai/sales-report',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'BarChart3',
    initials: 'HSR',
    category: 'hyundai',
  },
  {
    id: 'hyundai_discount_approvals',
    name: 'Hyundai Discount Approvals',
    description: 'Review and approve discount requests on Hyundai vehicle sales.',
    href: '/brands/hyundai/sales/discount-approvals',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'BadgePercent',
    initials: 'HDA',
    category: 'hyundai',
  },
  {
    id: 'platinum_sales_report',
    name: 'Platinum Sales Report',
    description: 'Platinum sales performance and retail figures.',
    href: '/brands/platinum/sales-report',
    department: 'sales',
    brand: 'platinum',
    iconName: 'BarChart3',
    initials: 'PSR',
    category: 'platinum',
  },
  {
    id: 'platinum_discount_approvals',
    name: 'Platinum Discount Approvals',
    description: 'Review and approve discount requests on Platinum vehicle sales.',
    href: '/brands/platinum/sales/discount-approvals',
    department: 'sales',
    brand: 'platinum',
    iconName: 'BadgePercent',
    initials: 'PDA',
    category: 'platinum',
  },
  // ── AM Tata · H Promise (pre-owned car desk). ONE entry, like its one sidebar row: it opens for anyone
  // holding any of the four H Promise sections (COMPOSITE_SIDEBAR_SECTIONS), all grant-only.
  {
    id: 'tata_h_promise',
    name: 'H Promise',
    description: 'AM Tata pre-owned cars: purchase, sale, booking, documents, exchange bonus, approvals, payment verification and MIS.',
    href: '/brands/tata/h-promise',
    department: 'sales',
    brand: 'tata',
    iconName: 'Car',
    initials: 'HP',
    category: 'tata',
  },
  {
    id: 'showroom_images',
    name: 'Showroom Images',
    description: 'Showroom photos captured across every dealership, with brand and location filters.',
    href: '/showroom-images',
    department: 'admin',
    brand: 'common',
    iconName: 'Camera',
    initials: 'SI',
    category: 'general_modules',
  },
  {
    id: 'ca_portal',
    name: 'CA Portal',
    description: 'Read-only chartered-accountant view of approved purchase orders and petty cash, branch-wise.',
    href: '/ca',
    department: 'finance',
    brand: 'common',
    iconName: 'Calculator',
    initials: 'CA',
    category: 'general_modules',
  },
  {
    id: 'data_health',
    name: 'Data Health',
    description: 'MD and Developer only: when each data feed last loaded, and how many rows it holds.',
    href: '/data-health',
    department: 'admin',
    brand: 'common',
    iconName: 'Activity',
    initials: 'DH',
    category: 'common_dashboards',
  },
]

export const ALLOWED_SIDEBAR_HREFS = new Set<string>([
  '/cockpit',
  // Added 2026-09-11 so every sidebar item can be found by search. Each is gated in canUserAccessSection.
  '/showroom-images',
  '/ca',
  '/data-health',
  '/social-media-leads',
  '/brands/hyundai/sales-report',
  '/brands/hyundai/sales/discount-approvals',
  '/brands/platinum/sales-report',
  '/brands/platinum/sales/discount-approvals',
  '/targets',
  '/bank-sanctions',
  '/delegation-tasks',
  '/call-analysis',
  '/brands/kia/insurance',
  '/brands/hyundai/insurance',
  '/brands/platinum/insurance',
  '/purchase-orders',
  '/petty-cash',
  '/am-finance',
  '/finance',
  '/brands/kia/payment-approvals',
  '/brands/kia/vendors',
  '/admin',
  '/scrap',
  '/scrap-erp',
  // ⚠️ Adding an href here is NOT optional for a new section. canUserAccessSection() hard-returns
  // false for anything absent from this set, so a section registered everywhere else is still
  // invisible to global search — which is exactly what happened to Fuel Approvals from its first
  // release until 2026-09-11, when it and Fuel Management were added below.
  //
  // The guard-facing /gate/<token> page is deliberately NOT listed: it is unauthenticated by
  // design and must never appear in a staff member's search results.
  '/gate-pass',
  '/fuel-approvals',
  '/fuel-management',

  // Kia
  '/brands/kia/activity',
  '/brands/kia/business-excellence',
  '/brands/kia/service-appointment',
  '/brands/kia/vehicle-tracker',
  '/brands/kia/proforma',
  '/brands/kia/sales-report',
  '/brands/kia/stock-report',
  '/brands/kia/sales-performance',
  '/brands/kia/call-center',
  '/brands/kia/follow-ups',
  '/brands/kia/call-analytics',
  '/brands/kia/booking-payment-history',
  '/customer-360',
  // Reached as a tab inside Bookings; the old standalone path stays allowed because it still
  // resolves (it redirects to the tab), so a bookmarked link is not blocked by the href allowlist.
  '/brands/kia/proforma/allocation-history',
  '/brands/kia/allocation-history',
  '/brands/kia/proforma/payment-window-requests',
  '/brands/kia/demo-job-cards',
  '/brands/kia/demo-cars-list',

  // Hyundai
  '/brands/hyundai/business-excellence',
  '/brands/hyundai/service-appointment',
  '/brands/hyundai/proforma',
  '/brands/hyundai/warranty-list',
  '/brands/hyundai/warranty-claim-list',
  '/brands/hyundai/demo-job-cards',
  '/brands/hyundai/demo-cars-list',
  
  // Platinum
  '/brands/platinum/business-excellence',
  '/brands/platinum/service-appointment',
  '/brands/platinum/proforma',
  '/brands/platinum/warranty-list',
  '/brands/platinum/warranty-claim-list',
  '/brands/platinum/demo-job-cards',
  '/brands/platinum/demo-cars-list',

  // AM Tata · H Promise — one link over four Access-Map sections
  '/brands/tata/h-promise',
])

/**
 * The view keys that open /fuel-management — the same ones app/fuel-management/page.tsx and
 * GET /api/fuel-management accept through lib/fuel-management/access.ts#canViewFuelManagement.
 * That predicate is server-only and cannot be imported here, so the keys are listed once for this
 * file and scripts/verify-fuel-management.ts fails if the two lists ever disagree.
 *
 * ⚠️ One key since 2026-09-11. fuel_approvals.view and gate_pass.view used to open it too, which put the
 * section in front of nearly every role; the owner restricted it to EA, MD and Developer.
 */
export const FUEL_MANAGEMENT_VIEW_KEYS = [
  'fuel_management.view',
] as const

/**
 * Evaluates whether a user is authorized to search/navigate to a section.
 * Implements strict parity with the sidebar navigation rules to prevent security leaks.
 */
export function canUserAccessSection(
  section: SearchSection,
  userRole: string | null | undefined,
  userBrand: string | null | undefined,
  permissionMap: Record<string, boolean> | null
): boolean {
  if (!userRole) return false

  // Verify that the section is actually present in the sidebar
  if (!ALLOWED_SIDEBAR_HREFS.has(section.href)) {
    return false
  }

  // 1. Super Admins (Developer & MD) always bypass permission gates
  if (isSuperAdminRole(userRole)) return true

  // 2. Brand Assignment Check (Skip for Common modules)
  if (section.brand !== 'common') {
    const isGlobal = hasGlobalAccessRole(userRole)
    const isAllBranches = hasAllBranchAccess(userBrand)
    const userBrandKeys = (userBrand || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)

    /*
     * ⚠️ AN ACCESS-MAP GRANT BEATS THE BRAND CHECK.
     *
     * Before 2026-09-16 this returned false for any cross-brand section no matter what an admin had
     * ticked, so a Hyundai user granted a KIA section could not find it in the sidebar OR in search —
     * the link simply did not exist, which reads as the grant never having been made.
     *
     * ⚠️ SAFE BECAUSE OF WHAT `permissionMap` IS. It is the EFFECTIVE map, and for a brand-prefixed
     * key outside the user's own brand `constrainSnapshotToBranch` has already zeroed every default —
     * role template, tier bundle and brand blanket alike. The ONLY way such a key reads `true` here is
     * the final loop in resolveEffectiveSnapshot re-applying an explicit `allowed = true` override.
     * So this widens by exactly the sections an admin ticked, and nothing else.
     *
     * The section's own key still has to pass at step 4; this only stops the brand vetoing first.
     */
    const sectionKey = SIDEBAR_PERMISSION_BY_HREF[section.href]
    const compositeKeys = compositeViewKeysForHref(section.href)
    const grantedAcrossBrand = compositeKeys
      ? Boolean(permissionMap && compositeKeys.some((key) => permissionMap[key] === true))
      : Boolean(sectionKey && permissionMap && permissionMap[sectionKey] === true)

    const hasBrandAccess = isGlobal || isAllBranches || userBrandKeys.includes(section.brand) || grantedAcrossBrand
    if (!hasBrandAccess) return false
  }

  // 3. Special Custom Gated Pages
  const href = section.href

  /*
   * ── FORMERLY "FIXED BY ROLE" ──────────────────────────────────────────────────────────────────
   * Owner decision 2026-09-16: "nothing should be fixed by role — if I want, I can give access to
   * those sections as well". Each of these six used to `return` a role verdict that no Access-Map
   * tick could reach. They now read "the role rule OR a grant", so the role keeps its default access
   * and an admin can widen it one person at a time.
   *
   * ⚠️ The grant is the EFFECTIVE map here, which is safe for exactly these keys: they are in
   * GRANT_ONLY_SECTIONS, so no template, tier bundle or blanket can set them. The only thing that
   * makes one true is an explicit tick (or being a super admin, who returned true far above).
   */
  const grantedHere = (key: string) => Boolean(permissionMap && permissionMap[key] === true)

  // Vehicle Tracker
  if (href === '/brands/kia/vehicle-tracker') {
    return canViewVehicleTracker(userRole) || grantedHere('kia.vehicle_tracker.view')
  }

  // Booking Payment History
  if (href === '/brands/kia/booking-payment-history') {
    return canViewBookingPaymentHistory(userRole, permissionMap)
  }

  // Testing - Social Media Leads
  if (href === '/social-media-leads') {
    return ['md', 'developer', 'admin'].includes(String(userRole || '').trim().toLowerCase())
      || grantedHere('social_media_leads.view')
  }

  // Scrap
  if (href === '/scrap' || href === '/scrap-erp') {
    return canAccessScrapErp(userRole, permissionMap)
  }

  // MD Targets — MD + Developer ONLY, and unwidenable.
  //
  // Same `return`-not-fall-through shape as the restricted-analytics guard below, for the same
  // reason: no later branch and no Access-Map grant may re-open it. There is deliberately no
  // permission key for this section, because a key would still reach `admin` and `hr` through the
  // super tier bundle — see lib/auth/md-targets-access.ts.
  if (isMdTargetsHref(href)) {
    return canViewMdTargets(userRole) || grantedHere('targets.view')
  }

  // Bank Sanctions — EA / MD / Accounts / Developer ONLY, unwidenable. Same `return`-not-
  // fall-through shape as the guards around it, and load-bearing for the same reason: this href has
  // no permission key, so without the return it would fall to the function's final `return true`
  // and become visible to every role. See lib/auth/bank-sanctions-access.ts.
  if (isBankSanctionsHref(href)) {
    // Already permission-aware through permissionMap; left as it is.
    return canViewBankSanctions(userRole, permissionMap)
  }

  // Call Analysis + Insurance Analysis — MD + Developer ONLY, and unwidenable.
  //
  // Checked with `return`, not a fall-through guard, so no later branch and no permission grant can
  // re-open them. Both the sidebar and both search surfaces route through here, so this single test
  // is what makes "no one else can see these at all" true everywhere at once.
  if (isRestrictedAnalyticsHref(href)) {
    /* ⚠️ Carries customer names and numbers for thousands of vehicles — grantable now, but one
     * person at a time and never by a role default. */
    return canViewRestrictedAnalytics(userRole) || grantedHere('call_analysis.view')
  }

  // Petty Cash
  if (href.startsWith('/petty-cash')) {
    const roleOk = isPettyCashViewRole(userRole)
    const permOk = permissionMap ? permissionMap['petty_cash.view'] === true : false
    return roleOk && permOk
  }

  // Delegation Tasks
  if (href === '/delegation-tasks') {
    const canAccessDelegationTasks = ['ea', 'eba', 'md', 'developer', 'admin'].includes(String(userRole || '').trim().toLowerCase())
    if (!canAccessDelegationTasks) return false
  }

  // AM Finance
  if (href.startsWith('/am-finance')) {
    const roleOk = isAmFinanceViewRole(userRole)
    const permOk = permissionMap ? permissionMap['am_finance.view'] === true : false
    return roleOk && permOk
  }

  // Admin Panel
  if (href.startsWith('/admin')) {
    /*
     * ⚠️ GRANTING THIS GRANTS THE CONSOLE — Users, Access Map, Roles, Audit, Settings. Whoever holds
     * it can edit permissions, including their own. Flagged to the owner; opened at their explicit
     * instruction. app/admin/page.tsx enforces the identical pair.
     */
    return isSuperAdminRole(userRole) || grantedHere('admin_panel.view')
  }

  // Data Health — MD + Developer ONLY, and unwidenable. Super admins already returned true above, so
  // everyone who reaches this line is refused. ⚠️ Load-bearing: the href has no permission key, so
  // without this return it falls through to the function's final `return true` and appears in EVERY
  // role's search — an operations tool exposing table names and row counts across every brand.
  if (href === '/data-health') {
    // Exposes table names and row counts across every brand — grantable, never defaulted.
    return grantedHere('data_health.view')
  }

  // CA Portal — mirrors the sidebar exactly: the CA role list OR an explicit ca.view. The generated
  // fallback below tests ca.view alone, which would hide the section from the CA role it exists for.
  if (href === '/ca') {
    return isCaViewRole(userRole) || (permissionMap ? permissionMap['ca.view'] === true : false)
  }

  // Fuel Management — admitted by its own view key only, the one its page and API accept through
  // canViewFuelManagement. Until 2026-09-11 fuel_approvals.view and gate_pass.view opened it too; the
  // owner restricted it to EA, MD and Developer. Fail-closed while the map loads. /fuel-approvals needs
  // no branch: the fallback below already tests 'fuel_approvals.view', exactly the key its page uses.
  //
  // ⚠️ Known edge this map cannot close: an explicit Access-Map Deny on fuel_management.view blocks the
  // page, but an effective map cannot tell a deny from a key never granted. The page and the API remain
  // the authority.
  if (href === '/fuel-management') {
    const map = permissionMap
    if (!map) return false
    return FUEL_MANAGEMENT_VIEW_KEYS.some((key) => map[key] === true)
  }

  // One link over several Access-Map sections (AM Tata · H Promise): any of them opens it.
  const compositeKeys = compositeViewKeysForHref(href)
  if (compositeKeys) {
    if (!permissionMap) return false
    return compositeKeys.some((key) => permissionMap[key] === true)
  }

  // 4. Standard Permission Keys
  const permissionKey = SIDEBAR_PERMISSION_BY_HREF[href]
  if (permissionKey) {
    if (!permissionMap) return false // Fail-closed while permission mapping is loading
    return permissionMap[permissionKey] === true
  }

  return true
}
