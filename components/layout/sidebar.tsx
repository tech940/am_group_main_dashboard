'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Activity,
  Menu,
  X,
  Settings,
  Users,
  Shield,
  KeyRound,
  ShoppingCart,
  Banknote,
  Landmark,
} from 'lucide-react'
import { CascadingNav, type NavNode, type NavGroup } from './sidebar-cascading-nav'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { hasGlobalAccessRole } from '@/lib/auth/roles'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'

const HYUNDAI_LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/44/Hyundai_Motor_Company_logo.svg'

type SidebarSubmenu = { name: string; href: string }
type SidebarSection = { name: string; key: string; href?: string; submenus: SidebarSubmenu[] }
type SidebarBrand = {
  name: string
  key: string
  href: string
  logo: string
  logoClassName: string
  logoContainerClassName: string
  color: string
  icon: typeof Activity
  comingSoon: boolean
  sections: SidebarSection[]
}

const brandNavigation: SidebarBrand[] = [
  {
    name: 'AM Kia',
    key: 'kia',
    href: '/brands/kia',
    logo: 'https://www.citypng.com/public/uploads/preview/kia-white-logo-hd-png-7017516947105094q5qjti6gq.png',
    logoClassName: 'p-1.5',
    logoContainerClassName: '',
    color: 'text-blue-100',
    icon: Activity,
    comingSoon: false,
    sections: [
      {
        name: 'Service',
        key: 'service',
        submenus: [
          { name: 'Business Excellence', href: '/brands/kia/business-excellence' },
          { name: 'Service Appointment', href: '/brands/kia/service-appointment' },
        ],
      },
      {
        name: 'Sales',
        key: 'sales',
        submenus: [
          { name: 'Bookings', href: '/brands/kia/proforma' },
          { name: 'Sales Report', href: '/brands/kia/sales-report' },
          { name: 'Stock Report', href: '/brands/kia/stock-report' },
          { name: 'Demo Job Cards', href: '/brands/kia/demo-job-cards' },
          { name: 'Demo Cars List', href: '/brands/kia/demo-cars-list' },
        ],
      },
      {
        name: 'H Promise',
        key: 'h-promise',
        submenus: [],
      },
    ],
  },
  {
    name: 'AM Hyundai',
    key: 'hyundai',
    href: '/brands/hyundai',
    logo: HYUNDAI_LOGO_URL,
    logoClassName: 'p-1',
    logoContainerClassName: 'bg-white group-hover:bg-white',
    color: 'text-blue-100',
    icon: Activity,
    comingSoon: false,
    sections: [
      {
        name: 'Service',
        key: 'service',
        submenus: [
          { name: 'Business Excellence', href: '/brands/hyundai/business-excellence' },
          { name: 'Service Appointment', href: '/brands/hyundai/service-appointment' },
          { name: 'Hyundai Proforma', href: '/brands/hyundai/proforma' },
          { name: 'Claim YTP', href: '/brands/hyundai/warranty-list' },
          { name: 'Warranty Claim List', href: '/brands/hyundai/warranty-claim-list' },
        ],
      },
      {
        name: 'Sales',
        key: 'sales',
        submenus: [
          { name: 'Demo Job Cards', href: '/brands/hyundai/demo-job-cards' },
          { name: 'Demo Cars List', href: '/brands/hyundai/demo-cars-list' },
        ],
      },
      {
        name: 'H Promise',
        key: 'h-promise',
        submenus: [],
      },
    ],
  },
  {
    name: 'AM Platinum',
    key: 'platinum',
    href: '/brands/platinum',
    logo: HYUNDAI_LOGO_URL,
    logoClassName: 'p-1',
    logoContainerClassName: 'bg-white group-hover:bg-white',
    color: 'text-blue-100',
    icon: Activity,
    comingSoon: false,
    sections: [
      {
        name: 'Service',
        key: 'service',
        submenus: [
          { name: 'Business Excellence', href: '/brands/platinum/business-excellence' },
          { name: 'Service Appointment', href: '/brands/platinum/service-appointment' },
          { name: 'Platinum Proforma', href: '/brands/platinum/proforma' },
          { name: 'Claim YTP', href: '/brands/platinum/warranty-list' },
          { name: 'Warranty Claim List', href: '/brands/platinum/warranty-claim-list' },
        ],
      },
      {
        name: 'Sales',
        key: 'sales',
        submenus: [
          { name: 'Demo Job Cards', href: '/brands/platinum/demo-job-cards' },
          { name: 'Demo Cars List', href: '/brands/platinum/demo-cars-list' },
        ],
      },
      {
        name: 'H Promise',
        key: 'h-promise',
        submenus: [],
      },
    ],
  },
  {
    name: 'AM MG',
    key: 'mg',
    href: '/brands/mg',
    logo: '',
    logoClassName: '',
    logoContainerClassName: '',
    color: 'text-blue-100',
    icon: Activity,
    comingSoon: false,
    sections: [
      {
        name: 'Service',
        key: 'service',
        submenus: [
          { name: 'Business Excellence', href: '/brands/mg/business-excellence/overview' },
          { name: 'Service Appointment', href: '/brands/mg/service-appointment' },
          { name: 'MG Proforma', href: '/brands/mg/proforma' },
        ],
      },
      {
        name: 'Sales',
        key: 'sales',
        submenus: [
          { name: 'Demo Job Cards', href: '/brands/mg/demo-job-cards' },
          { name: 'Demo Cars List', href: '/brands/mg/demo-cars-list' },
        ],
      },
      {
        name: 'H Promise',
        key: 'h-promise',
        submenus: [],
      },
    ],
  },
]

const availableBrands = brandNavigation.filter((brand) => brand.sections.some((section) => section.submenus.length > 0))

// The single section a Branch Sales person is allowed to see/access.
const BOOKINGS_HREF = '/brands/kia/proforma'
const alwaysVisibleBrandKeys = new Set<string>()
const DEFAULT_SIDEBAR_FAVOURITES: string[] = []

const sidebarPermissionByHref: Record<string, string> = {
  '/purchase-orders': 'purchase_orders.view',
  '/finance-orders': 'finance_orders.view',
  '/petty-cash': 'petty_cash.view',
  '/am-finance': 'am_finance.view',
  '/brands/kia/business-excellence': 'kia.business_excellence.view',
  '/brands/kia/business-excellence/executive-dashboard': 'kia.business_excellence.view',
  '/brands/kia/business-excellence/overview': 'kia.business_excellence.view',
  '/brands/kia/service-appointment': 'kia.service_appointment.view',
  '/brands/kia/demo-job-cards': 'kia.demo_job_cards.view',
  '/brands/kia/demo-cars-list': 'kia.demo_cars_list.view',
  '/brands/kia/sales-report': 'kia.sales_report.view',
  '/brands/kia/stock-report': 'kia.stock_report.view',
  '/brands/kia/bookings': 'kia.bookings.view',
  '/brands/kia/proforma': 'kia.proforma.view',
  '/brands/kia/insurance': 'kia.insurance.view',
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

function isSidebarHrefActive(href: string, pathname: string | null) {
  if (!pathname) return false
  if (href.includes('/business-excellence')) {
    return pathname.startsWith(href.replace(/\/(overview|executive-dashboard)$/, ''))
  }
  if (href.endsWith('/proforma')) {
    return pathname.startsWith(href)
  }
  return pathname === href
}

function isKiaSalesReportRoleAllowed(role: string | null | undefined) {
  const normalized = String(role || '').trim().toLowerCase()
  return normalized === 'super_admin' || normalized === 'md' || normalized === 'eba'
}


export function Sidebar() {
  const pathname = usePathname()
  const { collapsed, setCollapsed } = useSidebar()
  const [permissionMap, setPermissionMap] = useState<Record<string, boolean> | null>(null)
  const { userRole, canAccessAdmin, isSuperAdmin, userBrand, loading } = useUserRole()
  const {
    value: favouriteHrefsValue,
    savePreference: saveFavouriteHrefs,
  } = useUserPreferences<string[]>('sidebar_favourites', DEFAULT_SIDEBAR_FAVOURITES)
  // Branch Admin is locked to Petty Cash only — everything else is hidden.
  const pettyCashOnly = userRole === 'branch_admin'
  // Branch Sales person is locked to the Bookings section only.
  const bookingsOnly = userRole === 'sales_executive'
  const canAccessFinanceOrders = !pettyCashOnly && ['admin', 'super_admin', 'ceo', 'md', 'ea', 'eba', 'accounts', 'finance_head'].includes(userRole || '')
  const canAccessPettyCash = ['admin', 'super_admin', 'branch_admin', 'ea', 'md', 'eba', 'accounts'].includes(userRole || '')
  const canAccessAmFinance = !pettyCashOnly && ['admin', 'super_admin', 'ceo', 'md', 'ea', 'eba'].includes(userRole || '')
  const favouriteHrefs = Array.isArray(favouriteHrefsValue) ? favouriteHrefsValue : []

  useEffect(() => {
    if (loading || !userRole) return

    let cancelled = false
    fetch('/api/auth/permissions')
      .then((response) => response.ok ? response.json() : null)
      .then((data: { permissions?: Record<string, boolean> | null } | null) => {
        if (!cancelled && data?.permissions) setPermissionMap(data.permissions)
      })
      .catch(() => {
        if (!cancelled) setPermissionMap(null)
      })

    return () => {
      cancelled = true
    }
  }, [loading, userRole])

  const hasPermission = (permissionKey: string) => {
    if (hasGlobalAccessRole(userRole)) return true
    if (!permissionMap) return true
    return permissionMap[permissionKey] === true
  }

  const isEligibleFavouriteHref = useCallback((href: string) => {
    return href.startsWith('/brands/')
  }, [])

  const isSidebarItemVisible = useCallback((href: string, brandKey: string) => {
    // Branch Sales person: nothing but the Bookings section.
    if (bookingsOnly && href !== BOOKINGS_HREF) {
      return false
    }
    if ((href === '/brands/kia/sales-report' || href === '/brands/kia/stock-report') && !isKiaSalesReportRoleAllowed(userRole)) {
      return false
    }

    const permissionKey = sidebarPermissionByHref[href]
    const isBrandUser = userBrand === brandKey || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
    if (permissionKey && !isBrandUser && !hasPermission(permissionKey)) {
      return false
    }

    return true
  }, [userBrand, userRole, permissionMap, bookingsOnly])

  const toggleFavourite = useCallback(async (href: string) => {
    if (!isEligibleFavouriteHref(href)) return
    const next = favouriteHrefs.includes(href)
      ? favouriteHrefs.filter((item) => item !== href)
      : [...favouriteHrefs.filter((item) => item !== href), href]
    await saveFavouriteHrefs(next)
  }, [favouriteHrefs, isEligibleFavouriteHref, saveFavouriteHrefs])

  const visibleBrands = useMemo(() => {
    if (pettyCashOnly) return []
    if (bookingsOnly) return availableBrands.filter((brand) => brand.key === 'kia')
    return availableBrands
      .filter((brand) => {
        if (brand.key === 'mg') return true
        if (alwaysVisibleBrandKeys.has(brand.key)) return true
        if (hasGlobalAccessRole(userRole)) return true
        if (!userBrand) return false
        if (hasAllBranchAccess(userBrand)) return true
        return brand.key === userBrand
      })
      .sort((a, b) => {
        if (userBrand) {
          if (a.key === userBrand) return -1
          if (b.key === userBrand) return 1
        }

        const aOrder = BRANCH_OPTIONS.findIndex((branch) => branch.value === a.key)
        const bOrder = BRANCH_OPTIONS.findIndex((branch) => branch.value === b.key)
        return aOrder - bOrder
      })
  }, [userBrand, userRole, pettyCashOnly, bookingsOnly])

  const favouriteItems = useMemo(() => {
    const itemMap = new Map<string, { href: string; label: string; brandName: string }>()
    for (const brand of visibleBrands) {
      for (const section of brand.sections) {
        if ('href' in section && section.href && isSidebarItemVisible(section.href, brand.key) && isEligibleFavouriteHref(section.href)) {
          itemMap.set(section.href, { href: section.href, label: section.name, brandName: brand.name })
        }

        for (const submenu of section.submenus) {
          if (!isSidebarItemVisible(submenu.href, brand.key) || !isEligibleFavouriteHref(submenu.href)) continue
          itemMap.set(submenu.href, {
            href: submenu.href,
            label: submenu.name,
            brandName: brand.name,
          })
        }
      }
    }

    return favouriteHrefs
      .map((href) => itemMap.get(href))
      .filter((item): item is { href: string; label: string; brandName: string } => Boolean(item))
  }, [favouriteHrefs, isEligibleFavouriteHref, isSidebarItemVisible, visibleBrands])

  const handleSidebarLinkClick = () => {
    setCollapsed(true)
  }

  // Build the gated, grouped navigation (Favourites · Common · Branches).
  const navGroups = useMemo<NavGroup[]>(() => {
    const groups: NavGroup[] = []

    // ── Favourites (starred sub-pages) ──
    if (favouriteItems.length > 0) {
      groups.push({
        key: 'favourites',
        label: 'Favourites',
        nodes: favouriteItems.map((item) => ({
          key: item.href,
          label: item.label,
          href: item.href,
          external: true,
          active: isSidebarHrefActive(item.href, pathname),
          favourite: { active: true, onToggle: () => void toggleFavourite(item.href) },
        })),
      })
    }

    // ── Common / global modules (shared across every branch) ──
    const commonNodes: NavNode[] = []
    if (hasPermission('purchase_orders.view')) commonNodes.push({ key: '/purchase-orders', label: 'Purchase Orders', href: '/purchase-orders', icon: ShoppingCart, external: true, active: pathname === '/purchase-orders' })
    if ((canAccessFinanceOrders || permissionMap) && hasPermission('finance_orders.view')) commonNodes.push({ key: '/finance-orders', label: 'Finance Orders', href: '/finance-orders', icon: Landmark, external: true, active: pathname === '/finance-orders' })
    if ((canAccessPettyCash || permissionMap) && hasPermission('petty_cash.view')) commonNodes.push({ key: '/petty-cash', label: 'Petty Cash', href: '/petty-cash', icon: Banknote, external: true, active: pathname === '/petty-cash' })
    if (canAccessAmFinance) commonNodes.push({ key: '/am-finance', label: 'AM Finance', href: '/am-finance', icon: Landmark, external: true, active: pathname === '/am-finance' })
    if (canAccessAdmin) {
      const adminActive = Boolean(pathname?.startsWith('/admin'))
      const adminChildren: NavNode[] = [
        { key: 'admin-users', label: 'User Management', href: '/admin?tab=users', icon: Users, active: adminActive },
        { key: 'admin-access', label: 'Access Control', href: '/admin?tab=access', icon: KeyRound },
      ]
      if (isSuperAdmin) {
        adminChildren.push({ key: 'admin-branch', label: 'Branch Admins', href: '/admin?tab=branch-admins', icon: KeyRound })
        adminChildren.push({ key: 'admin-system', label: 'System · Reset Test Data', href: '/admin?tab=system', icon: Settings })
        adminChildren.push({ key: 'admin-settings', label: 'Dashboard Settings', href: '/admin?tab=settings', icon: Settings })
      }
      commonNodes.push({ key: 'admin', label: 'Admin Panel', icon: Shield, children: adminChildren })
    }
    if (commonNodes.length > 0) groups.push({ key: 'common', label: 'Common', nodes: commonNodes })

    // ── Branches → Sections → Submenus (cascade), reusing the existing gating ──
    const brandNodes: NavNode[] = []
    for (const brand of visibleBrands) {
      const isBrandUser = userBrand === brand.key || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
      const sections: NavNode[] = []
      for (const section of brand.sections) {
        const directHref = 'href' in section ? section.href : undefined
        const hasChildren = section.submenus.length > 0
        if (bookingsOnly && !hasChildren) continue
        const directPermissionKey = directHref ? sidebarPermissionByHref[directHref] : undefined
        const directLocked = directHref && !isBrandUser && directPermissionKey ? !hasPermission(directPermissionKey) : false
        if (directHref && directLocked) continue
        const visibleSubmenus = section.submenus.filter((sub) => {
          if (!isSidebarItemVisible(sub.href, brand.key)) return false
          const permissionKey = sidebarPermissionByHref[sub.href]
          const subLocked = isBrandUser ? false : (permissionKey ? !hasPermission(permissionKey) : false)
          return !subLocked
        })
        if (hasChildren && visibleSubmenus.length === 0) continue
        if (directHref) {
          sections.push({
            key: section.key,
            label: section.name,
            href: directHref,
            external: true,
            active: isSidebarHrefActive(directHref, pathname),
            favourite: isEligibleFavouriteHref(directHref) ? { active: favouriteHrefs.includes(directHref), onToggle: () => void toggleFavourite(directHref) } : undefined,
          })
        } else {
          sections.push({
            key: section.key,
            label: section.name,
            children: visibleSubmenus.map((sub) => ({
              key: sub.href,
              label: sub.name,
              href: sub.href,
              external: true,
              active: isSidebarHrefActive(sub.href, pathname),
              favourite: isEligibleFavouriteHref(sub.href) ? { active: favouriteHrefs.includes(sub.href), onToggle: () => void toggleFavourite(sub.href) } : undefined,
            })),
          })
        }
      }
      if (sections.length === 0) continue
      brandNodes.push({
        key: brand.key,
        label: brand.name,
        logo: brand.logo || undefined,
        logoClassName: brand.logoClassName,
        logoContainerClassName: brand.logoContainerClassName,
        icon: brand.icon,
        disabled: brand.comingSoon,
        badge: brand.comingSoon ? 'Soon' : undefined,
        children: sections,
      })
    }
    if (brandNodes.length > 0) groups.push({ key: 'branches', label: 'Branches', nodes: brandNodes })

    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favouriteItems, favouriteHrefs, visibleBrands, pathname, permissionMap, canAccessAdmin, isSuperAdmin, canAccessFinanceOrders, canAccessPettyCash, canAccessAmFinance, userBrand, userRole, bookingsOnly, isSidebarItemVisible, isEligibleFavouriteHref, toggleFavourite])

  return (
    <>
      {/* Semi-transparent Grey Backdrop */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-300 animate-in fade-in"
          onClick={() => setCollapsed(true)}
        />
      )}

      <div
        className={cn(
          'app-sidebar-brand fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-white/20 bg-[#023468] shadow-2xl shadow-slate-950/20 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:border-white/10 dark:bg-[#012348]',
          collapsed ? 'w-0 border-none' : 'w-72 max-w-[86vw]'
        )}
      >
        {/* Header with Hamburger */}
        <div className={cn(
          "z-10 flex shrink-0 items-center border-b border-white/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.10)_100%)] transition-all duration-500",
          collapsed ? "h-20 justify-center px-0" : "h-20 justify-between px-4"
        )}>
          {!collapsed && (
            <div className="flex items-center gap-2 h-12 flex-1 ml-1">
              <div className="rounded-lg border border-white/10 bg-black px-3 py-4 shadow-sm">
                <img
                  src="https://amgroupind.com/wp-content/uploads/2023/06/logo-1.png"
                  alt="AM Group"
                  className="h-9 object-contain"
                />
              </div>
              <div className="h-3 w-[1px] bg-indigo-700/20" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-50/80">
                Management
              </span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300",
              "border border-white/25 bg-white/12 text-white shadow-sm hover:bg-white/20 hover:text-white"
            )}
          >
            {collapsed ? <Menu className="h-6 w-6" /> : <X className="h-5 w-5" />}
          </button>
        </div>

        {/* Navigation */}
        <div className={cn(
          "flex-1 overflow-y-auto py-6 scrollbar-none transition-all duration-500",
          collapsed ? "px-0" : "px-4"
        )}>
          <CascadingNav groups={navGroups} collapsed={collapsed} onNavigate={handleSidebarLinkClick} />
        </div>
      </div>
    </>
  )
}
