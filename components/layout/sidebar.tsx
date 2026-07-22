'use client'

import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Activity,
  Menu,
  X,
  Shield,
  ShoppingCart,
  Banknote,
  Landmark,
  Gauge,
  HandCoins,
  ClipboardList,
  FileCheck,
  Users,
  Recycle,
} from 'lucide-react'
import { CascadingNav, type NavNode, type NavGroup } from './sidebar-cascading-nav'
import { useEffect, useMemo, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { canViewBookingPaymentHistory } from '@/lib/kia/booking-payment-history-access'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'
import { SIDEBAR_PERMISSION_BY_HREF } from '@/lib/permissions/navigation'
import { isAmFinanceViewRole, isPettyCashViewRole } from '@/lib/permissions/legacy-module-roles'

const VEHICLE_TRACKER_HREF = '/brands/kia/vehicle-tracker'
const BOOKING_PAYMENT_HISTORY_HREF = '/brands/kia/booking-payment-history'

const HYUNDAI_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_hyundai.svg'

type SidebarSubmenu = { name: string; href: string; badge?: string }
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
          { name: 'Finance', href: '/finance' },
          { name: 'Sales Report', href: '/brands/kia/sales-report' },
          { name: 'Stock Report', href: '/brands/kia/stock-report' },
          { name: 'Booking Payment History', href: '/brands/kia/booking-payment-history' },
          { name: 'Booking Follow-ups', href: '/brands/kia/follow-ups' },
          { name: 'Demo Job Cards', href: '/brands/kia/demo-job-cards' },
          { name: 'Demo Cars List', href: '/brands/kia/demo-cars-list' },
        ],
      },
      // {
      //   name: 'H Promise',
      //   key: 'h-promise',
      //   submenus: [],
      // },
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
  // {
  //   name: 'AM MG',
  //   key: 'mg',
  //   href: '/brands/mg',
  //   logo: '',
  //   logoClassName: '',
  //   logoContainerClassName: '',
  //   color: 'text-blue-100',
  //   icon: Activity,
  //   comingSoon: false,
  //   sections: [
  //     {
  //       name: 'Service',
  //       key: 'service',
  //       submenus: [
  //         { name: 'Business Excellence', href: '/brands/mg/business-excellence/overview' },
  //         { name: 'Service Appointment', href: '/brands/mg/service-appointment' },
  //         { name: 'MG Proforma', href: '/brands/mg/proforma' },
  //       ],
  //     },
  //     {
  //       name: 'Sales',
  //       key: 'sales',
  //       submenus: [
  //         { name: 'Demo Job Cards', href: '/brands/mg/demo-job-cards' },
  //         { name: 'Demo Cars List', href: '/brands/mg/demo-cars-list' },
  //       ],
  //     },
  //     {
  //       name: 'H Promise',
  //       key: 'h-promise',
  //       submenus: [],
  //     },
  //   ],
  // },
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
  const router = useRouter()
  const { collapsed, setCollapsed } = useSidebar()
  const { userRole, canAccessAdmin, userBrand, loading } = useUserRole()
  const {
    value: favouriteHrefsValue,
    savePreference: saveFavouriteHrefs,
  } = useUserPreferences<string[]>('sidebar_favourites', DEFAULT_SIDEBAR_FAVOURITES)
  // Common-module role gates. Petty Cash & AM Finance pages guard on a ROLE allowlist (not the
  // permission snapshot), so the sidebar link MUST use the identical rule or it shows a link the
  // page rejects. These predicates are the single source of truth shared with the page guards
  // (lib/permissions/legacy-module-roles.ts) so they can never drift.
  const canAccessPettyCash = isPettyCashViewRole(userRole)
  const canAccessAmFinance = isAmFinanceViewRole(userRole)
  const canAccessDelegationTasks = ['ea', 'eba', 'md', 'developer', 'admin'].includes(String(userRole || '').trim().toLowerCase())
  const favouriteHrefs = Array.isArray(favouriteHrefsValue) ? favouriteHrefsValue : []

  // The effective permission map, fetched through React Query so it is CACHED across sidebar remounts.
  // The Sidebar lives in MainLayout (a per-page component), so it unmounts + remounts on every
  // navigation; a raw fetch therefore hit /api/auth/permissions on every single navigation, which made
  // this the top Vercel invocation. React Query's cache is owned by the app-level QueryClient (it
  // survives remounts), so a navigation within `staleTime` serves the cached map with NO network call.
  // It only refetches when the map is stale on mount, or on tab focus (the global provider disables
  // both, so we opt in here). This is safe because the map is UX-only — it just decides which links
  // show; the REAL access boundary is the server-side guard re-run on every navigation against a cache
  // invalidated on grant/revoke, so up-to-`staleTime` link-visibility staleness is harmless.
  const permissionsQuery = useQuery({
    queryKey: ['auth', 'permissions'],
    enabled: !loading && Boolean(userRole),
    queryFn: async () => {
      const response = await fetch('/api/auth/permissions', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to load permissions')
      const data = (await response.json()) as { permissions?: Record<string, boolean> | null } | null
      return data?.permissions ?? null
    },
    // The server-side snapshot behind this endpoint is itself cached for ~75min and is explicitly
    // cleared on grant/revoke (updateUserPermissionOverrides → clearUserPermissionCache), so a short
    // staleTime bought nothing but invocations. refetchOnWindowFocus fired a request every time the
    // user tabbed back; refetchOnMount is kept because the Sidebar lives in the per-page MainLayout and
    // remounts on navigation, which is exactly when a revoked link should disappear.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  })
  const permissionMap = permissionsQuery.data ?? null
  // Ready once the first attempt resolves (success OR error). On error the map stays null and
  // hasPermission is fail-closed, so brand links are hidden rather than wrongly shown.
  const permissionsReady = permissionsQuery.isSuccess || permissionsQuery.isError

  // When a REFETCH returns a CHANGED map (an admin granted/revoked access), re-run the current page's
  // Server Components so the open tab updates in place — with no needless refresh on the first load.
  //
  // The comparison MUST be order-independent. This used to be JSON.stringify(data), which compares
  // key ORDER as well as content — and the map's order is not stable: the permission rows are
  // selected with no ORDER BY (lib/permissions/service.ts), and the registry sync UPSERTs those
  // rows, which shifts their heap order in Postgres. So two semantically identical maps could
  // serialise differently, fire router.refresh(), re-render, refetch, and refresh again — an
  // endless RSC loop on EVERY page, since the Sidebar is in MainLayout. Sorting the entries makes
  // the check mean what it says: "did any permission actually change?".
  const prevPermissionsRef = useRef<string | null>(null)
  useEffect(() => {
    if (!permissionsQuery.isSuccess) return
    const data = permissionsQuery.data
    const serialized = data
      ? JSON.stringify(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : 'null'
    if (prevPermissionsRef.current === null) {
      prevPermissionsRef.current = serialized
      return
    }
    if (serialized !== prevPermissionsRef.current) {
      prevPermissionsRef.current = serialized
      router.refresh()
    }
  }, [permissionsQuery.data, permissionsQuery.isSuccess, router])

  const hasPermission = (permissionKey: string) => {
    // Only Super Admins (developer, md) bypass the map. Everyone else defers to their effective
    // permission map, so an explicit Deny hides the section. FAIL-CLOSED while the map is still
    // loading (null) — return false so links never flash visible before permissions resolve; the
    // nav renders a skeleton until `permissionsReady`.
    if (isSuperAdminRole(userRole)) return true
    if (!permissionMap) return false
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
    // Booking Payment History is role-gated (hardcoded allowlist), not permission-gated — same reason
    // as Vehicle Tracker. MD/Developer/Admin + EA + Sales/General Manager only. Branch scoping (a
    // manager sees only their branch's data) is enforced server-side in the API, not here.
    if (href === BOOKING_PAYMENT_HISTORY_HREF) {
      const isKiaUser = userBrand === 'kia' || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
      return canViewBookingPaymentHistory(userRole) && isKiaUser
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
    if (hasPermission('cockpit.view')) commonNodes.push({ key: '/cockpit', label: 'Group Cockpit', href: '/cockpit', icon: Gauge, external: true, active: pathname === '/cockpit' })
    // Delegation Tasks — visible to MD / EA / developer only.
    if (canAccessDelegationTasks && hasPermission('delegation_tasks.view')) commonNodes.push({ key: '/delegation-tasks', label: 'Delegation Tasks', href: '/delegation-tasks', icon: ClipboardList, external: true, active: pathname === '/delegation-tasks' })
    // Purchase Orders — CA lives as a TAB inside this page (app/purchase-orders/page.tsx) for CA/MD/
    // Developer only; it is deliberately NOT a sidebar option.
    if (hasPermission('purchase_orders.view')) commonNodes.push({ key: '/purchase-orders', label: 'Purchase Orders', href: '/purchase-orders', icon: ShoppingCart, external: true, active: pathname === '/purchase-orders' })
    // Petty Cash is a single section — the former "Status Tracker" sub-page is now the
    // "Status" tab inside the workspace.
    // Petty Cash & AM Finance are guarded server-side by a ROLE allowlist (canAccessX), not by the
    // permission snapshot. Gate the sidebar link on the IDENTICAL role rule (AND the effective view
    // key, so an explicit per-user Deny still hides it) — otherwise the link showed for roles the
    // page rejects and they got bounced to /forbidden. See scripts/verify-guard-parity.ts.
    if (canAccessPettyCash && hasPermission('petty_cash.view')) commonNodes.push({
      key: '/petty-cash',
      label: 'Petty Cash',
      href: '/petty-cash',
      icon: Banknote,
      external: true,
      active: pathname.startsWith('/petty-cash'),
    })
    if (hasPermission('kia.approvals.view')) {
      commonNodes.push({
        key: '/brands/kia/payment-approvals',
        label: 'Vendor Payments',
        href: '/brands/kia/payment-approvals',
        icon: FileCheck,
        external: true,
        active: pathname.startsWith('/brands/kia/payment-approvals'),
      })
      commonNodes.push({
        key: '/brands/kia/vendors',
        label: 'Vendor Registry',
        href: '/brands/kia/vendors',
        icon: Users,
        external: true,
        active: pathname.startsWith('/brands/kia/vendors'),
      })
    }
    // if (canAccessAmFinance && hasPermission('am_finance.view')) commonNodes.push({ key: '/am-finance', label: 'AM Finance', href: '/am-finance', icon: Landmark, external: true, active: pathname === '/am-finance' })
    // Finance — customer vehicle-financing workflow. Deny-by-default (registry), gated purely on the
    // permission snapshot like Group Cockpit: MD/Developer always + explicitly-granted finance roles.
    // if (hasPermission('finance.view')) commonNodes.push({ key: '/finance', label: 'Finance', href: '/finance', icon: HandCoins, external: true, active: pathname.startsWith('/finance') })
    if (canAccessAdmin) {
      // Single link — the Admin page exposes all sections (Users, Access, Branch Admins, System,
      // Settings) as in-page tabs, so no sidebar dropdown is needed.
      commonNodes.push({
        key: 'admin',
        label: 'Admin Panel',
        href: '/admin',
        icon: Shield,
        active: Boolean(pathname?.startsWith('/admin')),
      })
    }
    commonNodes.push({
      key: '/scrap-erp',
      label: 'Scrap ERP',
      href: '/scrap-erp',
      icon: Recycle,
      external: true,
      active: Boolean(pathname?.startsWith('/scrap-erp')),
    })
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
              badge: sub.badge,
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
  }, [favouriteItems, favouriteHrefs, visibleBrands, pathname, permissionMap, canAccessAdmin, canAccessPettyCash, canAccessAmFinance, canAccessDelegationTasks, userBrand, userRole, isSidebarItemVisible, isEligibleFavouriteHref, toggleFavourite])

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
          {permissionsReady || isSuperAdminRole(userRole) ? (
            <CascadingNav groups={navGroups} collapsed={collapsed} onNavigate={handleSidebarLinkClick} />
          ) : (
            <SidebarNavSkeleton collapsed={collapsed} />
          )}
        </div>
      </div>
    </>
  )
}

// Placeholder shown while the effective permission map is still loading, so the nav never flashes
// links the user may not have (hasPermission is fail-closed until permissions resolve).
function SidebarNavSkeleton({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return null
  return (
    <div className="space-y-3 px-1" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-9 w-full animate-pulse rounded-xl bg-white/10" />
      ))}
    </div>
  )
}
