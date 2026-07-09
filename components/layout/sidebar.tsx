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
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'
import { SIDEBAR_PERMISSION_BY_HREF } from '@/lib/permissions/navigation'

const VEHICLE_TRACKER_HREF = '/brands/kia/vehicle-tracker'

const HYUNDAI_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_hyundai.svg'

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
    logo: 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_kia.svg',
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
          { name: 'Vehicle Tracker', href: '/brands/kia/vehicle-tracker' },
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

const alwaysVisibleBrandKeys = new Set<string>()
const DEFAULT_SIDEBAR_FAVOURITES: string[] = []

// Generated from the registry's SECTION_ROUTES (proven identical by scripts/verify-nav-map.ts).
const sidebarPermissionByHref = SIDEBAR_PERMISSION_BY_HREF

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

export function Sidebar() {
  const pathname = usePathname()
  const { collapsed, setCollapsed } = useSidebar()
  const [permissionMap, setPermissionMap] = useState<Record<string, boolean> | null>(null)
  const { userRole, canAccessAdmin, isSuperAdmin, userBrand, loading } = useUserRole()
  const {
    value: favouriteHrefsValue,
    savePreference: saveFavouriteHrefs,
  } = useUserPreferences<string[]>('sidebar_favourites', DEFAULT_SIDEBAR_FAVOURITES)
  // Common-module role gates (unchanged). Brand-section visibility is now driven entirely by
  // the effective permission map — the former branch_admin (Petty-Cash-only), sales_executive
  // (Bookings-only) and sales/stock-report hardcodes moved into the resolution layer
  // (lib/permissions/service.ts), so a per-section Deny and restricted-role defaults apply here.
  const canAccessFinanceOrders = ['admin', 'developer', 'ceo', 'md', 'ea', 'eba', 'accounts', 'finance_head'].includes(userRole || '')
  const canAccessPettyCash = ['admin', 'developer', 'branch_admin', 'ea', 'md', 'eba', 'accounts'].includes(userRole || '')
  const canAccessAmFinance = ['admin', 'developer', 'ceo', 'md', 'ea', 'eba'].includes(userRole || '')
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

  const isSidebarItemVisible = useCallback((href: string) => {
    // Vehicle Tracker is role-gated (Service floor): Branch Admin + Service GM + MD/Developer.
    // Sales GM is excluded. This one stays role-based (it has no permission-registry entry).
    if (href === VEHICLE_TRACKER_HREF) {
      const isKiaUser = userBrand === 'kia' || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
      return canViewVehicleTracker(userRole) && isKiaUser
    }
    // Everything else is gated by the user's effective permissions. Brand users are no longer
    // auto-granted their whole brand here, so a per-section Deny — and restricted-role defaults
    // (branch_admin, sales_executive, sensitive reports) — hide the link. hasPermission handles
    // global roles and the pre-load (map === null) fail-open.
    const permissionKey = sidebarPermissionByHref[href]
    if (permissionKey && !hasPermission(permissionKey)) {
      return false
    }

    return true
  }, [userBrand, userRole, permissionMap])

  const toggleFavourite = useCallback(async (href: string) => {
    if (!isEligibleFavouriteHref(href)) return
    const next = favouriteHrefs.includes(href)
      ? favouriteHrefs.filter((item) => item !== href)
      : [...favouriteHrefs.filter((item) => item !== href), href]
    await saveFavouriteHrefs(next)
  }, [favouriteHrefs, isEligibleFavouriteHref, saveFavouriteHrefs])

  const visibleBrands = useMemo(() => {
    // Which brands to surface. Individual sections inside each brand are gated by
    // isSidebarItemVisible, so a brand with no visible sections is dropped later.
    // The user's brand may be a comma-separated multi-brand assignment ('hyundai,tata'),
    // so match against the SPLIT set — an exact `=== userBrand` compare would surface no brand
    // at all for those users (the "only MG showed" bug).
    const userBrandKeys = (userBrand || '').split(',').map((value) => value.trim()).filter(Boolean)
    return availableBrands
      .filter((brand) => {
        if (alwaysVisibleBrandKeys.has(brand.key)) return true
        if (hasGlobalAccessRole(userRole)) return true
        if (hasAllBranchAccess(userBrand)) return true
        return userBrandKeys.includes(brand.key)
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
  }, [userBrand, userRole])

  const favouriteItems = useMemo(() => {
    const itemMap = new Map<string, { href: string; label: string; brandName: string }>()
    for (const brand of visibleBrands) {
      for (const section of brand.sections) {
        if ('href' in section && section.href && isSidebarItemVisible(section.href) && isEligibleFavouriteHref(section.href)) {
          itemMap.set(section.href, { href: section.href, label: section.name, brandName: brand.name })
        }

        for (const submenu of section.submenus) {
          if (!isSidebarItemVisible(submenu.href) || !isEligibleFavouriteHref(submenu.href)) continue
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
          badge: item.brandName,
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
    if ((canAccessPettyCash || permissionMap) && hasPermission('petty_cash.view')) commonNodes.push({
      key: 'petty-cash',
      label: 'Petty Cash',
      icon: Banknote,
      children: [
        { key: '/petty-cash', label: 'Overview', href: '/petty-cash', external: true, active: pathname === '/petty-cash' },
        { key: '/petty-cash/status', label: 'Status Tracker', href: '/petty-cash/status', external: true, active: pathname === '/petty-cash/status' },
      ],
    })
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
      const sections: NavNode[] = []
      for (const section of brand.sections) {
        const directHref = 'href' in section ? section.href : undefined
        const hasChildren = section.submenus.length > 0
        if (directHref && !isSidebarItemVisible(directHref)) continue
        const visibleSubmenus = section.submenus.filter((sub) => isSidebarItemVisible(sub.href))
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
  }, [favouriteItems, favouriteHrefs, visibleBrands, pathname, permissionMap, canAccessAdmin, isSuperAdmin, canAccessFinanceOrders, canAccessPettyCash, canAccessAmFinance, userBrand, userRole, isSidebarItemVisible, isEligibleFavouriteHref, toggleFavourite])

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
              <div className="rounded-lg border border-slate-200/50 bg-white px-2.5 py-1.5 shadow-sm">
                <img
                  src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg"
                  alt="AM Group"
                  className="h-8 object-contain"
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
