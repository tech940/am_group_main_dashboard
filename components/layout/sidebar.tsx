'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Activity,
  Menu,
  X,
  Settings,
  Users,
  Shield,
  KeyRound,
  Lock,
  ShoppingCart,
  Banknote,
  Landmark,
  Loader2,
  Star,
} from 'lucide-react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'

const HYUNDAI_LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/44/Hyundai_Motor_Company_logo.svg'

const brandNavigation = [
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
          { name: 'Kia Proforma', href: '/brands/kia/proforma' },
        ],
      },
      {
        name: 'Sales',
        key: 'sales',
        submenus: [
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
      {
        name: 'Insurance',
        key: 'insurance',
        href: '/brands/kia/insurance',
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

function getBrandKey(brandName: string) {
  return availableBrands.find((brand) => brand.name === brandName)?.key || ''
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { collapsed, setCollapsed } = useSidebar()
  const [openBrands, setOpenBrands] = useState<Set<string>>(() => new Set())
  const [openBrandSections, setOpenBrandSections] = useState<Set<string>>(() => new Set())
  const [openAdmin, setOpenAdmin] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [permissionMap, setPermissionMap] = useState<Record<string, boolean> | null>(null)
  const { userRole, canAccessAdmin, isSuperAdmin, userBrand, loading } = useUserRole()
  const {
    value: favouriteHrefsValue,
    savePreference: saveFavouriteHrefs,
    loading: favouritesLoading,
  } = useUserPreferences<string[]>('sidebar_favourites', DEFAULT_SIDEBAR_FAVOURITES)
  const canAccessFinanceOrders = ['admin', 'super_admin', 'ceo', 'md', 'ea', 'eba', 'accounts', 'finance_head'].includes(userRole || '')
  const canAccessPettyCash = ['admin', 'super_admin', 'branch_admin', 'ea', 'md', 'eba', 'accounts'].includes(userRole || '')
  const canAccessAmFinance = ['admin', 'super_admin', 'ceo', 'md', 'ea', 'eba'].includes(userRole || '')
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

  const showLockedSectionMessage = () => {
    alert('You do not have access to this section. Please contact your administrator.')
  }

  const isEligibleFavouriteHref = useCallback((href: string) => {
    return href.startsWith('/brands/')
  }, [])

  const isSidebarItemVisible = useCallback((href: string, brandKey: string) => {
    if ((href === '/brands/kia/sales-report' || href === '/brands/kia/stock-report') && !isKiaSalesReportRoleAllowed(userRole)) {
      return false
    }

    const permissionKey = sidebarPermissionByHref[href]
    const isBrandUser = userBrand === brandKey || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
    if (permissionKey && !isBrandUser && !hasPermission(permissionKey)) {
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

  const canAccessBrand = (brandKey: string) => {
    if (brandKey === 'mg') return false
    if (alwaysVisibleBrandKeys.has(brandKey)) return true
    if (hasGlobalAccessRole(userRole)) return true
    if (!userBrand) return false
    if (hasAllBranchAccess(userBrand)) return true
    return brandKey === userBrand
  }

  const visibleBrands = useMemo(() => {
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
  }, [userBrand, userRole])

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

  const toggleBrand = (brandName: string) => {
    const brand = availableBrands.find((item) => item.name === brandName)
    const brandKey = brand?.key || getBrandKey(brandName)
    // Only allow toggling if user can access this brand
    if (!brand?.comingSoon && canAccessBrand(brandKey)) {
      setOpenBrands((current) => {
        const next = new Set(current)
        if (next.has(brandName)) {
          next.delete(brandName)
        } else {
          next.add(brandName)
        }
        return next
      })
      if (!openBrands.has(brandName)) {
        if (collapsed) setCollapsed(false)
      }
    }
  }

  const toggleBrandSection = (sectionKey: string) => {
    setOpenBrandSections((current) => {
      const next = new Set(current)
      if (next.has(sectionKey)) {
        next.delete(sectionKey)
      } else {
        next.add(sectionKey)
      }
      return next
    })
  }

  const toggleAdmin = () => {
    // Only allow toggling if user is admin
    if (canAccessAdmin) {
      setOpenAdmin(!openAdmin)
      if (collapsed) setCollapsed(false)
    }
  }

  const handleSidebarLinkClick = () => {
    setCollapsed(true)
  }

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
          collapsed ? 'w-0 border-none' : 'w-72'
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
          <div className="space-y-10">
            {!collapsed && (
              <div>
                <p className="mb-4 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-indigo-50/65">
                  Favourites
                </p>
                {favouritesLoading ? (
                  <div className="space-y-2 px-2">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-10 animate-pulse rounded-xl bg-white/10" />
                    ))}
                  </div>
                ) : favouriteItems.length > 0 ? (
                  <div className="space-y-2">
                    {favouriteItems.map((item) => {
                      const active = isSidebarHrefActive(item.href, pathname)
                      return (
                        <div key={item.href} className="flex items-center gap-2">
                          <Link
                            href={item.href}
                            target="_blank"
                            rel="noreferrer"
                            prefetch={false}
                            onClick={handleSidebarLinkClick}
                            className={cn(
                              'flex min-h-[2.6rem] flex-1 items-center rounded-xl border-l-4 px-3 py-2 text-left shadow-sm transition-all',
                              active
                                ? 'border-white bg-white/22 text-white'
                                : 'border-transparent bg-white/10 text-indigo-50/85 hover:border-white/70 hover:bg-white/18 hover:text-white'
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-semibold">{item.label}</p>
                              <p className="truncate text-[9px] font-black uppercase tracking-[0.18em] text-indigo-50/60">{item.brandName}</p>
                            </div>
                          </Link>
                          <button
                            type="button"
                            onClick={() => void toggleFavourite(item.href)}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-amber-300 transition hover:bg-white/18 hover:text-amber-200"
                            aria-label={`Remove ${item.label} from favourites`}
                            title="Remove from favourites"
                          >
                            <Star className="h-4 w-4 fill-current" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/15 bg-white/6 px-4 py-3 text-[11px] font-semibold text-indigo-50/60">
                    Star any subsection to pin it here.
                  </div>
                )}
              </div>
            )}
            <div className="mt-[-20px]">
              <nav className="space-y-2">
                {hasPermission('purchase_orders.view') && (
                  <Link
                    href="/purchase-orders"
                    target="_blank"
                    rel="noreferrer"
                    prefetch={false}
                    onClick={handleSidebarLinkClick}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                      pathname === '/purchase-orders'
                        ? 'bg-white/22 border-l-4 border-white text-white font-semibold shadow-sm shadow-indigo-950/10 pl-3'
                        : 'bg-white/10 border-l-4 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-white/70 pl-3',
                      collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'w-full py-2.5 pr-3'
                    )}
                  >
                    <div className={cn(
                      "flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center rounded-lg transition-all",
                      pathname === '/purchase-orders' ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                    )}>
                      <ShoppingCart className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        pathname === '/purchase-orders' ? "text-white" : "text-indigo-50/85 group-hover:text-white"
                      )} />
                    </div>
                    {!collapsed && (
                      <span className="flex-1 text-left text-[13px]">Purchase Orders</span>
                    )}
                  </Link>
                )}

                {(canAccessFinanceOrders || permissionMap) && hasPermission('finance_orders.view') && (
                  <Link
                    href="/finance-orders"
                    target="_blank"
                    rel="noreferrer"
                    prefetch={false}
                    onClick={handleSidebarLinkClick}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                      pathname === '/finance-orders'
                        ? 'bg-white/22 border-l-4 border-white text-white font-semibold shadow-sm shadow-indigo-950/10 pl-3'
                        : 'bg-white/10 border-l-4 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-white/70 pl-3',
                      collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'w-full py-2.5 pr-3'
                    )}
                  >
                    <div className={cn(
                      "flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center rounded-lg transition-all",
                      pathname === '/finance-orders' ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                    )}>
                      <Landmark className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        pathname === '/finance-orders' ? "text-white" : "text-indigo-50/85 group-hover:text-white"
                      )} />
                    </div>
                    {!collapsed && (
                      <span className="flex-1 text-left text-[13px]">Finance Orders</span>
                    )}
                  </Link>
                )}

                {(canAccessPettyCash || permissionMap) && hasPermission('petty_cash.view') && (
                  <Link
                    href="/petty-cash"
                    target="_blank"
                    rel="noreferrer"
                    prefetch={false}
                    onClick={handleSidebarLinkClick}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                      pathname === '/petty-cash'
                        ? 'bg-white/22 border-l-4 border-white text-white font-semibold shadow-sm shadow-indigo-950/10 pl-3'
                        : 'bg-white/10 border-l-4 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-white/70 pl-3',
                      collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'w-full py-2.5 pr-3'
                    )}
                  >
                    <div className={cn(
                      "flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center rounded-lg transition-all",
                      pathname === '/petty-cash' ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                    )}>
                      <Banknote className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        pathname === '/petty-cash' ? "text-white" : "text-indigo-50/85 group-hover:text-white"
                      )} />
                    </div>
                    {!collapsed && (
                      <span className="flex-1 text-left text-[13px]">Petty Cash</span>
                    )}
                  </Link>
                )}

                {canAccessAmFinance && (
                  <Link
                    href="/am-finance"
                    target="_blank"
                    rel="noreferrer"
                    prefetch={false}
                    onClick={handleSidebarLinkClick}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                      pathname === '/am-finance'
                        ? 'bg-white/22 border-l-4 border-white text-white font-semibold shadow-sm shadow-indigo-950/10 pl-3'
                        : 'bg-white/10 border-l-4 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-white/70 pl-3',
                      collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'w-full py-2.5 pr-3'
                    )}
                  >
                    <div className={cn(
                      "flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center rounded-lg transition-all",
                      pathname === '/am-finance' ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                    )}>
                      <Landmark className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        pathname === '/am-finance' ? "text-white" : "text-indigo-50/85 group-hover:text-white"
                      )} />
                    </div>
                    {!collapsed && (
                      <span className="flex-1 text-left text-[13px]">AM Finance</span>
                    )}
                  </Link>
                )}

                {canAccessAdmin && (
                  <div className="space-y-2">
                    <button
                      onClick={toggleAdmin}
                      className={cn(
                        'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none w-full relative',
                        (openAdmin || pathname?.startsWith('/admin'))
                          ? 'bg-white/22 border-l-4 border-emerald-100 text-white font-semibold shadow-sm shadow-emerald-950/10 pl-3'
                          : 'bg-white/10 border-l-4 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-indigo-100/80 cursor-pointer group pl-3',
                        collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'py-2.5 pr-3'
                      )}
                    >
                      <div className={cn(
                        "flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center rounded-lg transition-all",
                        (openAdmin || pathname?.startsWith('/admin')) ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                      )}>
                        <Shield className={cn(
                          "h-4.5 w-4.5 transition-colors",
                          (openAdmin || pathname?.startsWith('/admin')) ? "text-white" : "text-indigo-50/85 group-hover:text-white"
                        )} />
                      </div>
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left text-[13px]">Admin Panel</span>
                          <ChevronDown className={cn(
                            "h-4 w-4 transition-transform duration-300",
                            openAdmin ? "rotate-180 text-white" : "text-indigo-50/70"
                          )} />
                        </>
                      )}
                    </button>

                    {!collapsed && openAdmin && (
                      <div className="ml-4 space-y-1.5 border-l-2 border-white/20 pl-4 animate-in slide-in-from-top-2 duration-200">
                        <Link
                          href="/admin?tab=users"
                          prefetch={false}
                          onClick={handleSidebarLinkClick}
                          className={cn(
                            'flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[11px] font-medium shadow-sm transition-all',
                            pathname?.startsWith('/admin')
                              ? 'border-l-2 border-emerald-100 text-white font-semibold'
                              : 'border-l-2 border-transparent text-indigo-50/85 hover:border-indigo-100/80 hover:bg-white/18 hover:text-white'
                          )}
                        >
                          <Users className="h-3.5 w-3.5" />
                          User Management
                        </Link>
                        <Link
                          href="/admin?tab=access"
                          prefetch={false}
                          onClick={handleSidebarLinkClick}
                          className="flex items-center gap-2 rounded-lg border-l-2 border-transparent bg-white/10 px-3 py-2 text-[11px] font-medium text-indigo-50/85 shadow-sm transition-all hover:border-indigo-100/80 hover:bg-white/18 hover:text-white"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Access Control
                        </Link>
                        {isSuperAdmin && (
                          <Link
                            href="/admin?tab=branch-admins"
                            prefetch={false}
                            onClick={handleSidebarLinkClick}
                            className={cn(
                              'flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[11px] font-medium shadow-sm transition-all',
                              pathname?.startsWith('/admin')
                                ? 'border-l-2 border-emerald-100 text-white font-semibold'
                                : 'border-l-2 border-transparent text-indigo-50/85 hover:border-indigo-100/80 hover:bg-white/18 hover:text-white'
                            )}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Branch Admins
                          </Link>
                        )}
                        {isSuperAdmin && (
                          <Link
                            href="/admin?tab=settings"
                            prefetch={false}
                            onClick={handleSidebarLinkClick}
                            className="flex items-center gap-2 rounded-lg border-l-2 border-transparent bg-white/10 px-3 py-2 text-[11px] font-medium text-indigo-50/85 shadow-sm transition-all hover:border-indigo-100/80 hover:bg-white/18 hover:text-white"
                          >
                            <Settings className="h-3.5 w-3.5" />
                            Dashboard Settings
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </nav>
            </div>



            {visibleBrands.length > 0 && (
              <div>
                {!collapsed && (
                  <p className="mb-6 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-indigo-50/65">
                    Managed Brands
                  </p>
                )}
              <nav className="space-y-4">
                {visibleBrands.map((brand) => {
                  const isOpen = openBrands.has(brand.name)
                  const isActive = pathname?.startsWith(brand.href)
                  const hasAccess = canAccessBrand(brand.key)
                  const canOpenBrand = hasAccess && !brand.comingSoon

                  return (
                    <div key={brand.name} className="space-y-1.5">
                      <button
                        onClick={() => toggleBrand(brand.name)}
                        disabled={!canOpenBrand}
                        className={cn(
                          'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none relative w-full',
                          (isOpen || isActive)
                            ? 'bg-white/22 border-l-4 border-indigo-100 text-white font-semibold shadow-sm shadow-indigo-950/10 pl-3'
                          : canOpenBrand
                              ? 'bg-white/10 border-l-4 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-indigo-100/80 cursor-pointer group pl-3'
                              : 'bg-white/10 border-l-4 border-transparent text-indigo-50/45 opacity-60 cursor-not-allowed pl-3',
                          collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'py-2.5 pr-3'
                        )}
                      >
                        <div className={cn(
                          "flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-all",
                          (isOpen || isActive) ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20",
                          brand.logoContainerClassName
                        )}>
                          {brand.logo ? (
                            <img
                              src={brand.logo}
                              alt={brand.name}
                              className={cn("h-full w-full object-contain", brand.logoClassName)}
                            />
                          ) : (
                            <brand.icon className="h-5 w-5 text-white" />
                          )}
                        </div>
                        {!collapsed && (
                          <>
                            <span className={cn(
                              "flex-1 text-left text-[13px] transition-colors",
                              (isOpen || isActive) ? "text-white" : "text-indigo-50/85 group-hover:text-white"
                            )}>{brand.name}</span>
                            {brand.comingSoon ? (
                              <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-indigo-50/75">
                                Coming soon
                              </span>
                            ) : !hasAccess ? (
                              <Lock className="h-4 w-4 text-slate-500" />
                            ) : (
                              <ChevronDown className={cn(
                                "h-4 w-4 transition-transform duration-300",
                                isOpen ? "rotate-180 text-white" : "text-indigo-50/70"
                              )} />
                            )}
                          </>
                        )}
                      </button>

                      {!collapsed && isOpen && (
                        <div className="ml-4 space-y-2 border-l-2 border-white/20 pl-4 animate-in slide-in-from-top-2 duration-200">
                          {brand.sections.map((section) => {
                            const sectionKey = `${brand.key}:${section.key}`
                            const sectionOpen = openBrandSections.has(sectionKey)
                            const directHref = 'href' in section ? section.href : undefined
                            const hasChildren = section.submenus.length > 0
                            const directPermissionKey = directHref ? sidebarPermissionByHref[directHref] : undefined
                            const isBrandUser = userBrand === brand.key || hasAllBranchAccess(userBrand) || hasGlobalAccessRole(userRole)
                            const directLocked = directHref && !isBrandUser && directPermissionKey
                              ? !hasPermission(directPermissionKey)
                              : false

                            if (directHref && directLocked) return null

                            const visibleSubmenus = section.submenus.filter((sub) => {
                              if (!isSidebarItemVisible(sub.href, brand.key)) return false
                              const permissionKey = sidebarPermissionByHref[sub.href]
                              const subLocked = isBrandUser ? false : (permissionKey ? !hasPermission(permissionKey) : false)
                              return !subLocked
                            })

                            if (hasChildren && visibleSubmenus.length === 0) return null

                            const sectionActive = directHref
                              ? isSidebarHrefActive(directHref, pathname)
                              : visibleSubmenus.some((sub) => isSidebarHrefActive(sub.href, pathname))

                            return (
                              <div key={section.key} className="relative space-y-1.5">
                                {directHref ? (
                                  <Link
                                    href={directHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    prefetch={false}
                                    onClick={handleSidebarLinkClick}
                                    className={cn(
                                      'flex flex-1 items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-[0.16em] shadow-sm transition-all',
                                      sectionActive
                                        ? 'bg-white/18 text-white'
                                        : 'bg-white/8 text-indigo-50/75 hover:bg-white/14 hover:text-white'
                                    )}
                                  >
                                    <Shield className="h-3.5 w-3.5" />
                                    <span className="flex-1">{section.name}</span>
                                  </Link>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => hasChildren ? toggleBrandSection(sectionKey) : undefined}
                                    className={cn(
                                      'flex w-full items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-[0.16em] shadow-sm transition-all',
                                      sectionActive || sectionOpen
                                        ? 'bg-white/18 text-white'
                                        : 'bg-white/8 text-indigo-50/75 hover:bg-white/14 hover:text-white',
                                      !hasChildren && 'cursor-default opacity-70'
                                    )}
                                  >
                                    {hasChildren ? (
                                      sectionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                                    ) : (
                                      <span className="h-3.5 w-3.5" />
                                    )}
                                    <span className="flex-1">{section.name}</span>
                                    {!hasChildren && <span className="text-[8px] tracking-widest text-indigo-50/45">Soon</span>}
                                  </button>
                                )}

                                {directHref && isSidebarItemVisible(directHref, brand.key) && isEligibleFavouriteHref(directHref) ? (
                                  <button
                                    type="button"
                                    onClick={() => void toggleFavourite(directHref)}
                                    className={cn(
                                      'absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg border transition',
                                      favouriteHrefs.includes(directHref)
                                        ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
                                        : 'border-white/10 bg-white/8 text-indigo-50/55 hover:bg-white/14 hover:text-amber-200'
                                    )}
                                    aria-label={favouriteHrefs.includes(directHref) ? `Remove ${section.name} from favourites` : `Add ${section.name} to favourites`}
                                    title={favouriteHrefs.includes(directHref) ? 'Remove from favourites' : 'Add to favourites'}
                                  >
                                    <Star className={cn('h-3.5 w-3.5', favouriteHrefs.includes(directHref) && 'fill-current')} />
                                  </button>
                                ) : null}

                                {hasChildren && sectionOpen && (
                                  <div className="ml-4 space-y-1.5 border-l border-white/15 pl-3">
                                    {visibleSubmenus.map((sub) => {
                                      const active = isSidebarHrefActive(sub.href, pathname)
                                      return (
                                        <div key={sub.name} className="flex items-center gap-2">
                                          <Link
                                            href={sub.href}
                                            target="_blank"
                                            rel="noreferrer"
                                            prefetch={false}
                                            onClick={handleSidebarLinkClick}
                                            className={cn(
                                              'block flex-1 rounded-lg bg-white/10 px-3 py-2 text-[11px] font-medium shadow-sm transition-all',
                                              active
                                                ? 'border-l-2 border-indigo-100 text-white font-semibold'
                                                : 'border-l-2 border-transparent text-indigo-50/85 hover:border-indigo-100/80 hover:bg-white/18 hover:text-white'
                                            )}
                                          >
                                            {sub.name}
                                          </Link>
                                          {isEligibleFavouriteHref(sub.href) ? (
                                            <button
                                              type="button"
                                              onClick={() => void toggleFavourite(sub.href)}
                                              className={cn(
                                                'flex h-8 w-8 items-center justify-center rounded-lg border transition',
                                                favouriteHrefs.includes(sub.href)
                                                  ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
                                                  : 'border-white/10 bg-white/8 text-indigo-50/55 hover:bg-white/14 hover:text-amber-200'
                                              )}
                                              aria-label={favouriteHrefs.includes(sub.href) ? `Remove ${sub.name} from favourites` : `Add ${sub.name} to favourites`}
                                              title={favouriteHrefs.includes(sub.href) ? 'Remove from favourites' : 'Add to favourites'}
                                            >
                                              <Star className={cn('h-3.5 w-3.5', favouriteHrefs.includes(sub.href) && 'fill-current')} />
                                            </button>
                                          ) : null}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </nav>
              </div>
            )}
          </div>
        </div>

        {/* User Section */}
        {/* <div className="shrink-0 border-t border-white/20 bg-[linear-gradient(135deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.06)_100%)] p-6">
          <button
            onClick={async () => {
              if (signingOut) return
              setSigningOut(true)
              try {
                await fetch('/api/auth/logout', { method: 'POST' })
                await supabase.auth.signOut()
                router.push('/auth/login')
                router.refresh()
              } catch (error) {
                console.error('Error logging out:', error)
                setSigningOut(false)
              }
            }}
            disabled={signingOut}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-2xl text-sm font-bold uppercase tracking-widest text-indigo-50/85 transition-all duration-200 hover:bg-white/18 hover:text-white group disabled:cursor-wait disabled:opacity-75',
              collapsed ? 'h-12 w-12 justify-center mx-auto' : 'px-4 py-3'
            )}
          >
            {signingOut ? (
              <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
            ) : (
              <LogOut className="h-5 w-5 flex-shrink-0 transition-transform group-hover:rotate-12" />
            )}
            {!collapsed && <span className="text-[10px]">{signingOut ? 'Signing out...' : 'Sign out'}</span>}
          </button>
        </div> */}
      </div>
    </>
  )
}
