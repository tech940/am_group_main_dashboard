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
  ShoppingCart
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { useSidebar } from '@/context/sidebar-context'
import { useUserRole } from '@/lib/hooks/use-user-role'

const brandNavigation = [
  {
    name: 'AM Kia',
    key: 'kia',
    href: '/brands/kia',
    logo: 'https://www.citypng.com/public/uploads/preview/kia-white-logo-hd-png-7017516947105094q5qjti6gq.png',
    color: 'text-slate-900',
    icon: Activity,
    submenus: [
      { name: 'Business Excellence', href: '/brands/kia/business-excellence' },
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
  const { collapsed, setCollapsed } = useSidebar()
  const [openBrand, setOpenBrand] = useState<string | null>(null)
  const [openAdmin, setOpenAdmin] = useState(false)
  const { userRole, isAdmin, canAccessAdmin, userBrand, loading } = useUserRole()

  const canAccessBrand = (brandKey: string) => {
    if (userRole === 'admin') return true
    if (!userBrand) return false
    if (hasAllBranchAccess(userBrand)) return true
    return brandKey === userBrand
  }

  const visibleBrands = availableBrands
    .filter((brand) => canAccessBrand(brand.key))
    .sort((a, b) => {
      if (userBrand) {
        if (a.key === userBrand) return -1
        if (b.key === userBrand) return 1
      }

      const aOrder = BRANCH_OPTIONS.findIndex((branch) => branch.value === a.key)
      const bOrder = BRANCH_OPTIONS.findIndex((branch) => branch.value === b.key)
      return aOrder - bOrder
    })

  // Auto-open user's assigned brand on load
  useEffect(() => {
    if (!loading && userBrand && !isAdmin && !hasAllBranchAccess(userBrand)) {
      const brandName = getBrandName(userBrand)
      if (brandName) {
        const timer = window.setTimeout(() => {
          setOpenBrand(brandName)
        }, 0)

        return () => {
          window.clearTimeout(timer)
        }
      }
    }
  }, [userBrand, isAdmin, loading])

  const toggleBrand = (brandName: string) => {
    const brandKey = getBrandKey(brandName)
    // Only allow toggling if user can access this brand
    if (canAccessBrand(brandKey)) {
      if (openBrand === brandName) {
        setOpenBrand(null)
      } else {
        setOpenBrand(brandName)
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
          'fixed inset-y-0 left-0 flex flex-col bg-slate-50 border-r border-slate-200 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] z-50 shadow-2xl overflow-hidden',
          collapsed ? 'w-0 border-none' : 'w-72'
        )}
      >
        {/* Header with Hamburger */}
        <div className={cn(
          "flex items-center transition-all duration-500 shrink-0 border-b border-slate-200 shadow-sm z-10",
          collapsed ? "h-20 justify-center bg-white px-0" : "h-20 justify-between bg-white px-4"
        )}>
          {!collapsed && (
            <div className="flex items-center gap-2 h-12 flex-1 ml-1">
              <div className="bg-slate-800 px-3 py-4 rounded-lg">
                <img
                  src="https://amgroupind.com/wp-content/uploads/2023/06/logo-1.png"
                  alt="AM Group"
                  className="h-9 object-contain"
                />
              </div>
              <div className="h-3 w-[1px] bg-slate-300" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-700">
                Management
              </span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300",
              "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                <p className="mb-6 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Main Menu
                </p>
              )}
              <nav className="space-y-2">
                {isAdmin ? (
                  <Link
                    href="/dashboard"
                    onClick={() => setCollapsed(true)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                      pathname === '/dashboard'
                        ? 'bg-white border-l-4 border-teal-600 text-teal-700 font-semibold shadow-sm pl-3'
                        : 'bg-white border-l-4 border-transparent text-slate-600 hover:shadow-sm hover:border-teal-200 pl-3',
                      collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'w-full py-3 pr-3'
                    )}
                  >
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                      pathname === '/dashboard' ? "bg-teal-50" : "bg-slate-50 group-hover:bg-teal-50"
                    )}>
                      <LayoutDashboard className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        pathname === '/dashboard' ? "text-teal-600" : "text-slate-600 group-hover:text-teal-600"
                      )} />
                    </div>
                    {!collapsed && (
                      <span className="flex-1 text-left text-sm">Dashboard</span>
                    )}
                  </Link>
                ) : (
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none opacity-60 cursor-not-allowed',
                      'bg-white border-l-4 border-transparent text-slate-400 pl-3',
                      collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'w-full py-3 pr-3'
                    )}
                  >
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-50">
                      <LayoutDashboard className="h-4.5 w-4.5 text-slate-400" />
                    </div>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left text-sm">Dashboard</span>
                        <Lock className="h-4 w-4 text-slate-400" />
                      </>
                    )}
                  </div>
                )}

                <Link
                  href="/purchase-orders"
                  onClick={() => setCollapsed(true)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl transition-all duration-200 outline-none cursor-pointer group',
                    pathname === '/purchase-orders'
                      ? 'bg-white border-l-4 border-purple-600 text-purple-700 font-semibold shadow-sm pl-3'
                      : 'bg-white border-l-4 border-transparent text-slate-600 hover:shadow-sm hover:border-purple-200 pl-3',
                    collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'w-full py-3 pr-3'
                  )}
                >
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                    pathname === '/purchase-orders' ? "bg-purple-50" : "bg-slate-50 group-hover:bg-purple-50"
                  )}>
                    <ShoppingCart className={cn(
                      "h-4.5 w-4.5 transition-colors",
                      pathname === '/purchase-orders' ? "text-purple-600" : "text-slate-600 group-hover:text-purple-600"
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
                        ? 'bg-white border-l-4 border-emerald-600 text-emerald-700 font-semibold shadow-sm pl-3'
                        : canAccessAdmin
                          ? 'bg-white border-l-4 border-transparent text-slate-600 hover:shadow-sm hover:border-emerald-200 cursor-pointer group pl-3'
                          : 'bg-white border-l-4 border-transparent text-slate-400 opacity-60 cursor-not-allowed pl-3',
                      collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'py-3 pr-3'
                    )}
                  >
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                      (openAdmin || pathname?.startsWith('/admin')) ? "bg-emerald-50" : "bg-slate-50 group-hover:bg-emerald-50"
                    )}>
                      <Shield className={cn(
                        "h-4.5 w-4.5 transition-colors",
                        (openAdmin || pathname?.startsWith('/admin')) ? "text-emerald-600" : "text-slate-600 group-hover:text-emerald-600"
                      )} />
                    </div>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left text-sm">Admin Panel</span>
                        {!canAccessAdmin ? (
                          <Lock className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronDown className={cn(
                            "h-4 w-4 transition-transform duration-300",
                            openAdmin ? "rotate-180 text-emerald-600" : "text-slate-400"
                          )} />
                        )}
                      </>
                    )}
                  </button>

                  {!collapsed && openAdmin && (
                    <div className="ml-4 space-y-1.5 pl-4 border-l-2 border-slate-200 animate-in slide-in-from-top-2 duration-200">
                      <Link
                        href="/admin/users"
                        onClick={() => setCollapsed(true)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg transition-all bg-white shadow-sm',
                          pathname === '/admin/users'
                            ? 'border-l-2 border-emerald-600 text-emerald-700 font-semibold'
                            : 'border-l-2 border-transparent text-slate-600 hover:text-emerald-600 hover:border-emerald-200'
                        )}
                      >
                        <Users className="h-3.5 w-3.5" />
                        User Management
                      </Link>
                      <Link
                        href="/admin/settings"
                        onClick={() => setCollapsed(true)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg transition-all bg-white shadow-sm',
                          pathname === '/admin/settings'
                            ? 'border-l-2 border-emerald-600 text-emerald-700 font-semibold'
                            : 'border-l-2 border-transparent text-slate-600 hover:text-emerald-600 hover:border-emerald-200'
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
                  <p className="mb-6 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Managed Brands
                  </p>
                )}
              <nav className="space-y-4">
                {visibleBrands.map((brand) => {
                  const isOpen = openBrand === brand.name
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
                            ? `bg-white border-l-4 ${brand.color.replace('text-', 'border-')} font-semibold shadow-sm pl-3`
                            : hasAccess
                              ? 'bg-white border-l-4 border-transparent hover:shadow-sm cursor-pointer group pl-3'
                              : 'bg-white border-l-4 border-transparent opacity-60 cursor-not-allowed pl-3',
                          collapsed ? 'h-12 w-12 justify-center p-0 mx-auto border-l-0' : 'py-3 pr-3'
                        )}
                      >
                        <div className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 transition-all",
                          (isOpen || isActive) ? "bg-slate-800" : "bg-slate-700 group-hover:bg-slate-800"
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
                              (isOpen || isActive) ? "text-slate-900" : "text-slate-600 group-hover:text-slate-900"
                            )}>{brand.name}</span>
                            {!hasAccess ? (
                              <Lock className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronDown className={cn(
                                "h-4 w-4 transition-transform duration-300",
                                isOpen ? "rotate-180 text-slate-600" : "text-slate-400"
                              )} />
                            )}
                          </>
                        )}
                      </button>

                      {!collapsed && isOpen && (
                        <div className="ml-4 space-y-1.5 pl-4 border-l-2 border-slate-200 animate-in slide-in-from-top-2 duration-200">
                          {brand.submenus.map((sub) => (
                            <Link
                              key={sub.name}
                              href={sub.href}
                              onClick={() => setCollapsed(true)}
                              className={cn(
                                'block px-3 py-2.5 text-xs font-medium rounded-lg transition-all bg-white shadow-sm',
                                pathname === sub.href
                                  ? `border-l-2 ${brand.color.replace('text-', 'border-')} ${brand.color} font-semibold`
                                  : 'border-l-2 border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
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
        <div className="border-t border-slate-200 p-6 bg-slate-50 shrink-0">
          <button
            onClick={async () => {
              try {
                await fetch('/api/auth/logout', { method: 'POST' })
                await supabase.auth.signOut()
                router.push('/auth/login')
                router.refresh()
              } catch (error) {
                console.error('Error logging out:', error)
              }
            }}
            className={cn(
              'flex items-center gap-3 rounded-2xl text-sm font-bold uppercase tracking-widest text-slate-600 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 cursor-pointer group w-full',
              collapsed ? 'h-12 w-12 justify-center mx-auto' : 'px-4 py-3'
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0 group-hover:rotate-12 transition-transform" />
            {!collapsed && <span className="text-[10px]">Sign out</span>}
          </button>
        </div>
      </div>
    </>
  )
}
