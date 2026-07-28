'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useUserRole } from '@/lib/hooks/use-user-role'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ALL_SECTIONS,
  canUserAccessSection,
  type SearchSection,
  type DepartmentType,
  type SectionCategory,
} from '@/lib/navigation/sections'
import {
  Search,
  Star,
  CornerDownLeft,
  Loader2,
  X,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'

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

const CATEGORY_CONFIG: Record<SectionCategory, CategoryMeta> = {
  common_dashboards: {
    id: 'common_dashboards',
    title: 'Common Dashboards',
    description: 'Shared dashboards used across multiple departments',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)]',
  },
  general_modules: {
    id: 'general_modules',
    title: 'General Modules',
    description: 'Core business and administrative dashboards',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)]',
  },
  kia: {
    id: 'kia',
    title: 'KIA Dashboards',
    description: 'KIA-specific business dashboards and reports',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)]',
  },
  hyundai: {
    id: 'hyundai',
    title: 'Hyundai Dashboards',
    description: 'Hyundai-specific business dashboards and reports',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)]',
  },
  platinum: {
    id: 'platinum',
    title: 'Platinum Dashboards',
    description: 'Platinum-specific dashboards and reports',
    avatarBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] border border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    avatarText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBg: 'bg-[var(--dashboard-primary-soft)] dark:bg-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)]',
    badgeText: 'text-[var(--dashboard-primary-dark)] dark:text-[var(--dashboard-primary-light)]',
    badgeBorder: 'border-[var(--dashboard-primary-border)]/50 dark:border-[var(--dashboard-primary-light)]/20',
    viewAllColor: 'text-[var(--dashboard-primary)] dark:text-[var(--dashboard-primary-light)]',
  },
}

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

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterOptionId>('all')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [navigatingSection, setNavigatingSection] = useState<SearchSection | null>(null)


  const searchInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    value: favouriteHrefsValue,
    setValue: setFavouriteHrefs,
  } = useUserPreferences<string[]>('sidebar_favourites', [])

  const favouriteHrefs = useMemo(() => (Array.isArray(favouriteHrefsValue) ? favouriteHrefsValue : []), [favouriteHrefsValue])

  const toggleFavourite = (e: React.MouseEvent, href: string) => {
    e.stopPropagation()
    if (favouriteHrefs.includes(href)) {
      setFavouriteHrefs(favouriteHrefs.filter((item) => item !== href))
    } else {
      setFavouriteHrefs([...favouriteHrefs, href])
    }
  }

  const { userRole, userBrand, loading: roleLoading } = useUserRole()

  // Fetch permissions cached query
  const { data: permissionMap } = useQuery({
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

  // Filter sections authorized for current user
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
      const matchesSearch =
        !query ||
        section.name.toLowerCase().includes(query) ||
        section.description.toLowerCase().includes(query) ||
        section.brand.toLowerCase().includes(query) ||
        section.department.toLowerCase().includes(query) ||
        (section.initials && section.initials.toLowerCase().includes(query))

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

  // Group by category AND sort ALPHABETICALLY (A-Z) inside each category
  const orderedCategorizedGroups = useMemo(() => {
    const categories: SectionCategory[] = ['common_dashboards', 'general_modules', 'kia', 'hyundai', 'platinum']
    const result: { category: SectionCategory; sections: SearchSection[] }[] = []

    categories.forEach((catId) => {
      const list = filteredSections.filter((section) => {
        const c = section.category || (section.brand === 'common' ? 'common_dashboards' : (section.brand as SectionCategory))
        return c === catId
      })

      if (list.length > 0) {
        // Sort ALPHABETICALLY by section.name
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
        result.push({ category: catId, sections: sorted })
      }
    })

    return result
  }, [filteredSections])

  // Flat list of visible ordered sections for keyboard navigation (↑↓←→, Enter)
  const flatOrderedSections = useMemo(() => {
    return orderedCategorizedGroups.flatMap((group) => group.sections)
  }, [orderedCategorizedGroups])

  // Reset selected item index on filter/search change
  useEffect(() => {
    setSelectedIndex(0)
  }, [search, activeFilter])

  // Reset state when modal is opened
  useEffect(() => {
    if (open) {
      setSearch('')
      setActiveFilter('all')
      setSelectedIndex(0)
      setNavigatingSection(null)
      const timer = setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus()
          searchInputRef.current.select()
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Keyboard navigation logic
  useEffect(() => {
    const getColumnsCount = () => {
      if (typeof window === 'undefined') return 5
      const width = window.innerWidth
      if (width >= 1280) return 5
      if (width >= 1024) return 4
      if (width >= 768) return 3
      if (width >= 640) return 2
      return 1
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open || navigatingSection) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        onOpenChange(false)
        return
      }

      const cols = getColumnsCount()
      const total = flatOrderedSections.length

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(total - 1, prev + cols))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(0, prev - cols))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(total - 1, prev + 1))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(0, prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (flatOrderedSections[selectedIndex]) {
          handleNavigate(flatOrderedSections[selectedIndex])
        }
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const pills = FILTER_PILLS.map((p) => p.id)
        const nextIdx = (pills.indexOf(activeFilter) + (e.shiftKey ? -1 : 1) + pills.length) % pills.length
        setActiveFilter(pills[nextIdx])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, flatOrderedSections, selectedIndex, activeFilter, navigatingSection, onOpenChange])

  // Auto-scroll selected element into view
  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.querySelector('[data-active="true"]')
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex])

  const handleNavigate = (section: SearchSection) => {
    setNavigatingSection(section)
    setTimeout(() => onOpenChange(false), 200)
    router.push(section.href)
  }



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] 2xl:max-w-[1640px] w-full h-[88vh] max-h-[900px] flex flex-col overflow-hidden p-0 border border-slate-200/80 bg-slate-50/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 rounded-[28px]">
        <DialogTitle className="sr-only">Search Sections</DialogTitle>

        {/* ── Search Input Header ── */}
        <div className="relative flex items-center border-b border-slate-200/60 px-6 py-4 dark:border-white/10 shrink-0">
          <Search className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to search dashboard sections..."
            className="w-full bg-transparent pl-3 pr-10 text-base font-semibold text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder-slate-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Filter Pills Bar ── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/50 bg-slate-100/50 px-6 py-3 dark:border-white/5 dark:bg-slate-900/30 shrink-0">
          <span className="text-xs font-bold text-slate-500 mr-1 dark:text-slate-400">FILTER:</span>
          {FILTER_PILLS.map((pill) => {
            const isActive = activeFilter === pill.id
            return (
              <button
                key={pill.id}
                onClick={() => setActiveFilter(pill.id)}
                className={cn(
                  'rounded-full px-3.5 py-1 text-xs font-bold transition-all border',
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

        {/* ── Categorized Sections View ── */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800"
        >
          {flatOrderedSections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-white/10 dark:bg-slate-900">
                <Search className="h-5 w-5 text-slate-300 dark:text-slate-700" />
              </div>
              <p className="mt-4 text-sm font-bold text-slate-800 dark:text-slate-200">No dashboard sections match your query</p>
              <p className="mt-1 text-xs text-slate-400 font-medium">Verify your spelling, filter selection, or permissions.</p>
            </div>
          ) : (
            orderedCategorizedGroups.map((group) => {
              const catMeta = CATEGORY_CONFIG[group.category] || CATEGORY_CONFIG.common_dashboards
              const sections = group.sections



              return (
                <div
                  key={group.category}
                  className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-xs space-y-3.5 dark:bg-slate-900 dark:border-white/10"
                >
                  {/* Category Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">
                          {catMeta.title}
                        </h3>
                        <span className="rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-0.5 text-xs font-black">
                          {sections.length}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-400 mt-0.5">
                        {catMeta.description}
                      </p>
                    </div>


                  </div>

                  {/* Section Cards Grid (Sorted Alphabetically) */}
                  <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {sections.map((section) => {
                      const flatIndex = flatOrderedSections.findIndex((s) => s.id === section.id)
                      const isSelected = flatIndex === selectedIndex
                      const initials = section.initials || section.name.slice(0, 2).toUpperCase()
                      const isFav = favouriteHrefs.includes(section.href)

                      return (
                        <div
                          key={section.id}
                          data-active={isSelected}
                          onClick={() => handleNavigate(section)}
                          className={cn(
                            'group relative flex cursor-pointer items-center justify-between rounded-2xl border p-3 transition-all duration-200 shadow-2xs hover:shadow-md',
                            isSelected
                              ? 'border-blue-600 bg-white ring-2 ring-blue-600/10 dark:border-blue-500 dark:bg-slate-900 dark:ring-blue-500/10'
                              : 'border-slate-200/80 bg-white hover:border-slate-300 dark:border-white/5 dark:bg-slate-900/60 dark:hover:border-white/10'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-2">
                            {/* Avatar Initials Box */}
                            <div
                              className={cn(
                                'flex h-9 w-9 items-center justify-center rounded-xl font-black text-xs shrink-0 select-none transition-transform group-hover:scale-105',
                                catMeta.avatarBg,
                                catMeta.avatarText
                              )}
                            >
                              {initials}
                            </div>

                            {/* Text Details */}
                            <div className="min-w-0 space-y-0.5">
                              <h4 className="text-xs font-black text-slate-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {section.name}
                              </h4>
                              <div className="flex items-center gap-1">
                                <span
                                  className={cn(
                                    'px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border',
                                    catMeta.badgeBg,
                                    catMeta.badgeText,
                                    catMeta.badgeBorder
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

                          {/* Bookmark Star & Enter Indicator */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={(e) => toggleFavourite(e, section.href)}
                              title={isFav ? 'Remove from bookmarks' : 'Add to bookmarks'}
                              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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

                            {isSelected && (
                              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[8px] dark:bg-slate-800">
                                <CornerDownLeft className="h-2.5 w-2.5 text-slate-400" />
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Modal Footer helper info */}
        <div className="flex items-center justify-between border-t border-slate-200/50 bg-slate-100/50 px-6 py-3.5 dark:border-white/5 dark:bg-slate-900/30 text-[10px] font-bold text-slate-400 shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-xs dark:border-white/10 dark:bg-slate-850">↑↓←→</span>
              to navigate
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-xs dark:border-white/10 dark:bg-slate-850">Enter</span>
              to select
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-xs dark:border-white/10 dark:bg-slate-850">Tab</span>
              to cycle filters
            </span>
          </div>
          <div>
            <span>Strict Gating Active</span>
          </div>
        </div>

        {/* Loading overlay when navigating */}
        {navigatingSection && (
          <div className="absolute top-0 left-0 right-0 z-50 overflow-hidden rounded-t-[28px] bg-slate-900/95 backdrop-blur-md p-3 border-b border-emerald-500/30 flex items-center justify-between animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-white flex items-center gap-1.5">
                  Opening {navigatingSection.name}...
                </span>
                <span className="text-[10px] font-bold text-emerald-400">
                  Navigating to {navigatingSection.href}
                </span>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 animate-pulse" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
