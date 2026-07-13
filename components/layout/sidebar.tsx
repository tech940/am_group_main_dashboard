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
} from 'lucide-react'
import { CascadingNav, type NavNode, type NavGroup } from './sidebar-cascading-nav'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'
import { SIDEBAR_PERMISSION_BY_HREF } from '@/lib/permissions/navigation'
import { isAmFinanceViewRole, isPettyCashViewRole } from '@/lib/permissions/legacy-module-roles'

const VEHICLE_TRACKER_HREF = '/brands/kia/vehicle-tracker'

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
          { name: 'Sales Report', href: '/brands/kia/sales-report' },
          { name: 'Stock Report', href: '/brands/kia/stock-report' },
          { name: 'Sales Performance', href: '/brands/kia/sales-performance', badge: 'TEST' },
          { name: 'Call Center', href: '/brands/kia/call-center', badge: 'TEST' },
          { name: 'Follow-ups', href: '/brands/kia/follow-ups', badge: 'TEST' },
          { name: 'Call & Follow-up Analytics', href: '/brands/kia/call-analytics', badge: 'TEST' },
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
  const router = useRouter()
  const { collapsed, setCollapsed } = useSidebar()
  const [permissionMap, setPermissionMap] = useState<Record<string, boolean> | null>(null)
  const [permissionsReady, setPermissionsReady] = useState(false)
  const permissionMapRef = useRef<Record<string, boolean> | null>(null)
  // Event-driven sync bookkeeping: coalesce rapid triggers (browsers fire focus + visibilitychange
  // together; a nav often follows a focus) into a single fetch, and mark the first sync so it doesn't
  // needlessly router.refresh() on initial page load.
  const syncingRef = useRef(false)
  const lastSyncAtRef = useRef(0)
  const didInitialSyncRef = useRef(false)
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
  const favouriteHrefs = Array.isArray(favouriteHrefsValue) ? favouriteHrefsValue : []

  // Fetch the effective permission map. When `refreshOnChange` and the map actually changed
  // vs the last one we held, also re-run the server components (router.refresh()) so guarded
  // pages update in place — this is what makes an admin's grant/revoke apply to this user's
  // open tab without a manual reload.
  const syncPermissions = useCallback(async (refreshOnChange: boolean) => {
    // Coalesce rapid triggers into ONE call: skip if a sync is already in flight, or if we synced
    // within the last 10s (collapses the focus+visibilitychange pair and a nav that lands right after
    // a focus). The server-side guards are the real access boundary, so ≤10s link-visibility staleness
    // is harmless.
    if (syncingRef.current) return
    if (Date.now() - lastSyncAtRef.current < 10_000) return
    syncingRef.current = true
    lastSyncAtRef.current = Date.now()
    try {
      const response = await fetch('/api/auth/permissions', { cache: 'no-store' })
      if (!response.ok) return
      const data = (await response.json()) as { permissions?: Record<string, boolean> | null } | null
      const next = data?.permissions ?? null
      const changed = JSON.stringify(next) !== JSON.stringify(permissionMapRef.current)
      if (!changed) return
      permissionMapRef.current = next
      setPermissionMap(next)
      if (refreshOnChange) router.refresh()
    } catch {
      /* keep the last-known map (do NOT fail open — hasPermission is fail-closed) */
    } finally {
      syncingRef.current = false
      // First attempt resolved (success or error): the nav may render. On error with no prior map,
      // hasPermission stays fail-closed so brand links are hidden rather than wrongly shown.
      setPermissionsReady(true)
    }
  }, [router])

  // Sync the effective permission map on INITIAL load and on every NAVIGATION (route change) — the
  // natural "reload / navigate" trigger. There is NO fixed-interval poll, so an idle tab — and any
  // BACKGROUND tab — makes zero /api/auth/permissions calls by construction. This is safe because the
  // sidebar map is UX-only: it only decides which links show. The real access boundary is server-side
  // and re-runs on every navigation (each guarded page re-executes requirePermission()/forbidden()
  // against a snapshot cache that is invalidated on every grant/revoke), so a revoked user is blocked
  // on their next page load regardless of this. The first run passes refreshOnChange=false (nothing is
  // open to update yet); navigations pass true so an admin's grant/revoke re-runs the current page's
  // Server Components in place.
  useEffect(() => {
    if (loading || !userRole) return
    const isFirst = !didInitialSyncRef.current
    didInitialSyncRef.current = true
    void syncPermissions(!isFirst)
  }, [pathname, loading, userRole, syncPermissions])

  // Catch up when the user returns to the tab (focus / becomes visible) — covers an admin grant that
  // lands while the user sits idle on one page without navigating. Event-driven, NO timer, so
  // hidden/background tabs never fetch. syncPermissions coalesces the focus+visibility pair into one.
  useEffect(() => {
    if (loading || !userRole) return
    const onFocus = () => { void syncPermissions(true) }
    const onVisible = () => { if (document.visibilityState === 'visible') void syncPermissions(true) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loading, userRole, syncPermissions])

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
    if (canAccessAmFinance && hasPermission('am_finance.view')) commonNodes.push({ key: '/am-finance', label: 'AM Finance', href: '/am-finance', icon: Landmark, external: true, active: pathname === '/am-finance' })
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
  }, [favouriteItems, favouriteHrefs, visibleBrands, pathname, permissionMap, canAccessAdmin, canAccessPettyCash, canAccessAmFinance, userBrand, userRole, isSidebarItemVisible, isEligibleFavouriteHref, toggleFavourite])

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
