'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'
import { MainLayout } from '@/components/layout/main-layout'
import { Input } from '@/components/ui/input'
import {
  ALL_SECTIONS,
  canUserAccessSection,
  type SearchSection,
  type DepartmentType,
  type SectionCategory,
} from '@/lib/navigation/sections'
import {
  Search,
  LayoutGrid,
  List,
  Star,
  ShieldCheck,
  Info,
  ArrowRight,
  Loader2,
  X,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Category metadata definitions matching design aesthetic
interface CategoryMeta {
  id: SectionCategory
  title: string
  description: string
  avatarBg: string
  avatarText: string
  badgeBg: string
  badgeText: string
  badgeBorder: string
  viewAllColor: string
}

const CATEGORY_CONFIG: CategoryMeta[] = [
  {
    id: 'common_dashboards',
    title: 'Common Dashboards',
    description: 'Shared dashboards used across multiple departments',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)] hover:opacity-80',
  },
  {
    id: 'general_modules',
    title: 'General Modules',
    description: 'Core business and administrative dashboards',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)] hover:opacity-80',
  },
  {
    id: 'kia',
    title: 'KIA Dashboards',
    description: 'KIA-specific business dashboards and reports',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)] hover:opacity-80',
  },
  {
    id: 'hyundai',
    title: 'Hyundai Dashboards',
    description: 'Hyundai-specific business dashboards and reports',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)] hover:opacity-80',
  },
  {
    id: 'platinum',
    title: 'Platinum Dashboards',
    description: 'Platinum-specific dashboards and reports',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)] hover:opacity-80',
  },
]

type FilterOptionId = 'all' | DepartmentType | 'kia' | 'hyundai' | 'platinum' | 'common'

const FILTER_PILLS: { id: FilterOptionId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sales', label: 'Sales' },
  { id: 'service', label: 'Service' },
  { id: 'finance', label: 'Finance' },
  { id: 'admin', label: 'Admin' },
  { id: 'kia', label: 'KIA' },
  { id: 'hyundai', label: 'Hyundai' },
  { id: 'platinum', label: 'Platinum' },
  { id: 'common', label: 'Common' },
]

export function SearchPageClient() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterOptionId>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')


  const { userRole, userBrand, loading: roleLoading } = useUserRole()

  // User starred preferences synced with sidebar & Supabase
  const {
    value: favouriteHrefsValue,
    setValue: setFavouriteHrefs,
  } = useUserPreferences<string[]>('sidebar_favourites', [])

  const favouriteHrefs = useMemo(() => favouriteHrefsValue ?? [], [favouriteHrefsValue])

  const toggleFavourite = (href: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (favouriteHrefs.includes(href)) {
      setFavouriteHrefs(favouriteHrefs.filter((h) => h !== href))
    } else {
      setFavouriteHrefs([...favouriteHrefs, href])
    }
  }

  // Fetch permissions
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

  // Filter sections based on search query & active filter pill
  const filteredSections = useMemo(() => {
    const query = search.toLowerCase().trim()
    return authorizedSections.filter((section) => {
      // Search matching
      const matchesSearch =
        !query ||
        section.name.toLowerCase().includes(query) ||
        section.description.toLowerCase().includes(query) ||
        section.brand.toLowerCase().includes(query) ||
        section.department.toLowerCase().includes(query) ||
        (section.initials && section.initials.toLowerCase().includes(query))

      // Filter pill matching
      let matchesFilter = true
      if (activeFilter !== 'all') {
        if (['sales', 'service', 'finance', 'admin'].includes(activeFilter)) {
          matchesFilter = section.department === activeFilter
        } else if (['kia', 'hyundai', 'platinum', 'common'].includes(activeFilter)) {
          matchesFilter = section.brand === activeFilter
        }
      }

      return matchesSearch && matchesFilter
    })
  }, [authorizedSections, search, activeFilter])

  // Group sections by category AND sort alphabetically (A-Z)
  const groupedByCategory = useMemo(() => {
    const map: Record<SectionCategory, SearchSection[]> = {
      common_dashboards: [],
      general_modules: [],
      kia: [],
      hyundai: [],
      platinum: [],
    }

    filteredSections.forEach((section) => {
      const cat = section.category || (section.brand === 'common' ? 'common_dashboards' : (section.brand as SectionCategory))
      if (map[cat]) {
        map[cat].push(section)
      }
    })

    // Sort each category alphabetically by name
    for (const key of Object.keys(map) as SectionCategory[]) {
      map[key].sort((a, b) => a.name.localeCompare(b.name))
    }

    return map
  }, [filteredSections])

  const isPageLoading = roleLoading || permissionsLoading



  return (
    <MainLayout
      title="Search Sections"
      subtitle="Quickly find and navigate to dashboard sections"
    >
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        
        {/* ── Search Card ── */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4 dark:bg-slate-900 dark:border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-xl font-black text-slate-950 dark:text-white flex items-center gap-2">
                <Search className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Quick Navigator
              </h2>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                Search or filter sections across all departments and brands
              </p>
            </div>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 self-start sm:self-auto"
              >
                <X className="w-3.5 h-3.5" /> Clear search
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by section name, brand, department, initials or description..."
              className="pl-11 pr-4 h-11 w-full rounded-2xl border-slate-200 text-xs font-semibold focus-visible:ring-blue-500 dark:border-white/10 dark:bg-slate-950"
            />
          </div>
        </div>

        {/* ── Top Bar: Filter by & View Mode ── */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-4 dark:bg-slate-900 dark:border-white/10">
          {/* Left: Filter by Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 mr-1 dark:text-slate-400">Filter by:</span>
            {FILTER_PILLS.map((pill) => {
              const isActive = activeFilter === pill.id
              return (
                <button
                  key={pill.id}
                  onClick={() => setActiveFilter(pill.id)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border',
                    isActive
                      ? 'bg-[#071a2b] border-[#071a2b] text-white shadow-xs dark:bg-blue-600 dark:border-blue-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-900 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-800'
                  )}
                >
                  {pill.label}
                </button>
              )
            })}
          </div>

          {/* Right: View Mode Toggle */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">View:</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setViewMode('grid')}
                title="Grid View"
                className={cn(
                  'p-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center',
                  viewMode === 'grid'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:border-white/10 dark:text-slate-400'
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List View"
                className={cn(
                  'p-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center',
                  viewMode === 'list'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:border-white/10 dark:text-slate-400'
                )}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Content Section ── */}
        {isPageLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
            <span className="text-xs font-bold">Loading authorized sections...</span>
          </div>
        ) : filteredSections.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs flex flex-col items-center justify-center py-20 text-center px-6 dark:bg-slate-900 dark:border-white/10">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mb-3 dark:bg-slate-950 dark:border-white/10">
              <Search className="w-7 h-7 text-slate-300 dark:text-slate-600" />
            </div>
            <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">
              No matching sections found
            </h3>
            <p className="text-xs text-slate-400 font-medium max-w-sm">
              Try adjusting your search keywords or filter pill. Note that sections you do not have permissions to access are hidden.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {CATEGORY_CONFIG.map((cat) => {
              const sections = groupedByCategory[cat.id] || []
              if (sections.length === 0) return null



              return (
                <div
                  key={cat.id}
                  className="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4 dark:bg-slate-900 dark:border-white/10"
                >
                  {/* Category Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-white/5">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">
                          {cat.title}
                        </h3>
                        <span className="rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-0.5 text-xs font-black">
                          {sections.length}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-400 mt-0.5">
                        {cat.description}
                      </p>
                    </div>


                  </div>

                  {/* Category Items Render */}
                  {viewMode === 'grid' ? (
                    /* ── GRID VIEW ── */
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                      {sections.map((section) => {
                        const isFav = favouriteHrefs.includes(section.href)
                        const initials = section.initials || section.name.slice(0, 2).toUpperCase()

                        return (
                          <div
                            key={section.id}
                            onClick={() => router.push(section.href)}
                            className="group relative flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs hover:shadow-md hover:border-slate-300 transition-all duration-200 cursor-pointer dark:bg-slate-950/40 dark:border-white/10 dark:hover:border-white/20"
                          >
                            <div className="flex items-center gap-3 min-w-0 pr-2">
                              {/* Avatar Box */}
                              <div
                                className={cn(
                                  'flex h-9 w-9 items-center justify-center rounded-xl font-black text-xs shrink-0 select-none transition-transform group-hover:scale-105',
                                  cat.avatarBg,
                                  cat.avatarText
                                )}
                              >
                                {initials}
                              </div>

                              {/* Title & Badge */}
                              <div className="min-w-0 space-y-0.5">
                                <h4 className="text-xs font-black text-slate-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                  {section.name}
                                </h4>
                                <div className="flex items-center gap-1">
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border',
                                      cat.badgeBg,
                                      cat.badgeText,
                                      cat.badgeBorder
                                    )}
                                  >
                                    {section.brand.toUpperCase()}
                                  </span>
                                  {section.badge && (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900/40">
                                      {section.badge}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Bookmark Star Button */}
                            <button
                              onClick={(e) => toggleFavourite(section.href, e)}
                              title={isFav ? 'Remove from bookmarks' : 'Add to bookmarks'}
                              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                            >
                              <Star
                                className={cn(
                                  'w-3.5 h-3.5 transition-all',
                                  isFav
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-300 hover:text-amber-400 dark:text-slate-600 dark:hover:text-amber-400'
                                )}
                              />
                            </button>
                          </div>
                        )
                      })}


                    </div>
                  ) : (
                    /* ── LIST VIEW ── */
                    <div className="space-y-2">
                      {sections.map((section) => {
                        const isFav = favouriteHrefs.includes(section.href)
                        const initials = section.initials || section.name.slice(0, 2).toUpperCase()

                        return (
                          <div
                            key={section.id}
                            onClick={() => router.push(section.href)}
                            className="group flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer dark:bg-slate-950/40 dark:border-white/10"
                          >
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div
                                className={cn(
                                  'flex h-9 w-9 items-center justify-center rounded-xl font-black text-xs shrink-0',
                                  cat.avatarBg,
                                  cat.avatarText
                                )}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-black text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                    {section.name}
                                  </h4>
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border',
                                      cat.badgeBg,
                                      cat.badgeText,
                                      cat.badgeBorder
                                    )}
                                  >
                                    {section.brand.toUpperCase()}
                                  </span>
                                  {section.badge && (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200 text-[8px]">
                                      {section.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] font-medium text-slate-400 line-clamp-1 mt-0.5">
                                  {section.description}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">
                                {section.department}
                              </span>
                              <button
                                onClick={(e) => toggleFavourite(section.href, e)}
                                title={isFav ? 'Remove from bookmarks' : 'Add to bookmarks'}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              >
                                <Star
                                  className={cn(
                                    'w-4 h-4 transition-all',
                                    isFav
                                      ? 'fill-amber-400 text-amber-400'
                                      : 'text-slate-300 hover:text-amber-400 dark:text-slate-600'
                                  )}
                                />
                              </button>
                            </div>
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

        {/* ── Footer Banner ── */}
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-semibold text-slate-500 dark:bg-slate-900 dark:border-white/10">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Info className="w-4 h-4 text-blue-500 shrink-0" />
            <span>Tip: Star any section to add it to your bookmarks for quick access</span>
          </div>
          <div className="flex items-center gap-1.5 self-start sm:self-auto px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-bold dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Strict Getting Active</span>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
