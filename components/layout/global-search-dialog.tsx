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
  Sparkles,
  Command,
  Check,
  Shield,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'

// Official brand logo image URLs (exact logos used in Sidebar)
const KIA_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_kia.svg'
const HYUNDAI_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_hyundai.svg'
const AM_GROUP_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'

function KiaFilterLogo({ className }: { className?: string }) {
  return (
    <div className={cn("h-6 w-auto px-2 py-0.5 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-center shrink-0 select-none", className)}>
      <img src={KIA_LOGO_URL} alt="AM KIA" className="h-4.5 w-auto object-contain" />
    </div>
  )
}

function HyundaiFilterLogo({ className }: { className?: string }) {
  return (
    <div className={cn("h-6 w-auto px-2 py-0.5 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-center shrink-0 select-none", className)}>
      <img src={HYUNDAI_LOGO_URL} alt="AM Hyundai" className="h-4.5 w-auto object-contain" />
    </div>
  )
}

function PlatinumFilterLogo({ className }: { className?: string }) {
  return (
    <div className={cn("h-6 w-auto px-2 py-0.5 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-center shrink-0 select-none", className)}>
      <img src={HYUNDAI_LOGO_URL} alt="AM Platinum" className="h-4.5 w-auto object-contain" />
    </div>
  )
}

function CommonFilterLogo({ className }: { className?: string }) {
  return (
    <div className={cn("h-6 w-auto px-2 py-0.5 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-center shrink-0 select-none", className)}>
      <img src={AM_GROUP_LOGO_URL} alt="AM Group" className="h-4.5 w-auto object-contain" />
    </div>
  )
}

// Strict Brand Theme Color (#004e5a) Avatar Box styling for total visual consistency & 100% text legibility - NO BLACK
function getThemeAvatarClass(section: SearchSection): string {
  return 'bg-[#004e5a] text-white font-black shadow-xs border border-teal-600/30'
}

interface CategoryMeta {
  id: SectionCategory
  title: string
  description: string
  badgeBg: string
  badgeText: string
  avatarBg: string
  avatarText: string
  borderColor: string
  gradientBg: string
  logoUrl?: string
}

const CATEGORY_CONFIG: Record<SectionCategory, CategoryMeta> = {
  common_dashboards: {
    id: 'common_dashboards',
    title: 'Common & Group Dashboards',
    description: 'Shared group dashboards, administrative panels, finance, and general modules',
    badgeBg: 'bg-[#004e5a]/10 text-[#004e5a] border-[#004e5a]/20',
    badgeText: 'text-[#004e5a]',
    avatarBg: 'bg-[#004e5a] text-white shadow-xs',
    avatarText: 'text-white',
    borderColor: 'border-teal-300/60 dark:border-teal-500/30',
    gradientBg: 'bg-gradient-to-br from-teal-500/10 via-emerald-500/5 to-slate-50/90 dark:from-teal-950/40 dark:via-slate-900 dark:to-slate-950',
    logoUrl: AM_GROUP_LOGO_URL,
  },
  general_modules: {
    id: 'general_modules',
    title: 'General Modules',
    description: 'Core business management, finance, and administrative dashboards',
    badgeBg: 'bg-[#004e5a]/10 text-[#004e5a] border-[#004e5a]/20',
    badgeText: 'text-[#004e5a]',
    avatarBg: 'bg-[#004e5a] text-white shadow-xs',
    avatarText: 'text-white',
    borderColor: 'border-indigo-300/60 dark:border-indigo-500/30',
    gradientBg: 'bg-gradient-to-br from-indigo-500/10 via-blue-500/5 to-slate-50/90 dark:from-indigo-950/40 dark:via-slate-900 dark:to-slate-950',
    logoUrl: AM_GROUP_LOGO_URL,
  },
  kia: {
    id: 'kia',
    title: 'KIA Dashboards',
    description: 'KIA-specific sales, service, warranty, and operational reports',
    badgeBg: 'bg-[#004e5a]/10 text-[#004e5a] border-[#004e5a]/20',
    badgeText: 'text-[#004e5a]',
    avatarBg: 'bg-[#004e5a] text-white shadow-xs',
    avatarText: 'text-white',
    borderColor: 'border-slate-300/80 dark:border-slate-700/50',
    gradientBg: 'bg-gradient-to-br from-slate-900/10 via-slate-800/5 to-slate-50/90 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900',
    logoUrl: KIA_LOGO_URL,
  },
  hyundai: {
    id: 'hyundai',
    title: 'Hyundai Dashboards',
    description: 'Hyundai-specific business dashboards and operational reports',
    badgeBg: 'bg-[#004e5a]/10 text-[#004e5a] border-[#004e5a]/20',
    badgeText: 'text-[#004e5a]',
    avatarBg: 'bg-[#004e5a] text-white shadow-xs',
    avatarText: 'text-white',
    borderColor: 'border-blue-300/60 dark:border-blue-500/30',
    gradientBg: 'bg-gradient-to-br from-blue-500/10 via-sky-500/5 to-slate-50/90 dark:from-blue-950/40 dark:via-slate-900 dark:to-slate-950',
    logoUrl: HYUNDAI_LOGO_URL,
  },
  platinum: {
    id: 'platinum',
    title: 'Platinum Dashboards',
    description: 'Platinum business excellence and analytics reports',
    badgeBg: 'bg-[#004e5a]/10 text-[#004e5a] border-[#004e5a]/20',
    badgeText: 'text-[#004e5a]',
    avatarBg: 'bg-[#004e5a] text-white shadow-xs',
    avatarText: 'text-white',
    borderColor: 'border-amber-300/60 dark:border-amber-500/30',
    gradientBg: 'bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-slate-50/90 dark:from-amber-950/40 dark:via-slate-900 dark:to-slate-950',
    logoUrl: HYUNDAI_LOGO_URL,
  },
}

type FilterOptionId = 'all' | DepartmentType | 'kia' | 'hyundai' | 'platinum' | 'common'

const FILTER_PILLS: { id: FilterOptionId; label: string; logo?: React.ReactNode }[] = [
  { id: 'all', label: 'All Sections' },
  { id: 'sales', label: 'Sales' },
  { id: 'service', label: 'Service' },
  { id: 'finance', label: 'Finance' },
  { id: 'admin', label: 'Admin' },
  { id: 'kia', label: 'KIA', logo: <KiaFilterLogo /> },
  { id: 'hyundai', label: 'Hyundai', logo: <HyundaiFilterLogo /> },
  { id: 'platinum', label: 'Platinum', logo: <PlatinumFilterLogo /> },
  { id: 'common', label: 'Common', logo: <CommonFilterLogo /> },
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

  const authorizedSections = useMemo(() => {
    if (roleLoading) return []
    return ALL_SECTIONS.filter((section) =>
      canUserAccessSection(section, userRole, userBrand, permissionMap ?? null)
    )
  }, [userRole, userBrand, permissionMap, roleLoading])

// Helper to compute search relevance score for section ordering
function getRelevanceScore(section: SearchSection, query: string): number {
  if (!query) return 0
  const nameLower = section.name.toLowerCase()
  const queryLower = query.toLowerCase().trim()

  // 1. Exact match on name
  if (nameLower === queryLower) return 1000
  // 2. Name starts with query (e.g. "Sales Performance" for "sales")
  if (nameLower.startsWith(queryLower)) return 800
  // 3. Name contains query as a whole word
  const words = nameLower.split(/[\s\-_]+/)
  if (words.some((w) => w === queryLower)) return 600
  // 4. Name contains query substring
  if (nameLower.includes(queryLower)) return 400
  // 5. Initials match
  if (section.initials && section.initials.toLowerCase() === queryLower) return 350
  // 6. Department exact match
  if (section.department.toLowerCase() === queryLower) return 200
  // 7. Brand match
  if (section.brand.toLowerCase() === queryLower) return 150
  // 8. Description match (lowest priority)
  if (section.description.toLowerCase().includes(queryLower)) return 50

  return 0
}

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
        } else if (activeFilter === 'common') {
          matchesFilter = section.brand === 'common' || section.category === 'common_dashboards' || section.category === 'general_modules'
        } else if (['kia', 'hyundai', 'platinum'].includes(activeFilter)) {
          matchesFilter = section.brand === activeFilter
        }
      }

      return matchesSearch && matchesFilter
    })
  }, [authorizedSections, search, activeFilter])

  const orderedCategorizedGroups = useMemo(() => {
    const categories: SectionCategory[] = ['common_dashboards', 'kia', 'hyundai', 'platinum']
    const query = search.toLowerCase().trim()
    const result: { category: SectionCategory; maxScore: number; sections: SearchSection[] }[] = []

    categories.forEach((catId) => {
      const list = filteredSections.filter((section) => {
        if (catId === 'common_dashboards') {
          return section.brand === 'common' || section.category === 'common_dashboards' || section.category === 'general_modules'
        }
        return section.brand === catId
      })

      if (list.length > 0) {
        if (query) {
          list.sort((a, b) => {
            const scoreA = getRelevanceScore(a, query)
            const scoreB = getRelevanceScore(b, query)
            if (scoreA !== scoreB) return scoreB - scoreA
            return a.name.localeCompare(b.name)
          })
        } else {
          list.sort((a, b) => a.name.localeCompare(b.name))
        }

        const maxScore = query ? getRelevanceScore(list[0], query) : 0
        result.push({ category: catId, maxScore, sections: list })
      }
    })

    if (query) {
      result.sort((a, b) => b.maxScore - a.maxScore)
    }

    return result
  }, [filteredSections, search])

  const flatOrderedSections = useMemo(() => {
    return orderedCategorizedGroups.flatMap((group) => group.sections)
  }, [orderedCategorizedGroups])

  const favouriteSections = useMemo(() => {
    return authorizedSections.filter((sec) => favouriteHrefs.includes(sec.href))
  }, [authorizedSections, favouriteHrefs])

  useEffect(() => {
    if (open) {
      setSelectedIndex(0)
      setNavigatingSection(null)
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [search, activeFilter])

  useEffect(() => {
    const getColumnsCount = () => {
      if (typeof window === 'undefined') return 1
      const width = window.innerWidth
      if (width >= 1280) return 4
      if (width >= 768) return 3
      if (width >= 640) return 2
      return 1
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open || navigatingSection) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
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
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, flatOrderedSections, selectedIndex, activeFilter, navigatingSection, onOpenChange])

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
      <DialogContent className="max-w-[96vw] 2xl:max-w-[1520px] w-full h-[88vh] max-h-[880px] flex flex-col overflow-hidden p-0 border border-slate-300 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950 rounded-[32px] [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Search Sections</DialogTitle>

        {/* ── Top Header & Command Search Bar ── */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 dark:bg-slate-900 dark:border-white/10 shrink-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-3 bg-slate-100 rounded-2xl px-4 py-3 border border-slate-200 dark:bg-slate-800 dark:border-white/10 shadow-inner">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#004e5a] text-white shadow-sm shrink-0">
                <Search className="h-4.5 w-4.5" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dashboard sections by name, department, or brand..."
                className="w-full bg-transparent text-sm sm:text-base font-extrabold text-slate-900 placeholder-slate-400 focus:outline-none dark:text-white dark:placeholder-slate-500"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-slate-100 border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 shadow-2xs dark:bg-slate-800 dark:border-white/10 dark:text-slate-400">
                <Command className="w-3.5 h-3.5" /> K
              </span>
              <button
                onClick={() => onOpenChange(false)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800 shadow-2xs dark:border-white/10 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ── Filter Pills Row (Larger Button Size) ── */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400 mr-1 dark:text-slate-500">
              Filter:
            </span>
            {FILTER_PILLS.map((pill) => {
              const isActive = activeFilter === pill.id
              const count = pill.id === 'all' 
                ? authorizedSections.length 
                : authorizedSections.filter(s => {
                    if (['sales','service','finance','admin'].includes(pill.id)) return s.department === pill.id
                    if (pill.id === 'common') return s.brand === 'common' || s.category === 'common_dashboards' || s.category === 'general_modules'
                    return s.brand === pill.id
                  }).length

              return (
                <button
                  key={pill.id}
                  onClick={() => setActiveFilter(pill.id)}
                  className={cn(
                    'rounded-2xl px-4 py-2 text-xs sm:text-sm font-black transition-all border-2 flex items-center gap-2 cursor-pointer shadow-xs',
                    isActive
                      ? 'bg-[#004e5a] border-[#004e5a] text-white shadow-md shadow-[#004e5a]/20 dark:bg-teal-600 dark:border-teal-600'
                      : 'bg-slate-100/90 border-slate-200 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                  )}
                >
                  {pill.logo && <span className="shrink-0">{pill.logo}</span>}
                  <span>{pill.label}</span>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-black',
                    isActive ? 'bg-[#003c46] text-teal-100' : 'bg-slate-200/90 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  )}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Main Scrollable Body (Opaque Solid Light Background) ── */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100/60 dark:bg-slate-950 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800"
        >
          {/* Quick Access Bookmarks Row (if favourites exist & no search query) */}
          {!search && favouriteSections.length > 0 && activeFilter === 'all' && (
            <div className="bg-amber-50/90 rounded-3xl border border-amber-200 p-5 shadow-2xs space-y-3 dark:bg-amber-950/30 dark:border-amber-900/40">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                  Bookmarked Dashboards ({favouriteSections.length})
                </h3>
              </div>

              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {favouriteSections.map((section) => (
                  <div
                    key={`fav-${section.id}`}
                    onClick={() => handleNavigate(section)}
                    className="group relative flex cursor-pointer items-center justify-between rounded-2xl border border-amber-200 bg-white p-3.5 shadow-2xs hover:shadow-md hover:border-amber-300 transition-all dark:bg-slate-900 dark:border-amber-900/40"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl font-black text-xs shrink-0 shadow-xs text-white", getThemeAvatarClass(section))}>
                        {section.initials || section.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black text-slate-900 truncate group-hover:text-amber-700 dark:text-white transition-colors">
                          {section.name}
                        </h4>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                          {section.brand}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => toggleFavourite(e, section.href)}
                      className="p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-950/60 text-amber-400 shrink-0 cursor-pointer"
                    >
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty Search State */}
          {flatOrderedSections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-3xl border border-slate-200">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 shadow-sm dark:border-white/10 dark:bg-slate-900">
                <Search className="h-6 w-6 text-slate-400 dark:text-slate-600" />
              </div>
              <p className="mt-4 text-base font-black text-slate-900 dark:text-white">No dashboard sections match your search</p>
              <p className="mt-1 text-xs text-slate-400 font-semibold max-w-sm">
                Try searching for a different keyword, reset your filter pill selection, or check access permissions.
              </p>
            </div>
          ) : (
            /* Categorized Dashboard Cards Grid */
            orderedCategorizedGroups.map((group) => {
              const catMeta = CATEGORY_CONFIG[group.category] || CATEGORY_CONFIG.common_dashboards
              const sections = group.sections

              return (
                <div
                  key={group.category}
                  className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs space-y-4 dark:bg-slate-900 dark:border-white/10"
                >
                  {/* Category Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3.5 dark:border-white/5">
                    <div className="flex items-center gap-3">
                      {catMeta.logoUrl ? (
                        <div className="flex h-9 px-2.5 items-center justify-center rounded-xl bg-white border border-slate-200 shadow-2xs shrink-0">
                          <img src={catMeta.logoUrl} alt={catMeta.title} className="h-4.5 w-auto object-contain" />
                        </div>
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#004e5a] text-white font-black text-xs shadow-xs">
                          <Layers className="w-4 h-4" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                            {catMeta.title}
                          </h3>
                          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-black border", catMeta.badgeBg, catMeta.badgeText)}>
                            {sections.length}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-400 mt-0.5">
                          {catMeta.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Section Cards Grid */}
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                            'group relative flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 transition-all duration-200 shadow-2xs hover:shadow-md',
                            isSelected
                              ? 'border-[#004e5a] bg-teal-50/80 ring-2 ring-[#004e5a]/20 dark:border-teal-500 dark:bg-teal-950/40'
                              : 'border-slate-200/90 bg-white hover:border-slate-300 dark:border-white/5 dark:bg-slate-900/70 dark:hover:border-white/10'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-2">
                            {/* Initials Avatar Badge with Strict Theme Color Background */}
                            <div
                              className={cn(
                                'flex h-10 w-10 items-center justify-center rounded-xl font-black text-xs shrink-0 select-none transition-transform group-hover:scale-105 text-white',
                                isSelected ? 'bg-[#003c46] border border-teal-300' : getThemeAvatarClass(section)
                              )}
                            >
                              {initials}
                            </div>

                            {/* Section Details */}
                            <div className="min-w-0 space-y-1">
                              <h4 className="text-xs font-black text-slate-900 dark:text-white truncate group-hover:text-[#004e5a] dark:group-hover:text-teal-400 transition-colors">
                                {section.name}
                              </h4>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:border-white/10">
                                  {section.brand.toUpperCase()}
                                </span>
                                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200/80 dark:bg-slate-800 dark:text-slate-400">
                                  {section.department}
                                </span>
                                {section.badge && (
                                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400">
                                    {section.badge}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action Star & Enter Key Indicator */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={(e) => toggleFavourite(e, section.href)}
                              title={isFav ? 'Remove bookmark' : 'Add to bookmarks'}
                              className={cn(
                                "p-1.5 rounded-lg transition-colors cursor-pointer",
                                isSelected ? "hover:bg-white/20" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                              )}
                            >
                              <Star
                                className={cn(
                                  'w-3.5 h-3.5 transition-all',
                                  isFav
                                    ? 'fill-amber-400 text-amber-400'
                                    : isSelected ? 'text-white/60 hover:text-amber-300' : 'text-slate-300 hover:text-amber-400 dark:text-slate-600 dark:hover:text-amber-400'
                                )}
                              />
                            </button>

                            <ArrowRight className={cn(
                              "w-4 h-4 transition-all duration-200",
                              isSelected 
                                ? "text-white translate-x-0 opacity-100" 
                                : "text-slate-300 -translate-x-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 dark:text-slate-600"
                            )} />
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

        {/* ── Footer Keyboard Shortcuts & Status ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-200/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-6 py-3.5 text-[11px] font-extrabold text-slate-500 dark:text-slate-400 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-700 shadow-2xs dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">↑ ↓ ← →</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-700 shadow-2xs dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">Enter</kbd>
              open dashboard
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-700 shadow-2xs dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">Tab</kbd>
              cycle filter
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-700 shadow-2xs dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">Esc</kbd>
              close
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-black">
            <Shield className="w-3.5 h-3.5" />
            <span>Strict Gating & Role Permissions Active</span>
          </div>
        </div>

        {/* ── Navigation Loader Overlay ── */}
        {navigatingSection && (
          <div className="absolute top-0 left-0 right-0 z-50 overflow-hidden rounded-t-[32px] bg-slate-900/95 backdrop-blur-md p-4 border-b border-teal-500/40 flex items-center justify-between animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400 border border-teal-500/30 shadow-xs">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-white flex items-center gap-1.5">
                  Opening {navigatingSection.name}...
                </span>
                <span className="text-[10px] font-bold text-teal-300 font-mono">
                  {navigatingSection.href}
                </span>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-teal-500 via-emerald-400 to-cyan-500 animate-pulse" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
