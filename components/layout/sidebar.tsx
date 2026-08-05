'use client'

import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Activity,
  LayoutGrid,
  CalendarClock,
  ClipboardCheck,
  KeyRound,
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
  PhoneCall,
  ShieldCheck,
  LogOut,
} from 'lucide-react'
import { CascadingNav, type NavNode, type NavGroup } from './sidebar-cascading-nav'
import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { canViewBookingPaymentHistory } from '@/lib/kia/booking-payment-history-access'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
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
          { name: 'Demo Job Cards', href: '/brands/kia/demo-job-cards' },
          { name: 'Demo Cars List', href: '/brands/kia/demo-cars-list' },
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
          { name: 'Social Media Leads', href: '/social-media-leads' },
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
          { name: 'Discount Approvals', href: '/brands/hyundai/sales/discount-approvals' },
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
          { name: 'Discount Approvals', href: '/brands/platinum/sales/discount-approvals' },
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

function useTropicalTheme() {
  const [isTropical, setIsTropical] = useState(false)
  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return
      const accent = document.documentElement.getAttribute('data-dashboard-accent') || ''
      const stored = window.localStorage.getItem('dashboard-accent') || ''
      setIsTropical(
        accent === 'tropical-teal'
      )
    }
    update()
    window.addEventListener('dashboard-accent-change', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('dashboard-accent-change', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return isTropical
}

export function Sidebar() {
  const { collapsed, setCollapsed } = useSidebar()
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (collapsed) return
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setCollapsed(true)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [collapsed, setCollapsed])
  const isTropical = useTropicalTheme()
  const pathname = usePathname()
  const router = useRouter()
  const { userRole, fullName, email, canAccessAdmin, userBrand, loading } = useUserRole()

  const displayName = fullName || (email ? email.split('@')[0] : null) || (userRole ? userRole.toUpperCase() : 'AM Group User')
  const userInitials = fullName
    ? fullName.split(' ').filter(Boolean).map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : email
    ? email.slice(0, 2).toUpperCase()
    : userRole
    ? userRole.slice(0, 2).toUpperCase()
    : 'AM'
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
  // Call Analysis + Insurance Analysis: MD + Developer only, and deliberately NOT permission-backed.
  // A permission is grantable from the Access Map, so "only these two roles" would hold exactly until
  // someone ticked a box. Same constant backs both search surfaces — lib/auth/restricted-analytics.ts.
  const canAccessRestrictedAnalytics = canViewRestrictedAnalytics(userRole)
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
    // ⚠️ 30 MINUTES was the bug behind five separate "I granted access but they still can't see it"
    // reports. The reasoning above is right that the server clears its snapshot on grant/revoke — but
    // `refetchOnMount` only refetches data React Query considers STALE, so within staleTime a
    // navigation serves the OLD map with no network call. A freshly-granted user therefore had to
    // hard-reload or wait half an hour, with nothing on screen explaining why.
    //
    // Two minutes keeps the invocation saving that matters (a burst of navigations still shares one
    // fetch) while making a grant take effect on the next page change instead of the next half hour.
    staleTime: 2 * 60 * 1000,
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

  /**
   * Which links may be starred. Was `/brands/` only, so the Common modules — Cockpit, Purchase
   * Orders, Petty Cash, Scrap, Insurance and the rest — could not be favourited at all, which is
   * exactly the set a non-brand user lives in all day.
   *
   * Anything with a real in-app path is eligible now. Auth routes are excluded so a star can never
   * point somewhere the sidebar would not render.
   */
  const isEligibleFavouriteHref = useCallback((href: string) => {
    return href.startsWith('/') && !href.startsWith('/auth') && href !== '/'
  }, [])

  const isSidebarItemVisible = useCallback((href: string) => {
    // Vehicle Tracker is role-gated (Service floor): Branch Admin + Service GM + MD/Developer.
    // Sales GM is excluded. This one stays role-based (it has no permission-registry entry).
    if (href === VEHICLE_TRACKER_HREF) {
      const isKiaUser = userBrand === 'kia' || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
      return canViewVehicleTracker(userRole) && isKiaUser
    }
    // Booking Payment History
    if (href === BOOKING_PAYMENT_HISTORY_HREF) {
      const isKiaUser = userBrand === 'kia' || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
      return canViewBookingPaymentHistory(userRole, permissionMap) && isKiaUser
    }
    // Scrap
    if (href === '/scrap' || href === '/scrap-erp') {
      return canAccessScrapErp(userRole, permissionMap)
    }
    // Testing - Social Media Leads: Gated ONLY to MD and Developer
    if (href === '/social-media-leads') {
      return ['md', 'developer', 'admin'].includes(String(userRole || '').trim().toLowerCase())
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
        label: 'Kia Approvals',
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
    // Call Analysis — MD + Developer only, role-gated (see lib/callyzer/access.ts).
    // Sits beside Insurance and shares its gate — the queue carries customer names and registration
    // numbers for ~3,700 vehicles, so it cannot be wider than the section it is derived from.
    if (canAccessRestrictedAnalytics) commonNodes.push({
      key: '/insurance/renewals',
      label: 'Renewal Pipeline',
      href: '/insurance/renewals',
      icon: CalendarClock,
      external: true,
      active: Boolean(pathname?.startsWith('/insurance/renewals')),
    })
    if (canAccessRestrictedAnalytics) commonNodes.push({
      key: '/call-analysis',
      label: 'Call Analysis',
      href: '/call-analysis',
      icon: PhoneCall,
      external: true,
      active: Boolean(pathname?.startsWith('/call-analysis')),
    })
    // MD Approvals aggregates the purchase-order, petty-cash and vendor-payment queues into one
    // screen. Role-gated on isSuperAdminRole DELIBERATELY rather than on a permission key, so it can
    // never be widened from the Access Map — it is money movement across three modules, and the page
    // plus both API routes enforce the identical check.
    if (isSuperAdminRole(userRole)) commonNodes.push({
      key: '/md-approvals',
      label: 'MD Approvals',
      href: '/md-approvals',
      icon: ClipboardCheck,
      external: true,
      active: Boolean(pathname?.startsWith('/md-approvals')),
    })
    // Data Health is an OPERATIONS tool, not a business section: it exposes table names, row counts
    // and load timestamps across every brand. Gated on the super-admin role directly rather than a
    // permission key, so it can never be granted sideways from the Access Map. The page and the API
    // enforce the identical check — see scripts/verify-guard-parity.ts for why that matters here.
    if (isSuperAdminRole(userRole)) commonNodes.push({
      key: '/data-health',
      label: 'Data Health',
      href: '/data-health',
      icon: Activity,
      external: true,
      active: Boolean(pathname?.startsWith('/data-health')),
    })
    if (canAccessAdmin) {
      // Single link — the Admin page exposes all sections (Users, Access, Branch Admins, System,
      // Settings) as in-page tabs, so no sidebar dropdown is needed.
      commonNodes.push({
        key: 'admin',
        label: 'Admin Panel',
        href: '/admin',
        icon: Shield,
        // Exact match, otherwise this stays highlighted while Effective Access below is the active page.
        active: pathname === '/admin' || Boolean(pathname?.startsWith('/admin/users')),
      })
      // Sibling link rather than an Admin tab: this answers "why can't X see Y" and is reached
      // mid-investigation, not while working through the Users/Access flow.
      commonNodes.push({
        key: '/admin/effective-access',
        label: 'Effective Access',
        href: '/admin/effective-access',
        icon: KeyRound,
        active: Boolean(pathname?.startsWith('/admin/effective-access')),
      })
    }
    if (canAccessScrapErp(userRole, permissionMap)) {
      commonNodes.push({
        key: '/scrap',
        label: 'Scrap',
        href: '/scrap',
        icon: Recycle,
        external: true,
        active: Boolean(pathname?.startsWith('/scrap')),
      })
    }
    if (canAccessRestrictedAnalytics) {
      commonNodes.push({
        key: '/insurance',
        label: 'Insurance Analysis',
        href: '/insurance',
        icon: ShieldCheck,
        external: true,
        active: Boolean(pathname?.startsWith('/insurance')),
      })
    }
    // ── Favourites ── emitted here, not earlier, because it draws on BOTH the brand sub-pages and
    // the Common modules, and commonNodes only exists by this point.
    const commonByHref = new Map(
      commonNodes.filter((node) => node.href).map((node) => [node.href as string, node]),
    )
    const favouriteNodes: NavNode[] = favouriteHrefs.flatMap((href) => {
      const brandItem = favouriteItems.find((item) => item.href === href)
      if (brandItem) {
        return [{
          key: `fav-${href}`,
          label: brandItem.label,
          href,
          badge: brandItem.brandName,
          external: true,
          active: isSidebarHrefActive(href, pathname),
          favourite: { active: true, onToggle: () => void toggleFavourite(href) },
        }]
      }
      const commonNode = commonByHref.get(href)
      if (commonNode) {
        return [{
          ...commonNode,
          key: `fav-${href}`,
          badge: 'Common',
          favourite: { active: true, onToggle: () => void toggleFavourite(href) },
        }]
      }
      // Starred then lost access, or the link was removed — drop it rather than render a dead row.
      return []
    })
    if (favouriteNodes.length > 0) {
      groups.push({ key: 'favourites', label: 'Favourites', nodes: favouriteNodes })
    }

    if (commonNodes.length > 0) {
      // A star on every Common item. Favourites are stored by HREF, so a starred link survives a
      // label change and resolves through the same lookup the brand links use.
      const starredCommon = commonNodes.map((node) => (
        node.href && isEligibleFavouriteHref(node.href)
          ? {
              ...node,
              favourite: {
                active: favouriteHrefs.includes(node.href),
                onToggle: () => void toggleFavourite(node.href as string),
              },
            }
          : node
      ))

      // One collapsible parent rather than a flat list: Common had grown past a dozen always-visible
      // rows and pushed Branches below the fold. `children` is the accordion's existing nesting
      // mechanism, so the nav component needs no change.
      groups.push({
        key: 'common',
        nodes: [{
          key: 'common-group',
          label: 'Common',
          icon: LayoutGrid,
          children: starredCommon,
        }],
      })
    }

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
    {/* ──────────────────────────────────────────────────────────────────────
        Semi-transparent backdrop (closes sidebar on mobile tap)
    ────────────────────────────────────────────────────────────────────── */}
    {!collapsed && (
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] cursor-pointer"
        onClick={() => setCollapsed(true)}
        aria-hidden
      />
    )}

    {/* ──────────────────────────────────────────────────────────────────────
        SIDEBAR PANEL
    ────────────────────────────────────────────────────────────────────── */}
    <div
      ref={sidebarRef}
      className={cn(
        'app-sidebar-brand fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-slate-200/80 shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed ? 'w-0 border-none' : 'w-[368px] max-w-[92vw]'
      )}
      style={{
        background: 'linear-gradient(180deg, #F7F4FF 0%, #EEF4FF 45%, #DDF7F8 100%)',
      }}
    >
      {/* Decorative Radial Glow Accent (Bottom Right) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '320px',
          height: '320px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at bottom right, rgba(59,130,246,0.12) 0%, rgba(99,102,241,0.08) 35%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Header with Hamburger */}
      <div className={cn(
        "relative z-10 flex shrink-0 items-center border-b border-slate-200/60 bg-white/60 backdrop-blur-md transition-all duration-500",
        collapsed ? "h-20 justify-center px-0" : "h-20 justify-between px-4"
      )}>
        {/* Subtle Decorative Dot Pattern Header Accent */}
        <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:12px_12px]" />

        {!collapsed && (
          <div className="relative flex items-center gap-3 h-14 flex-1 ml-0.5">
            {/* Increased Logo Container Size */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-xs flex items-center justify-center h-14 w-14 shrink-0">
              <img
                src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg"
                alt="AM Group"
                className="h-10 w-10 object-contain"
              />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-black tracking-tight text-slate-900">
                AM GROUP
              </span>
              <span className="text-[9.5px] font-black uppercase tracking-[0.2em] text-indigo-600">
                Management
              </span>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "relative h-9 w-9 rounded-2xl flex items-center justify-center transition-all duration-300 cursor-pointer shadow-xs",
            "border border-slate-200/80 bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900"
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label="Toggle sidebar"
        >
          {collapsed ? <Menu className="h-5 w-5" /> : <X className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <div className={cn(
        "relative z-10 flex-1 overflow-y-auto py-4 scrollbar-none transition-all duration-500",
        collapsed ? "px-0" : "px-3.5"
      )}>
        {permissionsReady || isSuperAdminRole(userRole) ? (
          <CascadingNav groups={navGroups} collapsed={collapsed} onNavigate={handleSidebarLinkClick} />
        ) : (
          <SidebarNavSkeleton collapsed={collapsed} />
        )}
      </div>

      {/* User Profile Footer Card */}
      {!collapsed && (
        <div className="relative z-10 p-3.5 border-t border-slate-200/60 bg-white/40 backdrop-blur-xs shrink-0">
          <div
            className="sidebar-footer-card flex items-center justify-between gap-3 rounded-2xl p-3 text-white shadow-md border border-white/20"
            style={{
              background: 'linear-gradient(135deg, var(--dashboard-action-bg) 0%, var(--dashboard-action-hover) 100%)',
              color: 'var(--dashboard-action-fg, #ffffff)',
            }}
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              {/* Profile Avatar Gradient */}
              <div
                className="sidebar-footer-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-black text-xs shadow-xs border border-white/20"
                style={{
                  background: isTropical
                    ? 'linear-gradient(135deg, #055B65, #033A41)'
                    : 'linear-gradient(135deg, #6366F1, #3B82F6)',
                  color: '#FFFFFF',
                }}
              >
                {userInitials}
              </div>
              <div className="truncate">
                <p className="text-xs font-black tracking-tight truncate leading-tight" style={{ color: isTropical ? '#033A41' : '#FFFFFF' }}>
                  {displayName}
                </p>
                <p className="text-[10px] font-bold capitalize truncate" style={{ color: isTropical ? '#055B65' : 'rgba(224, 231, 255, 0.8)' }}>
                  {userRole || 'User'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                window.location.href = '/login'
              }}
              className="sidebar-footer-logout flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors cursor-pointer"
              style={{
                background: isTropical ? 'rgba(5, 91, 101, 0.15)' : 'rgba(255, 255, 255, 0.15)',
                color: isTropical ? '#033A41' : '#FFFFFF',
              }}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
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
        <div key={i} className="h-8 w-full animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  )
}