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
  CornerDownLeft,
  Loader2,
  Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/lib/hooks/use-user-preferences'


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

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | DepartmentType>('all')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [navigatingSection, setNavigatingSection] = useState<SearchSection | null>(null)
  
  const searchInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    value: favouriteHrefsValue,
    savePreference: saveFavouriteHrefs,
  } = useUserPreferences<string[]>('sidebar_favourites', [])
  const favouriteHrefs = Array.isArray(favouriteHrefsValue) ? favouriteHrefsValue : []

  const isEligibleFavouriteHref = (href: string) => {
    return href.startsWith('/brands/')
  }

  const toggleFavourite = async (e: React.MouseEvent, href: string) => {
    e.stopPropagation()
    if (!isEligibleFavouriteHref(href)) return
    const next = favouriteHrefs.includes(href)
      ? favouriteHrefs.filter((item) => item !== href)
      : [...favouriteHrefs.filter((item) => item !== href), href]
    await saveFavouriteHrefs(next)
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

  // Reset selected item index on tab/search change
  useEffect(() => {
    setSelectedIndex(0)
  }, [search, activeTab])

  // Reset state when modal is closed/opened
  useEffect(() => {
    if (open) {
      setSearch('')
      setActiveTab('all')
      setSelectedIndex(0)
      setNavigatingSection(null)
      setTimeout(() => searchInputRef.current?.focus(), 150)
    }
  }, [open])

  // Keyboard navigation logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open || navigatingSection) return // Block input when loading/navigating

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredSections.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredSections.length) % Math.max(1, filteredSections.length))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredSections[selectedIndex]) {
          handleNavigate(filteredSections[selectedIndex])
        }
      } else if (e.key === 'Tab') {
        // Tab key cycles through department filter tabs instead of jumping focuses
        e.preventDefault()
        const tabs: ('all' | DepartmentType)[] = ['all', 'sales', 'service', 'finance', 'admin']
        const nextIdx = (tabs.indexOf(activeTab) + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length
        setActiveTab(tabs[nextIdx])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredSections, selectedIndex, activeTab, navigatingSection])

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
    router.push(section.href)
  }

  // Visual helper mapping department to visual theme classes
  const getDeptStyles = (dept: DepartmentType) => {
    switch (dept) {
      case 'sales':
        return {
          gradient: 'from-rose-500 to-orange-500 dark:from-rose-600 dark:to-orange-600',
          bgSoft: 'bg-rose-50/70 border-rose-100/80 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400',
          badge: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
        }
      case 'service':
        return {
          gradient: 'from-amber-500 to-yellow-500 dark:from-amber-600 dark:to-yellow-600',
          bgSoft: 'bg-amber-50/70 border-amber-100/80 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400',
          badge: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        }
      case 'finance':
        return {
          gradient: 'from-teal-700 to-emerald-600 dark:from-teal-800 dark:to-emerald-700',
          bgSoft: 'bg-emerald-50/70 border-emerald-100/80 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-400',
          badge: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        }
      case 'admin':
        return {
          gradient: 'from-indigo-500 to-violet-500 dark:from-indigo-600 dark:to-violet-600',
          bgSoft: 'bg-indigo-50/70 border-indigo-100/80 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900/30 dark:text-indigo-400',
          badge: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
        }
    }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[94vw] w-[94vw] h-[80vh] max-h-[80vh] flex flex-col overflow-hidden p-0 border border-slate-100 bg-slate-50/90 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90 rounded-[28px]">
        <DialogTitle className="sr-only">Search Sections</DialogTitle>

        {/* Search header area */}
        <div className="relative flex items-center border-b border-slate-200/60 px-6 py-4 dark:border-white/10 shrink-0">
          <Search className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to search dashboard sections..."
            className="w-full bg-transparent pl-3 pr-20 text-base font-semibold text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder-slate-500"
          />
          <div className="absolute right-6 flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-2 py-1 text-[10px] font-black text-slate-400 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <span>ESC</span>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 border-b border-slate-200/50 bg-slate-100/50 px-6 py-2.5 dark:border-white/5 dark:bg-slate-900/30 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-3">Filter:</span>
          {(['all', 'sales', 'service', 'finance', 'admin'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'rounded-xl px-3 py-1 text-xs font-black capitalize transition-all',
                activeTab === tab
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Sections Grid View */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800"
        >
          {filteredSections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
                <Search className="h-5 w-5 text-slate-300 dark:text-slate-700" />
              </div>
              <p className="mt-4 text-sm font-bold text-slate-800 dark:text-slate-200">No dashboard sections match your query</p>
              <p className="mt-1 text-xs text-slate-400 font-medium">Verify your spelling, filter selection, or permissions.</p>
            </div>
          ) : (
            <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredSections.map((section, idx) => {
                const isSelected = idx === selectedIndex
                const deptStyle = getDeptStyles(section.department)
                
                const isFav = favouriteHrefs.includes(section.href)
                return (
                  <div
                    key={section.id}
                    data-active={isSelected}
                    onClick={() => handleNavigate(section)}
                    className={cn(
                      'group relative flex cursor-pointer items-center gap-2.5 rounded-2xl border p-3 transition-all duration-200 shadow-sm hover:shadow-md',
                      isSelected
                        ? 'border-indigo-600 bg-white ring-2 ring-indigo-600/10 dark:border-indigo-500 dark:bg-slate-900 dark:ring-indigo-500/10'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 dark:border-white/5 dark:bg-slate-900/60 dark:hover:border-white/10'
                    )}
                  >
                    {/* Glowing background hint on select */}
                    {isSelected && (
                      <div className="absolute inset-0 -z-10 rounded-2xl bg-indigo-50/10 opacity-70 blur-xl dark:bg-indigo-900/5" />
                    )}

                    {/* Subtle Tinted Icon Wrapper */}
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-transform group-hover:scale-105',
                      deptStyle.bgSoft
                    )}>
                      <SectionIcon name={section.iconName} className="h-4 w-4" />
                    </div>

                    {/* Text Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1">
                        <span className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                          {section.name}
                        </span>
                        
                        {/* Brand badge */}
                        <span className={cn(
                          'rounded px-1 py-0.25 text-[9px] font-black uppercase tracking-wider border',
                          getBrandBadge(section.brand)
                        )}>
                          {section.brand}
                        </span>

                        {/* Custom label/badge if any */}
                        {section.badge && (
                          <span className="rounded px-1 py-0.25 text-[9px] font-black uppercase tracking-wider border border-amber-200 bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/40">
                            {section.badge}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Hint / Star */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      {isEligibleFavouriteHref(section.href) && (
                        <button
                          onClick={(e) => toggleFavourite(e, section.href)}
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all hover:bg-slate-100 dark:hover:bg-slate-800',
                            isFav ? 'text-amber-500' : 'text-slate-350 hover:text-amber-500'
                          )}
                          title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                        >
                          <Star className={cn('h-3.5 w-3.5', isFav && 'fill-current')} />
                        </button>
                      )}

                      {/* Action Hint */}
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
          )}
        </div>

        {/* Modal Footer helper info */}
        <div className="flex items-center justify-between border-t border-slate-200/50 bg-slate-100/50 px-6 py-3.5 dark:border-white/5 dark:bg-slate-900/30 text-[10px] font-bold text-slate-400 shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm dark:border-white/10 dark:bg-slate-850">↑↓</span>
              to navigate
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm dark:border-white/10 dark:bg-slate-850">Enter</span>
              to select
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm dark:border-white/10 dark:bg-slate-850">Tab</span>
              to cycle filters
            </span>
          </div>
          <div>
            <span>Strict Gating Active</span>
          </div>
        </div>

        {/* Loading overlay when a section is clicked/loading */}
        {navigatingSection && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200">
            <div className="flex flex-col items-center gap-4 p-8 rounded-[24px] bg-slate-900/80 border border-white/10 shadow-2xl text-center max-w-xs animate-in zoom-in-95 duration-200">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
              <div className="space-y-1">
                <p className="text-sm font-black text-white">Opening Section...</p>
                <p className="text-xs font-semibold text-slate-400 truncate max-w-[200px]">
                  {navigatingSection.name}
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
