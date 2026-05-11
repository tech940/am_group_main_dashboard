'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Wrench,
  ChevronDown,
  LogOut,
  Car,
  Activity,
  Bike,
  ShieldCheck,
  Disc,
  Menu,
  X
} from 'lucide-react'
import { useState } from 'react'

const brands = [
  {
    name: 'AM Tata',
    href: '/brands/tata',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/tata-2.png',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    icon: Car,
    submenus: [
      { name: 'Inventory', href: '/brands/tata/inventory' },
      { name: 'Workshops', href: '/brands/tata/workshops' },
      { name: 'Sales', href: '/brands/tata/sales' },
      { name: 'Reports', href: '/brands/tata/reports' },
    ],
  },
  {
    name: 'AM Kia',
    href: '/brands/kia',
    logo: 'https://www.kiamedia.com/content/images/default/low.jpg',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500',
    icon: Activity,
    submenus: [
      { name: 'Business Excellence', href: '/brands/kia/business-excellence' },
      { name: 'Inventory', href: '/brands/kia/inventory' },
      { name: 'Workshops', href: '/brands/kia/workshops' },
      { name: 'Sales', href: '/brands/kia/sales' },
      { name: 'Reports', href: '/brands/kia/reports' },
    ],
  },
  {
    name: 'AM Hyundai',
    href: '/brands/hyundai',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/hyundai.png',
    color: 'text-sky-500',
    bgColor: 'bg-sky-500',
    icon: ShieldCheck,
    submenus: [
      { name: 'Inventory', href: '/brands/hyundai/inventory' },
      { name: 'Workshops', href: '/brands/hyundai/workshops' },
      { name: 'Sales', href: '/brands/hyundai/sales' },
      { name: 'Reports', href: '/brands/hyundai/reports' },
    ],
  },
  {
    name: 'AM Diamond Honda',
    href: '/brands/honda',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/diamond.png',
    color: 'text-red-600',
    bgColor: 'bg-red-600',
    icon: Disc,
    submenus: [
      { name: 'Inventory', href: '/brands/honda/inventory' },
      { name: 'Workshops', href: '/brands/honda/workshops' },
      { name: 'Sales', href: '/brands/honda/sales' },
      { name: 'Reports', href: '/brands/honda/reports' },
    ],
  },
  {
    name: 'AM KTM',
    href: '/brands/ktm',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/ktm1.png',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500',
    icon: Bike,
    submenus: [
      { name: 'Inventory', href: '/brands/ktm/inventory' },
      { name: 'Workshops', href: '/brands/ktm/workshops' },
      { name: 'Sales', href: '/brands/ktm/sales' },
      { name: 'Reports', href: '/brands/ktm/reports' },
    ],
  },
  {
    name: 'AM Triumph',
    href: '/brands/triumph',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/triumph.png',
    color: 'text-slate-800',
    bgColor: 'bg-slate-800',
    icon: ShieldCheck,
    submenus: [
      { name: 'Inventory', href: '/brands/triumph/inventory' },
      { name: 'Workshops', href: '/brands/triumph/workshops' },
      { name: 'Sales', href: '/brands/triumph/sales' },
      { name: 'Reports', href: '/brands/triumph/reports' },
    ],
  },
  {
    name: 'AM Bajaj',
    href: '/brands/bajaj',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/bajaj.png',
    color: 'text-blue-700',
    bgColor: 'bg-blue-700',
    icon: Bike,
    submenus: [
      { name: 'Inventory', href: '/brands/bajaj/inventory' },
      { name: 'Workshops', href: '/brands/bajaj/workshops' },
      { name: 'Sales', href: '/brands/bajaj/sales' },
      { name: 'Reports', href: '/brands/bajaj/reports' },
    ],
  },
  {
    name: 'AM MG',
    href: '/brands/mg',
    logo: 'https://amgroupind.com/wp-content/uploads/2024/10/mg-am-1.png',
    color: 'text-rose-600',
    bgColor: 'bg-rose-600',
    icon: Wrench,
    submenus: [
      { name: 'Inventory', href: '/brands/mg/inventory' },
      { name: 'Workshops', href: '/brands/mg/workshops' },
      { name: 'Sales', href: '/brands/mg/sales' },
      { name: 'Reports', href: '/brands/mg/reports' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(true)
  const [openBrand, setOpenBrand] = useState<string | null>(null)

  const toggleBrand = (brandName: string) => {
    if (openBrand === brandName) {
      setOpenBrand(null)
    } else {
      setOpenBrand(brandName)
      if (collapsed) setCollapsed(false)
    }
  }

  return (
    <div
      className={cn(
        'flex h-screen flex-col bg-slate-900 border-r border-slate-800 transition-all duration-500 ease-in-out sticky top-0 z-50 shadow-2xl',
        collapsed ? 'w-24' : 'w-80'
      )}
    >
      {/* Header with Hamburger */}
      <div className={cn(
        "flex items-center transition-all duration-500 shrink-0 border-b border-slate-800/50 shadow-sm z-10",
        collapsed ? "h-24 justify-center bg-slate-900 px-0" : "h-24 justify-between bg-slate-900 px-6"
      )}>
        {!collapsed && (
          <div className="flex items-center gap-3 h-12 flex-1 ml-2">
            <img 
              src="https://amgroupind.com/wp-content/uploads/2023/06/logo-1.png" 
              alt="AM Group" 
              className="h-8 object-contain brightness-0 invert"
            />
            <div className="h-4 w-[1px] bg-white/20" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/90">
              Management
            </span>
          </div>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300",
            "text-white/70 hover:bg-white/10 hover:text-white"
          )}
        >
          {collapsed ? <Menu className="h-6 w-6" /> : <X className="h-5 w-5" />}
        </button>
      </div>

      {/* Navigation */}
      <div className={cn(
        "flex-1 overflow-y-auto py-8 scrollbar-none transition-all duration-500",
        collapsed ? "px-0" : "px-6"
      )}>
        <div className="space-y-10">
          {/* Brands Section */}
          <div className="mt-[-20px]">
            {!collapsed && (
              <p className="mb-6 px-4 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                Managed Brands
              </p>
            )}
            <nav className="space-y-4">
              {brands.map((brand) => {
                const isOpen = openBrand === brand.name
                const isActive = pathname?.startsWith(brand.href)
                
                return (
                  <div key={brand.name} className="space-y-2">
                    <button
                      onClick={() => toggleBrand(brand.name)}
                      className={cn(
                        'flex items-center gap-4 rounded-2xl transition-all duration-300 outline-none cursor-pointer group border transition-all',
                        (isOpen || isActive)
                          ? 'bg-white/10 border-white/20 shadow-lg'
                          : 'bg-transparent border-transparent hover:bg-white/5',
                        collapsed ? 'h-16 w-16 justify-center p-0 mx-auto' : 'w-full p-2.5 text-sm'
                      )}
                    >
                      <div className={cn(
                        "h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-lg overflow-hidden border border-white/10",
                        brand.bgColor
                      )}>
                        {brand.logo ? (
                          <img 
                            src={brand.logo} 
                            alt={brand.name} 
                            className={cn(
                              "h-full w-full object-contain p-1.5",
                              brand.name === 'AM Kia' ? "mix-blend-multiply" : "brightness-0 invert"
                            )}
                          />
                        ) : (
                          <brand.icon className={cn(
                            "h-6 w-6 transition-all duration-300",
                            (isOpen || isActive) ? "text-purple-600" : "text-slate-400 group-hover:text-slate-600"
                          )} />
                        )}
                      </div>
                      {!collapsed && (
                        <>
                          <span className={cn(
                            "flex-1 text-left text-[14px] font-bold tracking-tight transition-colors",
                            (isOpen || isActive) ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                          )}>{brand.name}</span>
                          <ChevronDown className={cn(
                            "h-4 w-4 transition-all duration-300",
                            isOpen ? "rotate-180 text-purple-600" : "opacity-30"
                          )} />
                        </>
                      )}
                    </button>
                    
                    {!collapsed && isOpen && (
                      <div className="mx-2 mt-1 space-y-1 rounded-2xl bg-black/20 p-3 border border-white/5 shadow-inner animate-in slide-in-from-top-2 duration-300">
                        {brand.submenus.map((sub) => (
                          <Link
                            key={sub.name}
                            href={sub.href}
                            className={cn(
                              'block px-4 py-2.5 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all',
                              pathname === sub.href
                                ? 'bg-purple-600 text-white shadow-lg'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
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
        </div>
      </div>

      {/* User Section */}
      <div className="border-t border-slate-800 p-6 bg-slate-900/50 shrink-0">
        <Link
          href="/auth/logout"
          className={cn(
            'flex items-center gap-3 rounded-2xl text-sm font-bold uppercase tracking-widest text-slate-400 transition-all duration-200 hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer group',
            collapsed ? 'h-12 w-12 justify-center mx-auto' : 'px-4 py-3'
          )}
        >
          <LogOut className="h-5 w-5 flex-shrink-0 group-hover:rotate-12 transition-transform" />
          {!collapsed && <span className="text-[10px]">Sign out</span>}
        </Link>
      </div>
    </div>
  )
}
