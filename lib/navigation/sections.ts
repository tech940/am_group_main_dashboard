import { SIDEBAR_PERMISSION_BY_HREF } from '@/lib/permissions/navigation'
import { isSuperAdminRole, hasGlobalAccessRole } from '@/lib/auth/roles'
import { hasAllBranchAccess } from '@/lib/branches'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { isPettyCashViewRole, isAmFinanceViewRole, isCaViewRole } from '@/lib/permissions/legacy-module-roles'

// Define the departments we support
export type DepartmentType = 'sales' | 'service' | 'finance' | 'admin'

export interface SearchSection {
  id: string
  name: string
  description: string
  href: string
  department: DepartmentType
  brand: 'kia' | 'hyundai' | 'platinum' | 'mg' | 'common'
  iconName: string
  badge?: string
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
  },
  {
    id: 'delegation_tasks',
    name: 'Delegation Tasks',
    description: 'Assign action items to your team and track them to completion.',
    href: '/delegation-tasks',
    department: 'admin',
    brand: 'common',
    iconName: 'ClipboardList',
  },
  {
    id: 'purchase_orders',
    name: 'Purchase Orders',
    description: 'Create, review, and approve corporate purchase orders across the group.',
    href: '/purchase-orders',
    department: 'admin',
    brand: 'common',
    iconName: 'ShoppingCart',
  },
  {
    id: 'admin_panel',
    name: 'Admin Panel',
    description: 'System administration, user account creation, role assignments, and permission overrides.',
    href: '/admin',
    department: 'admin',
    brand: 'common',
    iconName: 'Shield',
  },

  // ── Finance & Accounts ──
  {
    id: 'petty_cash',
    name: 'Petty Cash',
    description: 'Log and track cash vouchers, local store expenses, and branch petty cash approvals.',
    href: '/petty-cash',
    department: 'finance',
    brand: 'common',
    iconName: 'Banknote',
  },
  {
    id: 'am_finance',
    name: 'AM Finance',
    description: 'Consolidated accounts, treasury oversight, and group-level financial monitoring.',
    href: '/am-finance',
    department: 'finance',
    brand: 'common',
    iconName: 'Landmark',
  },
  {
    id: 'kia_approvals',
    name: 'Vendor Payments',
    description: 'Review pending vendor payment requests, attachments, and multi-stage workflows.',
    href: '/brands/kia/payment-approvals',
    department: 'finance',
    brand: 'common',
    iconName: 'FileCheck',
  },
  {
    id: 'kia_vendors',
    name: 'Vendor Registry',
    description: 'Manage registered vendors, business address records, contact info, and GSTINs.',
    href: '/brands/kia/vendors',
    department: 'finance',
    brand: 'common',
    iconName: 'Users',
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
  },
  {
    id: 'kia_sales_report',
    name: 'Sales Report',
    description: 'Track retail targets, lost cases, customer conversion ratios, and delivery volumes.',
    href: '/brands/kia/sales-report',
    department: 'sales',
    brand: 'kia',
    iconName: 'BarChart3',
  },
  {
    id: 'kia_stock_report',
    name: 'Stock Report',
    description: 'Live physical inventory of vehicles: filter by status, age, model, color, and location.',
    href: '/brands/kia/stock-report',
    department: 'sales',
    brand: 'kia',
    iconName: 'Layers',
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
  },
  {
    id: 'kia_call_center',
    name: 'Call Center',
    description: 'Inbound and outbound telephone lead management and customer CRM registry.',
    href: '/brands/kia/call-center',
    department: 'sales',
    brand: 'kia',
    iconName: 'PhoneCall',
    badge: 'TEST',
  },
  {
    id: 'kia_lead_followups',
    name: 'Booking Follow-ups',
    description: 'Pending callback schedules, next follow-up dates, and logs of active customer conversations.',
    href: '/brands/kia/follow-ups',
    department: 'sales',
    brand: 'kia',
    iconName: 'Clock',
    badge: 'TEST',
  },
  {
    id: 'kia_call_analytics',
    name: 'Call & Follow-up Analytics',
    description: 'Comprehensive conversion funnels, call metrics, and performance charts.',
    href: '/brands/kia/call-analytics',
    department: 'sales',
    brand: 'kia',
    iconName: 'PieChart',
    badge: 'TEST',
  },
  {
    id: 'kia_demo_cars_list',
    name: 'Demo Cars List',
    description: 'Current fleet registry of demonstrator vehicles for customer test drives.',
    href: '/brands/kia/demo-cars-list',
    department: 'sales',
    brand: 'kia',
    iconName: 'Car',
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
  },
  {
    id: 'kia_service_appointment',
    name: 'Service Appointment',
    description: 'Schedule, log, and assign maintenance bookings for customer vehicles.',
    href: '/brands/kia/service-appointment',
    department: 'service',
    brand: 'kia',
    iconName: 'Calendar',
  },
  {
    id: 'kia_vehicle_tracker',
    name: 'Vehicle Tracker',
    description: 'Live workshop tracker for vehicle status, bay occupancy, and job cards.',
    href: '/brands/kia/vehicle-tracker',
    department: 'service',
    brand: 'kia',
    iconName: 'Truck',
  },
  {
    id: 'kia_demo_job_cards',
    name: 'Demo Job Cards',
    description: 'Log and track repair orders and job cards specific to demonstrator fleet cars.',
    href: '/brands/kia/demo-job-cards',
    department: 'service',
    brand: 'kia',
    iconName: 'ClipboardList',
  },

  // ── AM Hyundai Service ──
  {
    id: 'hyundai_business_excellence',
    name: 'Hyundai Business Excellence',
    description: 'Standard evaluation scoring and workshop excellence reports for Hyundai.',
    href: '/brands/hyundai/business-excellence',
    department: 'service',
    brand: 'hyundai',
    iconName: 'Award',
  },
  {
    id: 'hyundai_service_appointment',
    name: 'Hyundai Service Appointment',
    description: 'Customer service slot booking calendar and advisor logs.',
    href: '/brands/hyundai/service-appointment',
    department: 'service',
    brand: 'hyundai',
    iconName: 'Calendar',
  },
  {
    id: 'hyundai_warranty_list',
    name: 'Claim YTP',
    description: 'Year-to-present claims list and pending warranty entries.',
    href: '/brands/hyundai/warranty-list',
    department: 'service',
    brand: 'hyundai',
    iconName: 'Sparkles',
  },
  {
    id: 'hyundai_warranty_claim_list',
    name: 'Warranty Claims',
    description: 'Comprehensive database of processed and pending parts replacement claims.',
    href: '/brands/hyundai/warranty-claim-list',
    department: 'service',
    brand: 'hyundai',
    iconName: 'ShieldAlert',
  },

  // ── AM Hyundai Sales ──
  {
    id: 'hyundai_proforma',
    name: 'Hyundai Bookings',
    description: 'Create and print proforma invoices and sales bookings for Hyundai vehicles.',
    href: '/brands/hyundai/proforma',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'FileText',
  },
  {
    id: 'hyundai_demo_cars_list',
    name: 'Hyundai Demo Cars',
    description: 'Active fleet registry of demonstrator vehicles for Hyundai.',
    href: '/brands/hyundai/demo-cars-list',
    department: 'sales',
    brand: 'hyundai',
    iconName: 'Car',
  },
  {
    id: 'hyundai_demo_job_cards',
    name: 'Hyundai Demo Job Cards',
    description: 'Repair bookings and diagnostic logs for demo vehicles.',
    href: '/brands/hyundai/demo-job-cards',
    department: 'service',
    brand: 'hyundai',
    iconName: 'ClipboardList',
  },

  // ── AM Platinum Service ──
  {
    id: 'platinum_business_excellence',
    name: 'Platinum Business Excellence',
    description: 'Standard evaluation scoring and workshop excellence reports for AM Platinum.',
    href: '/brands/platinum/business-excellence',
    department: 'service',
    brand: 'platinum',
    iconName: 'Award',
  },
  {
    id: 'platinum_service_appointment',
    name: 'Platinum Service Appointment',
    description: 'Customer service slot booking calendar and advisor logs.',
    href: '/brands/platinum/service-appointment',
    department: 'service',
    brand: 'platinum',
    iconName: 'Calendar',
  },
  {
    id: 'platinum_warranty_list',
    name: 'Platinum Claim YTP',
    description: 'Year-to-present claims list and pending warranty entries.',
    href: '/brands/platinum/warranty-list',
    department: 'service',
    brand: 'platinum',
    iconName: 'Sparkles',
  },
  {
    id: 'platinum_warranty_claim_list',
    name: 'Platinum Warranty Claims',
    description: 'Comprehensive database of parts replacement claims for AM Platinum.',
    href: '/brands/platinum/warranty-claim-list',
    department: 'service',
    brand: 'platinum',
    iconName: 'ShieldAlert',
  },

  // ── AM Platinum Sales ──
  {
    id: 'platinum_proforma',
    name: 'Platinum Bookings',
    description: 'Create and print proforma invoices and sales bookings for Platinum vehicles.',
    href: '/brands/platinum/proforma',
    department: 'sales',
    brand: 'platinum',
    iconName: 'FileText',
  },
  {
    id: 'platinum_demo_cars_list',
    name: 'Platinum Demo Cars',
    description: 'Active fleet registry of demonstrator vehicles for Platinum.',
    href: '/brands/platinum/demo-cars-list',
    department: 'sales',
    brand: 'platinum',
    iconName: 'Car',
  },
  {
    id: 'platinum_demo_job_cards',
    name: 'Platinum Demo Job Cards',
    description: 'Repair bookings and diagnostic logs for demo vehicles.',
    href: '/brands/platinum/demo-job-cards',
    department: 'service',
    brand: 'platinum',
    iconName: 'ClipboardList',
  },
]

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

  // Petty Cash
  if (href.startsWith('/petty-cash')) {
    const roleOk = isPettyCashViewRole(userRole)
    const permOk = permissionMap ? permissionMap['petty_cash.view'] === true : false
    return roleOk && permOk
  }

  // AM Finance
  if (href.startsWith('/am-finance')) {
    const roleOk = isAmFinanceViewRole(userRole)
    const permOk = permissionMap ? permissionMap['am_finance.view'] === true : false
    return roleOk && permOk
  }

  // Admin Panel
  if (href.startsWith('/admin')) {
    return userRole === 'admin' || userRole === 'developer'
  }

  // 4. Standard Permission Keys
  const permissionKey = SIDEBAR_PERMISSION_BY_HREF[href]
  if (permissionKey) {
    if (!permissionMap) return false // Fail-closed while permission mapping is loading
    return permissionMap[permissionKey] === true
  }

  return true
}
