'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { MainLayout } from '@/components/layout/main-layout'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ALL_SECTIONS,
  canUserAccessSection,
  type SearchSection,
  type DepartmentType,
} from '@/lib/navigation/sections'
import {
  Search,
  Gauge,
  ShoppingCart,
  Shield,
  Banknote,
  Landmark,
  FileCheck,
  Users,
  FileText,
  BarChart3,
  Layers,
  TrendingUp,
  PhoneCall,
  Clock,
  PieChart,
  Car,
  Award,
  Calendar,
  Truck,
  ClipboardList,
  Sparkles,
  ShieldAlert,
  HelpCircle,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Dynamic icon mapping helper
const IconMap: Record<string, React.ComponentType<any>> = {
  Gauge,
  ShoppingCart,
  Shield,
  Banknote,
  Landmark,
  FileCheck,
  Users,
  FileText,
  BarChart3,
  Layers,
  TrendingUp,
  PhoneCall,
  Clock,
  PieChart,
  Car,
  Award,
  Calendar,
  Truck,
  ClipboardList,
  Sparkles,
  ShieldAlert,
}

function SectionIcon({ name, className }: { name: string; className?: string }) {
  const IconComponent = IconMap[name] || HelpCircle
  return <IconComponent className={className} />
}

export function SearchPageClient() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | DepartmentType>('all')

  const { userRole, userBrand, loading: roleLoading } = useUserRole()

  // Fetch permissions cached query
  const { data: permissionMap, isLoading: permissionsLoading } = useQuery({
    queryKey: ['auth', 'permissions'],
    enabled: !!userRole,
    queryFn: async () => {
      const response = await fetch('/api/auth/permissions', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to load permissions')
      const data = await response.json()
      return data?.permissions ?? null
    },
    staleTime: 30 * 60 * 1000,
  })

  // Filter sections that the user is authorized to see
  const authorizedSections = useMemo(() => {
    if (roleLoading) return []
    return ALL_SECTIONS.filter((section) =>
      canUserAccessSection(section, userRole, userBrand, permissionMap ?? null)
    )
  }, [userRole, userBrand, permissionMap, roleLoading])

  // Filter sections based on search text & selected department tab
  const filteredSections = useMemo(() => {
    const query = search.toLowerCase().trim()
    return authorizedSections.filter((section) => {
      const matchesSearch =
        section.name.toLowerCase().includes(query) ||
        section.description.toLowerCase().includes(query) ||
        section.brand.toLowerCase().includes(query) ||
        section.department.toLowerCase().includes(query)
      
      const matchesTab = activeTab === 'all' || section.department === activeTab
      
      return matchesSearch && matchesTab
    })
  }, [authorizedSections, search, activeTab])

  // Group sections by department for presentation
  const groupedSections = useMemo(() => {
    const groups: Record<DepartmentType, SearchSection[]> = {
      sales: [],
      service: [],
      finance: [],
      admin: [],
    }

    filteredSections.forEach((section) => {
      groups[section.department].push(section)
    })

    return groups
  }, [filteredSections])

  // Department metadata
  const deptMetadata: Record<
    DepartmentType,
    { label: string; gradient: string; bgSoft: string; textClass: string; iconBg: string }
  > = {
    sales: {
      label: 'Sales & Bookings',
      gradient: 'from-rose-500 to-orange-500 dark:from-rose-600 dark:to-orange-600',
      bgSoft: 'bg-rose-50 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/30',
      textClass: 'text-rose-700 dark:text-rose-400',
      iconBg: 'bg-rose-500/10 text-rose-500 dark:bg-rose-500/20',
    },
    service: {
      label: 'Service & Workshop Operations',
      gradient: 'from-amber-500 to-yellow-500 dark:from-amber-600 dark:to-yellow-600',
      bgSoft: 'bg-amber-50 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/30',
      textClass: 'text-amber-700 dark:text-amber-400',
      iconBg: 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20',
    },
    finance: {
      label: 'Finance & Accounts',
      gradient: 'from-teal-700 to-emerald-600 dark:from-teal-800 dark:to-emerald-700',
      bgSoft: 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/30',
      textClass: 'text-emerald-700 dark:text-emerald-400',
      iconBg: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20',
    },
    admin: {
      label: 'Administration & Control',
      gradient: 'from-indigo-500 to-violet-500 dark:from-indigo-600 dark:to-violet-600',
      bgSoft: 'bg-indigo-50 border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-900/30',
      textClass: 'text-indigo-700 dark:text-indigo-400',
      iconBg: 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20',
    },
  }

  const getBrandBadge = (brand: string) => {
    switch (brand) {
      case 'kia':
        return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/40'
      case 'hyundai':
        return 'text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/40'
      case 'platinum':
        return 'text-slate-600 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
      case 'common':
        return 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/40'
      default:
        return 'text-slate-500 bg-slate-50 border-slate-200'
    }
  }

  const isPageLoading = roleLoading || permissionsLoading

  return (
    <MainLayout
      title="Search Sections"
      subtitle="Quickly find and navigate to dashboard sections"
    >
      <div className="space-y-8 max-w-6xl mx-auto">
        
        {/* ── Search Bar & Heading ── */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-[0_15px_40px_rgba(15,23,42,0.02)] space-y-6 dark:bg-slate-900 dark:border-white/5">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-950 dark:text-white flex items-center gap-2">
              <Search className="w-6 h-6 text-indigo-500" />
              Quick Navigator
            </h2>
            <p className="text-sm font-medium text-slate-400">
              Type keywords to locate pages across all brand and operations branches. Replaces searching through sidebars.
            </p>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by section name, brand, department or description..."
              className="pl-12 h-12 w-full rounded-2xl border-slate-200 text-sm font-semibold focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-slate-950"
            />
          </div>

          {/* Department filter bar */}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                'rounded-xl px-4 py-2 text-xs font-black capitalize transition-all border',
                activeTab === 'all'
                  ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-950 shadow-md'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:bg-slate-950 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-900'
              )}
            >
              All Sections
            </button>
            {(['sales', 'service', 'finance', 'admin'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'rounded-xl px-4 py-2 text-xs font-black capitalize transition-all border',
                  activeTab === tab
                    ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-950 shadow-md'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:bg-slate-950 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-900'
                )}
              >
                {deptMetadata[tab].label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading Indicator */}
        {isPageLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-10 h-10 animate-spin mr-3 text-indigo-500" />
            <span className="text-sm font-semibold mt-2">Loading authorized sections...</span>
          </div>
        ) : filteredSections.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-24 text-center px-6 dark:bg-slate-900 dark:border-white/5">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border-2 border-slate-100 flex items-center justify-center mb-4 dark:bg-slate-950 dark:border-white/10">
              <Search className="w-8 h-8 text-slate-300 dark:text-slate-700" />
            </div>
            <h3 className="text-lg font-black text-slate-800 dark:text-white mb-1">
              No matching sections found
            </h3>
            <p className="text-sm text-slate-400 font-medium max-w-xs">
              Check your query or filter tab. Note that pages you do not have permission to view are hidden.
            </p>
          </div>
        ) : (
          /* ── Grouped Results ── */
          <div className="space-y-8">
            {(['sales', 'service', 'finance', 'admin'] as const).map((dept) => {
              const sections = groupedSections[dept]
              if (sections.length === 0) return null

              const meta = deptMetadata[dept]

              return (
                <div key={dept} className="space-y-4">
                  {/* Department divider header */}
                  <div className="flex items-center gap-3 border-b border-slate-200/50 pb-3 dark:border-white/5">
                    <span className={cn('h-2.5 w-2.5 rounded-full bg-gradient-to-br', meta.gradient)} />
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-800 dark:text-slate-300">
                      {meta.label}
                    </h3>
                    <Badge className="ml-1 bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-black dark:bg-slate-950 dark:border-white/10 dark:text-slate-400">
                      {sections.length}
                    </Badge>
                  </div>

                  {/* Grid layout */}
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {sections.map((section) => (
                      <div
                        key={section.id}
                        onClick={() => router.push(section.href)}
                        className="group relative flex flex-col justify-between cursor-pointer rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 dark:border-white/5 dark:bg-slate-900/60 dark:hover:border-white/10"
                      >
                        <div className="space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            {/* Icon box */}
                            <div className={cn(
                              'flex h-10 w-10 items-center justify-center rounded-2xl shadow-sm text-white bg-gradient-to-br transition-transform group-hover:scale-105',
                              meta.gradient
                            )}>
                              <SectionIcon name={section.iconName} className="h-5 w-5" />
                            </div>

                            {/* Brand Badge */}
                            <span className={cn(
                              'rounded-md border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider',
                              getBrandBadge(section.brand)
                            )}>
                              {section.brand}
                            </span>
                          </div>

                          <div className="space-y-1">
                            <h4 className="text-sm font-black text-slate-950 dark:text-white leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                              {section.name}
                            </h4>
                            <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
                              {section.department}
                            </p>
                          </div>

                          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                            {section.description}
                          </p>
                        </div>

                        {/* Navigation action hint */}
                        <div className="flex items-center justify-end pt-5 mt-auto border-t border-slate-100/60 dark:border-white/5">
                          <button className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-500 group-hover:text-indigo-600 dark:text-indigo-400 dark:group-hover:text-indigo-300">
                            Navigate
                            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </MainLayout>
  )
}
