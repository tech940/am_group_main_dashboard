'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ChevronDown,
  LogOut,
  Activity,
  Menu,
  X,
  Settings,
  Users,
  Shield,
  Lock,
  ShoppingCart,
  Loader2
} from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { useTopLoader } from 'nextjs-toploader'

const brandNavigation = [
  {
    name: 'AM Kia',
    key: 'kia',
    href: '/brands/kia',
    logo: 'https://www.citypng.com/public/uploads/preview/kia-white-logo-hd-png-7017516947105094q5qjti6gq.png',
    color: 'text-teal-100',
    icon: Activity,
    submenus: [
      { name: 'Business Excellence', href: '/brands/kia/business-excellence/overview' },
    ],
  },
]

const availableBrands = brandNavigation.filter((brand) => brand.submenus.length > 0)

function getBrandKey(brandName: string) {
  return availableBrands.find((brand) => brand.name === brandName)?.key || ''
}

function getBrandName(brandKey: string) {
  return availableBrands.find((brand) => brand.key === brandKey)?.name || ''
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const topLoader = useTopLoader()
  const { collapsed, setCollapsed } = useSidebar()
  const [openBrands, setOpenBrands] = useState<Set<string>>(() => new Set())
  const [openAdmin, setOpenAdmin] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const { userRole, isAdmin, canAccessAdmin, userBrand, loading } = useUserRole()
  const initializedBrandMenuRef = useRef(false)

  const canAccessBrand = (brandKey: string) => {
    if (userRole === 'admin') return true
    if (!userBrand) return false
    if (hasAllBranchAccess(userBrand)) return true
    return brandKey === userBrand
  }

  const visibleBrands = useMemo(() => {
    return availableBrands
      .filter((brand) => {
        if (userRole === 'admin') return true
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

  // Initialize brand menus once from access. Manual toggles should remain under user control after this.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (loading || initializedBrandMenuRef.current) return
    initializedBrandMenuRef.current = true

    if (isAdmin || (userBrand && hasAllBranchAccess(userBrand))) {
      setOpenBrands(new Set(visibleBrands.map((brand) => brand.name)))
      return
    }

    if (userBrand) {
      const brandName = getBrandName(userBrand)
      if (brandName) setOpenBrands(new Set([brandName]))
    }
  }, [isAdmin, loading, userBrand, visibleBrands])
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleBrand = (brandName: string) => {
    const brandKey = getBrandKey(brandName)
    // Only allow toggling if user can access this brand
    if (canAccessBrand(brandKey)) {
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

  const toggleAdmin = () => {
    // Only allow toggling if user is admin
    if (canAccessAdmin) {
      setOpenAdmin(!openAdmin)
      if (collapsed) setCollapsed(false)
    }
  }

  const handleNavigation = (href: string) => {
    if (pathname !== href) {
      topLoader.start()
    }
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
          'fixed inset-y-0 left-0 flex flex-col overflow-hidden border-r border-white/45 bg-[linear-gradient(180deg,rgba(15,118,110,0.82)_0%,rgba(13,148,136,0.74)_46%,rgba(30,58,95,0.82)_100%)] shadow-2xl shadow-teal-950/20 backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] z-50',
          collapsed ? 'w-0 border-none' : 'w-72'
        )}
      >
        {/* Header with Hamburger */}
        <div className={cn(
          "flex items-center transition-all duration-500 shrink-0 border-b border-white/60 shadow-sm z-10",
          collapsed ? "h-20 justify-center bg-white/30 px-0" : "h-20 justify-between bg-white/30 px-4"
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
              <div className="h-3 w-[1px] bg-teal-700/20" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-teal-50/80">
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
            {/* Dashboard Link */}
            <div className="mt-[-20px]">
              {!collapsed && (
                <p className="mb-6 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-teal-50/65">
                  Main Menu
                </p>
              )}
              <nav className="space-y-2">
                {isAdmin ? (
                  <Link
                    href="/dashboard"
                    onClick={() => handleNavigation('/dashboard')}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                      pathname === '/dashboard'
                        ? 'bg-white/22 border-l-4 border-teal-100 text-white font-semibold shadow-sm shadow-teal-950/10 pl-3'
                        : 'bg-white/10 border-l-4 border-transparent text-teal-50/85 hover:bg-white/18 hover:text-white hover:border-teal-100/80 pl-3',
                      collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'w-full py-3 pr-3'
                    )}
                  >
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                      pathname === '/dashboard' ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                    )}>
                      <LayoutDashboard className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        pathname === '/dashboard' ? "text-white" : "text-teal-50/85 group-hover:text-white"
                      )} />
                    </div>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left text-sm">Dashboard</span>
                        <span className="rounded-full border border-white/20 bg-white/12 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-teal-50">
                          Soon
                        </span>
                      </>
                    )}
                  </Link>
                ) : (
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none opacity-60 cursor-not-allowed',
                      'bg-white/10 border-l-4 border-transparent text-teal-50/45 pl-3',
                      collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'w-full py-3 pr-3'
                    )}
                  >
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/10">
                      <LayoutDashboard className="h-4.5 w-4.5 text-slate-500" />
                    </div>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left text-sm">Dashboard</span>
                        <Lock className="h-4 w-4 text-slate-500" />
                      </>
                    )}
                  </div>
                )}

                <Link
                  href="/purchase-orders"
                  onClick={() => handleNavigation('/purchase-orders')}
                  className={cn(
                    'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                    pathname === '/purchase-orders'
                      ? 'bg-white/22 border-l-4 border-white text-white font-semibold shadow-sm shadow-teal-950/10 pl-3'
                      : 'bg-white/10 border-l-4 border-transparent text-teal-50/85 hover:bg-white/18 hover:text-white hover:border-white/70 pl-3',
                    collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'w-full py-3 pr-3'
                  )}
                >
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                    pathname === '/purchase-orders' ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                  )}>
                    <ShoppingCart className={cn(
                      "h-4.5 w-4.5 transition-colors",
                      pathname === '/purchase-orders' ? "text-white" : "text-teal-50/85 group-hover:text-white"
                    )} />
                  </div>
                  {!collapsed && (
                    <span className="flex-1 text-left text-sm">Purchase Orders</span>
                  )}
                </Link>

                <div className="space-y-2">
                  <button
                    onClick={toggleAdmin}
                    disabled={!canAccessAdmin}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none w-full relative',
                      (openAdmin || pathname?.startsWith('/admin'))
                        ? 'bg-white/22 border-l-4 border-emerald-100 text-white font-semibold shadow-sm shadow-emerald-950/10 pl-3'
                        : canAccessAdmin
                          ? 'bg-white/10 border-l-4 border-transparent text-teal-50/85 hover:bg-white/18 hover:text-white hover:border-emerald-100/80 cursor-pointer group pl-3'
                          : 'bg-white/10 border-l-4 border-transparent text-teal-50/45 opacity-60 cursor-not-allowed pl-3',
                      collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'py-3 pr-3'
                    )}
                  >
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                      (openAdmin || pathname?.startsWith('/admin')) ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                    )}>
                      <Shield className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        (openAdmin || pathname?.startsWith('/admin')) ? "text-white" : "text-teal-50/85 group-hover:text-white"
                      )} />
                    </div>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left text-sm">Admin Panel</span>
                        {!canAccessAdmin ? (
                          <Lock className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronDown className={cn(
                            "h-4 w-4 transition-transform duration-300",
                            openAdmin ? "rotate-180 text-white" : "text-teal-50/70"
                          )} />
                        )}
                      </>
                    )}
                  </button>

                  {!collapsed && openAdmin && (
                    <div className="ml-4 space-y-1.5 border-l-2 border-white/20 pl-4 animate-in slide-in-from-top-2 duration-200">
                      <Link
                        href="/admin/users"
                        onClick={() => handleNavigation('/admin/users')}
                        className={cn(
                          'flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-medium shadow-sm transition-all',
                          pathname === '/admin/users'
                            ? 'border-l-2 border-emerald-100 text-white font-semibold'
                            : 'border-l-2 border-transparent text-teal-50/85 hover:border-emerald-100/80 hover:bg-white/18 hover:text-white'
                        )}
                      >
                        <Users className="h-3.5 w-3.5" />
                        User Management
                      </Link>
                      <Link
                        href="/admin/settings"
                        onClick={() => handleNavigation('/admin/settings')}
                        className={cn(
                          'flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-medium shadow-sm transition-all',
                          pathname === '/admin/settings'
                            ? 'border-l-2 border-emerald-100 text-white font-semibold'
                            : 'border-l-2 border-transparent text-teal-50/85 hover:border-emerald-100/80 hover:bg-white/18 hover:text-white'
                        )}
                      >
                        <Settings className="h-3.5 w-3.5" />
                        Dashboard Settings
                      </Link>
                    </div>
                  )}
                </div>
              </nav>
            </div>

            {visibleBrands.length > 0 && (
              <div>
                {!collapsed && (
                  <p className="mb-6 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-teal-50/65">
                    Managed Brands
                  </p>
                )}
              <nav className="space-y-4">
                {visibleBrands.map((brand) => {
                  const isOpen = openBrands.has(brand.name)
                  const isActive = pathname?.startsWith(brand.href)
                  const hasAccess = canAccessBrand(brand.key)

                  return (
                    <div key={brand.name} className="space-y-1.5">
                      <button
                        onClick={() => toggleBrand(brand.name)}
                        disabled={!hasAccess}
                        className={cn(
                          'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none relative w-full',
                          (isOpen || isActive)
                            ? 'bg-white/22 border-l-4 border-teal-100 text-white font-semibold shadow-sm shadow-teal-950/10 pl-3'
                            : hasAccess
                              ? 'bg-white/10 border-l-4 border-transparent text-teal-50/85 hover:bg-white/18 hover:text-white hover:border-teal-100/80 cursor-pointer group pl-3'
                              : 'bg-white/10 border-l-4 border-transparent text-teal-50/45 opacity-60 cursor-not-allowed pl-3',
                          collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'py-3 pr-3'
                        )}
                      >
                        <div className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 transition-all",
                          (isOpen || isActive) ? "bg-white/20" : "bg-white/12 group-hover:bg-white/20"
                        )}>
                          {brand.logo ? (
                            <img
                              src={brand.logo}
                              alt={brand.name}
                              className="h-full w-full object-contain p-1.5"
                            />
                          ) : (
                            <brand.icon className="h-5 w-5 text-white" />
                          )}
                        </div>
                        {!collapsed && (
                          <>
                            <span className={cn(
                              "flex-1 text-left text-sm transition-colors",
                              (isOpen || isActive) ? "text-white" : "text-teal-50/85 group-hover:text-white"
                            )}>{brand.name}</span>
                            {!hasAccess ? (
                              <Lock className="h-4 w-4 text-slate-500" />
                            ) : (
                              <ChevronDown className={cn(
                                "h-4 w-4 transition-transform duration-300",
                                isOpen ? "rotate-180 text-white" : "text-teal-50/70"
                              )} />
                            )}
                          </>
                        )}
                      </button>

                      {!collapsed && isOpen && (
                        <div className="ml-4 space-y-1.5 border-l-2 border-white/20 pl-4 animate-in slide-in-from-top-2 duration-200">
                          {brand.submenus.map((sub) => (
                            <Link
                              key={sub.name}
                              href={sub.href}
                              onClick={() => handleNavigation(sub.href)}
                              className={cn(
                                'block rounded-lg bg-white/10 px-3 py-2.5 text-xs font-medium shadow-sm transition-all',
                                pathname === sub.href
                                  ? 'border-l-2 border-teal-100 text-white font-semibold'
                                  : 'border-l-2 border-transparent text-teal-50/85 hover:border-teal-100/80 hover:bg-white/18 hover:text-white'
                              )}
                            >
                              {sub.name}
                            </Link>
                          ))}
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
        <div className="shrink-0 border-t border-white/20 bg-white/10 p-6">
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
              'flex w-full cursor-pointer items-center gap-3 rounded-2xl text-sm font-bold uppercase tracking-widest text-teal-50/85 transition-all duration-200 hover:bg-white/18 hover:text-white group disabled:cursor-wait disabled:opacity-75',
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
        </div>
      </div>
    </>
  )
}
