import { SIDEBAR_PERMISSION_BY_HREF } from '@/lib/permissions/navigation'
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
export type SectionCategory = 'common_dashboards' | 'general_modules' | 'kia' | 'hyundai' | 'platinum'

export interface SearchSection {
  id: string
  name: string
  description: string
  href: string
  department: DepartmentType
  brand: 'kia' | 'hyundai' | 'platinum' | 'mg' | 'common'
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
  {
    id: 'insurance_analysis',
    name: 'Insurance Analysis',
    description: 'Hyundai, Platinum and Kia insurance policy analytics — executive KPIs, premium and revenue, insurer performance, and vehicle-level customer retention.',
    href: '/insurance',
    department: 'admin',
    brand: 'common',
    iconName: 'ShieldCheck',
    initials: 'IA',
    category: 'common_dashboards',
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
    // 'common', not 'kia': the tables carry a brand column from day one and the section is meant to
    // widen. Marking it 'kia' would make canUserAccessSection apply the brand check and hide it
    // from anyone whose users.brand does not literally contain 'kia'.
    brand: 'common',
    iconName: 'ScanLine',
    initials: 'GP',
    category: 'general_modules',
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
    name: 'Sales Performance',
    description: 'Detailed metrics on consultant performance, conversion rates, and targets.',
    href: '/brands/kia/sales-performance',
    department: 'sales',
    brand: 'kia',
    iconName: 'TrendingUp',
    badge: 'TEST',
    initials: 'SP',
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
]

export const ALLOWED_SIDEBAR_HREFS = new Set<string>([
  '/cockpit',
  '/targets',
  '/bank-sanctions',
  '/delegation-tasks',
  '/call-analysis',
  '/insurance',
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
  // invisible to global search — which is exactly what happened to Fuel Approvals, and why it
  // cannot be found by searching for it today.
  //
  // The guard-facing /gate/<token> page is deliberately NOT listed: it is unauthenticated by
  // design and must never appear in a staff member's search results.
  '/gate-pass',

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
])

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
    
    const hasBrandAccess = isGlobal || isAllBranches || userBrandKeys.includes(section.brand)
    if (!hasBrandAccess) return false
  }

  // 3. Special Custom Gated Pages
  const href = section.href

  // Vehicle Tracker
  if (href === '/brands/kia/vehicle-tracker') {
    return canViewVehicleTracker(userRole)
  }

  // Booking Payment History
  if (href === '/brands/kia/booking-payment-history') {
    return canViewBookingPaymentHistory(userRole, permissionMap)
  }

  // Testing - Social Media Leads
  if (href === '/social-media-leads') {
    return ['md', 'developer', 'admin'].includes(String(userRole || '').trim().toLowerCase())
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
    return canViewMdTargets(userRole)
  }

  // Bank Sanctions — EA / MD / Accounts / Developer ONLY, unwidenable. Same `return`-not-
  // fall-through shape as the guards around it, and load-bearing for the same reason: this href has
  // no permission key, so without the return it would fall to the function's final `return true`
  // and become visible to every role. See lib/auth/bank-sanctions-access.ts.
  if (isBankSanctionsHref(href)) {
    return canViewBankSanctions(userRole, permissionMap)
  }

  // Call Analysis + Insurance Analysis — MD + Developer ONLY, and unwidenable.
  //
  // Checked with `return`, not a fall-through guard, so no later branch and no permission grant can
  // re-open them. Both the sidebar and both search surfaces route through here, so this single test
  // is what makes "no one else can see these at all" true everywhere at once.
  if (isRestrictedAnalyticsHref(href)) {
    return canViewRestrictedAnalytics(userRole)
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
    // Must match app/admin/page.tsx, which gates on isSuperAdminRole (developer || md). Listing
  // 'admin' here let that role find /admin in search and then be forbidden by the page.
  return isSuperAdminRole(userRole)
  }

  // 4. Standard Permission Keys
  const permissionKey = SIDEBAR_PERMISSION_BY_HREF[href]
  if (permissionKey) {
    if (!permissionMap) return false // Fail-closed while permission mapping is loading
    return permissionMap[permissionKey] === true
  }

  return true
}
