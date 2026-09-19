'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Image as ImageIcon,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  Droplets,
  User,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ExternalLink,
  Copy,
  Check,
  Briefcase,
  Wrench,
  Tv,
  Car,
  Eye,
  EyeOff,
  Trash2,
  Presentation,
  Armchair,
} from 'lucide-react'
import {
  SHOWROOM_BRANDS,
  SHOWROOM_DEPARTMENTS,
  SHOWROOM_CATEGORIES,
  type ShowroomBrandKey,
  type ShowroomDepartmentKey,
  type ShowroomCategoryKey,
  getLocationsForBrand,
  getShowroomBrandConfig,
  getShowroomDepartmentConfig,
  getShowroomCategoryConfig,
} from '@/lib/showroom-images/constants'
import type { ShowroomUploadSession, ShowroomImageRecord } from '@/lib/showroom-images/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { BrandLogoLockup, AmGlyph } from '@/components/brand-logo-lockup'
import QRCode from 'qrcode'

function formatISTDate(d: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(d)
}


export function ShowroomGalleryClient({
  initialUserBrand,
}: {
  initialUserBrand?: string | null
}) {
  const [selectedBrand, setSelectedBrand] = useState<string>(() => {
    return initialUserBrand && initialUserBrand !== 'all' ? initialUserBrand.toLowerCase() : 'all'
  })
  const [selectedLocation, setSelectedLocation] = useState<string>('all')
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  // Requirement: All Brands defaults to 'today' (current date), specific brand defaults to 'last10days'
  const [dateFilter, setDateFilter] = useState<string>(() => {
    return initialUserBrand && initialUserBrand !== 'all' ? 'last10days' : 'today'
  })
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')

  // Washroom Privacy Blur: set of revealed image IDs
  const [revealedWashrooms, setRevealedWashrooms] = useState<Set<string>>(new Set())

  // QR Modal with Brand/Location/Dept selectors
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrBrand, setQrBrand] = useState<ShowroomBrandKey>('kia')
  const qrLocations = useMemo(() => getLocationsForBrand(qrBrand), [qrBrand])
  const [qrLocation, setQrLocation] = useState<string>('Jammu')
  const [qrDept, setQrDept] = useState<ShowroomDepartmentKey>('sales')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copiedLink, setCopiedLink] = useState(false)

  // Sync qrLocation when qrBrand changes
  const handleQrBrandChange = (newBrand: ShowroomBrandKey) => {
    setQrBrand(newBrand)
    const locs = getLocationsForBrand(newBrand)
    setQrLocation(locs[0] || 'Jammu')
  }

  // Lightbox State
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [activeSessionImages, setActiveSessionImages] = useState<ShowroomImageRecord[]>([])
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [rotation, setRotation] = useState(0)

  // Dynamic locations for selected brand
  const availableLocations = useMemo(() => {
    if (selectedBrand === 'all') return []
    return getLocationsForBrand(selectedBrand as ShowroomBrandKey)
  }, [selectedBrand])

  // Reset location & apply appropriate date default on brand switch
  const handleBrandChange = (brandKey: string) => {
    setSelectedBrand(brandKey)
    setSelectedLocation('all')
    if (brandKey === 'all') {
      setDateFilter('today')
    } else {
      setDateFilter('last10days')
    }
  }

  // Calculate IST Date bounds
  const { startDate, endDate } = useMemo(() => {
    const now = new Date()
    if (dateFilter === 'today') {
      const todayStr = formatISTDate(now)
      return { startDate: todayStr, endDate: todayStr }
    }
    if (dateFilter === 'yesterday') {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const yStr = formatISTDate(yesterday)
      return { startDate: yStr, endDate: yStr }
    }
    if (dateFilter === 'last7days') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { startDate: formatISTDate(start), endDate: formatISTDate(now) }
    }
    if (dateFilter === 'last10days') {
      const start = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
      return { startDate: formatISTDate(start), endDate: formatISTDate(now) }
    }
    if (dateFilter === 'last30days') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { startDate: formatISTDate(start), endDate: formatISTDate(now) }
    }
    if (dateFilter === 'custom') {
      return { startDate: customStartDate || undefined, endDate: customEndDate || undefined }
    }
    return { startDate: undefined, endDate: undefined }
  }, [dateFilter, customStartDate, customEndDate])

  // Fetch gallery sessions
  const {
    data,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [
      'showroom-images',
      selectedBrand,
      selectedLocation,
      selectedDepartment,
      selectedCategory,
      startDate,
      endDate,
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedBrand !== 'all') params.set('brand', selectedBrand)
      if (selectedLocation !== 'all') params.set('location', selectedLocation)
      if (selectedDepartment !== 'all') params.set('department', selectedDepartment)
      if (selectedCategory !== 'all') params.set('category', selectedCategory)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/showroom-images?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load showroom images.')
      return (await res.json()) as { sessions: ShowroomUploadSession[]; totalImages: number }
    },
  })

  const sessions = data?.sessions || []
  const totalImages = data?.totalImages || 0

  // Open Lightbox
  const openLightbox = (sessionImages: ShowroomImageRecord[], index: number) => {
    setActiveSessionImages(sessionImages)
    setActiveImageIndex(index)
    setZoomLevel(1)
    setRotation(0)
    setLightboxOpen(true)
  }

  const activeImage = activeSessionImages[activeImageIndex] || null

  // Delete individual session
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm('Are you sure you want to delete this upload entry?')) {
      return
    }
    try {
      setDeletingSessionId(sessionId)
      const res = await fetch(`/api/showroom-images?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to delete entry')
      }
      toast({
        title: 'Entry Deleted',
        description: 'The showroom upload session has been removed.',
      })
      refetch()
    } catch (err: any) {
      toast({
        title: 'Delete Failed',
        description: err.message || 'Could not delete entry.',
        variant: 'error',
      })
    } finally {
      setDeletingSessionId(null)
    }
  }

  // Lightbox keyboard navigation
  useEffect(() => {
    if (!lightboxOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setActiveImageIndex((prev) => (prev < activeSessionImages.length - 1 ? prev + 1 : 0))
        setZoomLevel(1)
        setRotation(0)
      } else if (e.key === 'ArrowLeft') {
        setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : activeSessionImages.length - 1))
        setZoomLevel(1)
        setRotation(0)
      } else if (e.key === 'r' || e.key === 'R') {
        setRotation((r) => (r + 90) % 360)
      } else if (e.key === 'l' || e.key === 'L') {
        setRotation((r) => (r - 90 + 360) % 360)
      } else if (e.key === '0') {
        setRotation(0)
        setZoomLevel(1)
      } else if (e.key === 'Escape') {
        setLightboxOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxOpen, activeSessionImages.length])

  // Direct public branch upload link with all 3 parameters encoded
  const qrGeneratedUploadUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/showroom-upload'
    const url = new URL('/showroom-upload', window.location.origin)
    url.searchParams.set('brand', qrBrand)
    url.searchParams.set('location', qrLocation)
    url.searchParams.set('dept', qrDept)
    return url.toString()
  }, [qrBrand, qrLocation, qrDept])

  useEffect(() => {
    if (qrGeneratedUploadUrl) {
      QRCode.toDataURL(qrGeneratedUploadUrl, { width: 240, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''))
    }
  }, [qrGeneratedUploadUrl])

  const copyUploadLink = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(qrGeneratedUploadUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
      toast({
        title: 'Branch Link Copied',
        description: `Direct upload link for ${getShowroomBrandConfig(qrBrand)?.label} (${qrLocation} · ${qrDept.toUpperCase()}) copied!`,
      })
    }
  }

  const toggleWashroomBlur = (imageId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setRevealedWashrooms((prev) => {
      const next = new Set(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.add(imageId)
      return next
    })
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#055B65]" />
              Showroom Images Feed
            </h1>
            <span className="bg-teal-50 text-[#055B65] text-xs font-semibold px-2.5 py-0.5 rounded-full border border-teal-200">
              Live Feed
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time cleanliness & display inspection of vehicles, TV display, and washrooms across all AM Group dealerships.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="text-xs h-9 rounded-xl border-slate-200 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            onClick={() => setQrModalOpen(true)}
            className="text-xs h-9 rounded-xl bg-[#055B65] hover:bg-[#044850] text-white font-semibold shadow-xs cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5 mr-1.5" />
            Branch QR & Upload Links
          </Button>
        </div>
      </div>

      {/* Brand Selector Tabs with Official AM Monogram + Divider + Brand Logo Lockup */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        <button
          type="button"
          onClick={() => handleBrandChange('all')}
          className={cn(
            'px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center select-none shadow-2xs',
            selectedBrand === 'all'
              ? 'bg-[#055B65] text-white'
              : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 hover:border-slate-300'
          )}
        >
          <AmGlyph
            color={selectedBrand === 'all' ? '#FFFFFF' : '#0F172A'}
            size="xs"
          />
          <div
            className={cn(
              'mx-1.5 sm:mx-2 w-px self-stretch min-h-[11px] sm:min-h-[13px]',
              selectedBrand === 'all' ? 'bg-white/30' : 'bg-slate-300'
            )}
          />
          <span className="font-bold uppercase tracking-wider text-[9.5px] sm:text-[10.5px] whitespace-nowrap">
            ALL BRANDS ({totalImages})
          </span>
        </button>

        {SHOWROOM_BRANDS.map((b) => {
          const isActive = selectedBrand === b.key
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => handleBrandChange(b.key)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg transition-all shrink-0 flex items-center cursor-pointer select-none shadow-2xs',
                isActive
                  ? 'bg-[#055B65] text-white'
                  : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 hover:border-slate-300'
              )}
            >
              <BrandLogoLockup
                brand={b.key}
                variant={isActive ? 'light' : 'inline'}
                size="xs"
                className="p-0 border-0 shadow-none bg-transparent"
              />
            </button>
          )
        })}
      </div>

      {/* Filters Bar: Department, Category, Location & Date Range */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Department Filter Toggle */}
          <div className="flex items-center bg-slate-100/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setSelectedDepartment('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedDepartment === 'all'
                  ? 'bg-white text-[#055B65] shadow-2xs border border-slate-200/70'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Depts
            </button>
            <button
              type="button"
              onClick={() => setSelectedDepartment('sales')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                selectedDepartment === 'sales'
                  ? 'bg-white text-[#055B65] shadow-2xs border border-slate-200/70'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Briefcase className="w-3 h-3" /> Sales
            </button>
            <button
              type="button"
              onClick={() => setSelectedDepartment('service')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                selectedDepartment === 'service'
                  ? 'bg-white text-[#055B65] shadow-2xs border border-slate-200/70'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wrench className="w-3 h-3" /> Service
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold text-slate-500 shrink-0 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" /> Category:
            </Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-9 w-40 text-xs font-semibold bg-slate-50 border-slate-200 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-medium">All Categories</SelectItem>
                <SelectItem value="vehicles" className="text-xs font-medium">Vehicles / Workshop Bays</SelectItem>
                <SelectItem value="tv" className="text-xs font-medium">TV Display (Lounge)</SelectItem>
                <SelectItem value="standee" className="text-xs font-medium">Standee (Sales)</SelectItem>
                <SelectItem value="lounge" className="text-xs font-medium">Customer Lounge (Service)</SelectItem>
                <SelectItem value="bathroom" className="text-xs font-medium">Washrooms</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Location Filter */}
          {selectedBrand !== 'all' && availableLocations.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold text-slate-500 shrink-0 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" /> Location:
              </Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="h-9 w-40 text-xs font-semibold bg-slate-50 border-slate-200 rounded-lg">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs font-medium">
                    All Locations
                  </SelectItem>
                  {availableLocations.map((loc) => (
                    <SelectItem key={loc} value={loc} className="text-xs font-medium">
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date Filter */}
          <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold text-slate-500 shrink-0 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date:
            </Label>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="h-9 w-40 text-xs font-semibold bg-slate-50 border-slate-200 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today" className="text-xs font-medium">Today (Current Date)</SelectItem>
                <SelectItem value="last10days" className="text-xs font-medium">Last 10 Days</SelectItem>
                <SelectItem value="last7days" className="text-xs font-medium">Last 7 Days</SelectItem>
                <SelectItem value="yesterday" className="text-xs font-medium">Yesterday</SelectItem>
                <SelectItem value="last30days" className="text-xs font-medium">Last 30 Days</SelectItem>
                <SelectItem value="all" className="text-xs font-medium">All Time</SelectItem>
                <SelectItem value="custom" className="text-xs font-medium">Custom Date Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Date Pickers */}
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="h-9 text-xs bg-slate-50 w-36 rounded-lg font-medium"
              />
              <span className="text-xs text-slate-400">to</span>
              <Input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="h-9 text-xs bg-slate-50 w-36 rounded-lg font-medium"
              />
            </div>
          )}
        </div>

        {/* Count Summary */}
        <div className="text-xs text-slate-500 font-medium">
          Showing <strong>{sessions.length}</strong> {sessions.length === 1 ? 'session' : 'sessions'} (<strong>{totalImages}</strong> photos)
        </div>
      </div>

      {/* Gallery Feed Loading */}
      {isLoading && (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#055B65]" />
          <p className="text-xs font-medium text-slate-600">Loading showroom photo sessions…</p>
        </div>
      )}

      {/* Gallery Feed Empty State */}
      {!isLoading && sessions.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center space-y-4 shadow-2xs">
          <div className="w-14 h-14 bg-teal-50 text-[#055B65] rounded-2xl flex items-center justify-center mx-auto border border-teal-200">
            <ImageIcon className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900">No Showroom Photos Found</h3>
            <p className="text-xs text-slate-500">
              No photos recorded matching the selected filters. Switch date range or brand to view past sessions.
            </p>
          </div>
          <Button
            onClick={() => setQrModalOpen(true)}
            className="text-xs h-10 rounded-xl bg-[#055B65] hover:bg-[#044850] text-white font-semibold cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 mr-1.5" />
            Generate Branch Upload QR Code
          </Button>
        </div>
      )}

      {/* Session Cards Feed */}
      {!isLoading && sessions.length > 0 && (
        <div className="space-y-6">
          {sessions.map((session) => {
            const brandCfg = getShowroomBrandConfig(session.brand)
            const isService = session.department === 'service'
            const dateStr = new Date(session.capturedAt).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })

            return (
              <div
                key={session.sessionId}
                className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs hover:shadow-sm transition-all space-y-4 p-5"
              >
                {/* Session Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Brand Lockup Pill */}
                    <div className="rounded-lg bg-slate-50 border border-slate-200/90 px-2.5 py-1 flex items-center shadow-2xs">
                      <BrandLogoLockup
                        brand={session.brand}
                        variant="inline"
                        size="sm"
                        className="p-0 border-0 shadow-none bg-transparent"
                      />
                    </div>

                    {/* Department Badge */}
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-slate-100 text-slate-800 border-slate-200 flex items-center gap-1.5">
                      {isService ? <Wrench className="w-3 h-3 text-slate-700" /> : <Briefcase className="w-3 h-3 text-slate-700" />}
                      {isService ? 'Service' : 'Sales'}
                    </span>

                    {/* Location Badge */}
                    <span className="flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      {session.location}
                    </span>

                    {/* Uploader Name */}
                    {session.uploaderName && (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <User className="w-3 h-3" /> By: <strong>{session.uploaderName}</strong>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className="text-xs text-slate-400 font-medium">
                      {dateStr} IST
                    </span>
                    <span className="bg-[#055B65] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                      {session.totalImages} {session.totalImages === 1 ? 'photo' : 'photos'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(session.sessionId)}
                      disabled={deletingSessionId === session.sessionId}
                      title="Delete this upload entry"
                      className="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-all cursor-pointer"
                    >
                      {deletingSessionId === session.sessionId ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Categorized Photo Sections: 3 Vehicles/Workshop Bays (col-span-6), 1 TV (col-span-2), 1 Standee or Lounge (col-span-2), 1 Washroom (col-span-2) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 pt-1 items-stretch">
                  {/* Category 1: Vehicles / Workshop Bays (3 Slots = col-span-6) */}
                  <div className="md:col-span-6 bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        {isService ? <Wrench className="w-4 h-4 text-[#055B65]" /> : <Car className="w-4 h-4 text-[#055B65]" />}
                        {isService ? 'Workshop Bays' : 'Vehicles'} ({session.byCategory?.vehicles?.length || 0}/3)
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        {isService ? 'Service Bays' : 'Floor Cars'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {session.byCategory?.vehicles?.length ? (
                        session.byCategory.vehicles.map((img, idx) => (
                          <div
                            key={img.id}
                            onClick={() => {
                              const globalIdx = session.images.findIndex((i) => i.id === img.id)
                              openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                            }}
                            className="group relative aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs hover:border-teal-500 hover:scale-[1.02] transition-all"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={isService ? `Service bay photo ${idx + 1}` : `Vehicle photo ${idx + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                            
                            <div className="absolute top-1 left-1 z-10 bg-black/80 text-white font-semibold text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-white/20">
                              <span>#{img.categorySlot || idx + 1}</span>
                            </div>

                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ZoomIn className="w-4 h-4 text-white" />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-3 h-24 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                          {isService ? <Wrench className="w-4 h-4 mb-1 text-slate-300" /> : <Car className="w-4 h-4 mb-1 text-slate-300" />}
                          {isService ? 'No workshop bay photos' : 'No vehicle photos'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Category 2: TV Display (1 Slot = col-span-2) */}
                  <div className="md:col-span-2 bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 truncate">
                        <Tv className="w-4 h-4 text-[#055B65] shrink-0" />
                        <span className="truncate">TV ({session.byCategory?.tv?.length || 0}/1)</span>
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Lounge</span>
                    </div>

                    <div className="w-full">
                      {session.byCategory?.tv?.length ? (
                        session.byCategory.tv.slice(0, 1).map((img, idx) => (
                          <div
                            key={img.id}
                            onClick={() => {
                              const globalIdx = session.images.findIndex((i) => i.id === img.id)
                              openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                            }}
                            className="group relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs hover:border-teal-500 hover:scale-[1.02] transition-all"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={`TV photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            
                            <div className="absolute top-1.5 left-1.5 z-10 bg-black/80 text-white font-semibold text-[10px] px-2 py-0.5 rounded flex items-center gap-1 border border-white/20">
                              <Tv className="w-3 h-3 text-teal-300" />
                              <span>TV</span>
                            </div>

                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ZoomIn className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="w-full h-24 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                          <Tv className="w-4 h-4 mb-1 text-slate-300" />
                          No TV
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Category 3: Standee (Sales only) */}
                  {!isService && (
                    <div className="md:col-span-2 bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5 flex flex-col justify-between">
                      <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                        <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 truncate">
                          <Presentation className="w-4 h-4 text-[#055B65] shrink-0" />
                          <span className="truncate">Standee ({session.byCategory?.standee?.length || 0}/1)</span>
                        </h4>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Promo</span>
                      </div>

                      <div className="w-full">
                        {session.byCategory?.standee?.length ? (
                          session.byCategory.standee.slice(0, 1).map((img, idx) => (
                            <div
                              key={img.id}
                              onClick={() => {
                                const globalIdx = session.images.findIndex((i) => i.id === img.id)
                                openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                              }}
                              className="group relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs hover:border-teal-500 hover:scale-[1.02] transition-all"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt={`Standee photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                              
                              <div className="absolute top-1.5 left-1.5 z-10 bg-black/80 text-white font-semibold text-[10px] px-2 py-0.5 rounded flex items-center gap-1 border border-white/20">
                                <Presentation className="w-3 h-3 text-purple-300" />
                                <span>Standee</span>
                              </div>

                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <ZoomIn className="w-5 h-5 text-white" />
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="w-full h-24 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                            <Presentation className="w-4 h-4 mb-1 text-slate-300" />
                            No Standee
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Category 3: Customer Lounge (Service only) */}
                  {isService && (
                    <div className="md:col-span-2 bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5 flex flex-col justify-between">
                      <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                        <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 truncate">
                          <Armchair className="w-4 h-4 text-[#055B65] shrink-0" />
                          <span className="truncate">Lounge ({session.byCategory?.lounge?.length || 0}/1)</span>
                        </h4>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Lounge</span>
                      </div>

                      <div className="w-full">
                        {session.byCategory?.lounge?.length ? (
                          session.byCategory.lounge.slice(0, 1).map((img, idx) => (
                            <div
                              key={img.id}
                              onClick={() => {
                                const globalIdx = session.images.findIndex((i) => i.id === img.id)
                                openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                              }}
                              className="group relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs hover:border-teal-500 hover:scale-[1.02] transition-all"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt={`Lounge photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                              
                              <div className="absolute top-1.5 left-1.5 z-10 bg-black/80 text-white font-semibold text-[10px] px-2 py-0.5 rounded flex items-center gap-1 border border-white/20">
                                <Armchair className="w-3 h-3 text-indigo-300" />
                                <span>Lounge</span>
                              </div>

                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <ZoomIn className="w-5 h-5 text-white" />
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="w-full h-24 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                            <Armchair className="w-4 h-4 mb-1 text-slate-300" />
                            No Lounge
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Category 4: Washroom (1 Slot = col-span-2) */}
                  <div className="md:col-span-2 bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 truncate">
                        <Droplets className="w-4 h-4 text-[#055B65] shrink-0" />
                        <span className="truncate">Washroom ({session.byCategory?.bathroom?.length || 0}/1)</span>
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Clean</span>
                    </div>

                    <div className="w-full">
                      {session.byCategory?.bathroom?.length ? (
                        session.byCategory.bathroom.slice(0, 1).map((img, idx) => {
                          const isRevealed = revealedWashrooms.has(img.id)
                          return (
                            <div
                              key={img.id}
                              onClick={() => {
                                const globalIdx = session.images.findIndex((i) => i.id === img.id)
                                openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                              }}
                              className="group relative aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900 cursor-pointer shadow-2xs hover:border-teal-500 transition-all"
                            >
                              {/* Washroom Image with Default Blur */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.url}
                                alt={`Washroom photo ${idx + 1}`}
                                className={`w-full h-full object-cover transition-all duration-300 ${
                                  isRevealed ? 'blur-0' : 'blur-md scale-105 select-none'
                                }`}
                                loading="lazy"
                              />

                              {/* Minimal Badge */}
                              <div className="absolute top-1.5 left-1.5 z-10 bg-black/80 text-white font-semibold text-[10px] px-2 py-0.5 rounded shadow-sm flex items-center gap-1 border border-white/20">
                                <Droplets className="w-3 h-3 text-teal-300" />
                                <span>Washroom</span>
                              </div>

                              {/* Inline Privacy Overlay & Click to Reveal Toggle */}
                              {!isRevealed ? (
                                <div
                                  onClick={(e) => toggleWashroomBlur(img.id, e)}
                                  className="absolute inset-0 bg-black/40 hover:bg-black/50 transition-colors flex flex-col items-center justify-center p-2 text-center z-15"
                                >
                                  <div className="bg-white/20 backdrop-blur-md rounded-full p-2 text-white mb-1 shadow-sm group-hover:scale-110 transition-transform">
                                    <Eye className="w-4 h-4" />
                                  </div>
                                  <span className="text-[10px] font-bold text-white leading-tight drop-shadow-xs">
                                    Click to View
                                  </span>
                                </div>
                              ) : (
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => toggleWashroomBlur(img.id, e)}
                                    className="bg-black/60 text-white p-1.5 rounded-full hover:bg-black/80"
                                    title="Blur image again"
                                  >
                                    <EyeOff className="w-4 h-4" />
                                  </button>
                                  <ZoomIn className="w-5 h-5 text-white" />
                                </div>
                              )}
                            </div>
                          )
                        })
                      ) : (
                        <div className="w-full h-24 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                          <Droplets className="w-4 h-4 mb-1 text-slate-300" />
                          No washroom
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lightbox Full-Screen Modal (Always 100% Crisp & Unblurred) */}
      {lightboxOpen && activeImage && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-in fade-in duration-200">
          {/* Lightbox Top Bar */}
          <div className="w-full flex items-center justify-between text-white pb-3 border-b border-white/10 z-10">
            <div className="flex items-center gap-3">
              <span className="bg-white/20 px-2.5 py-1 rounded-full text-xs font-bold">
                {activeImageIndex + 1} / {activeSessionImages.length}
              </span>
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <span>{activeImage.brand.toUpperCase()} · {activeImage.location}</span>
                  <span className="bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded-full uppercase border border-white/20">
                    {activeImage.department}
                  </span>
                  <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-full uppercase">
                    {activeImage.category === 'vehicles'
                      ? activeImage.department === 'service'
                        ? `Workshop Bay #${activeImage.categorySlot || 1}`
                        : `Vehicle #${activeImage.categorySlot || 1}`
                      : `${activeImage.category} #${activeImage.categorySlot || 1}`}
                  </span>
                </h3>
                <p className="text-[11px] text-white/60">
                  {new Date(activeImage.capturedAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                  })} IST
                  {activeImage.uploaderName ? ` · Uploaded by ${activeImage.uploaderName}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Rotate Left (-90°) [L]"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Rotate Right (+90°) [R]"
              >
                <RotateCw className="w-4 h-4" />
              </Button>
              {(rotation !== 0 || zoomLevel !== 1) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRotation(0)
                    setZoomLevel(1)
                  }}
                  className="text-amber-300 hover:bg-white/20 h-9 px-2 text-xs font-semibold cursor-pointer gap-1"
                  title="Reset Zoom & Rotation [0]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{rotation !== 0 ? `${rotation}°` : 'Reset'}</span>
                </Button>
              )}
              <a
                href={activeImage.url}
                download={`showroom_${activeImage.brand}_${activeImage.category}_${Date.now()}.jpg`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center text-white hover:bg-white/20 h-9 w-9 rounded-lg transition-colors cursor-pointer"
                title="Download Photo"
              >
                <Download className="w-4 h-4" />
              </a>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLightboxOpen(false)}
                className="text-white hover:bg-rose-600/80 h-9 w-9 p-0 rounded-lg ml-1 cursor-pointer"
                title="Close [Esc]"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Lightbox Center Image Viewport */}
          <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden py-4">
            {/* Left Nav Button */}
            <button
              type="button"
              onClick={() => {
                setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : activeSessionImages.length - 1))
                setZoomLevel(1)
                setRotation(0)
              }}
              className="absolute left-2 sm:left-6 z-20 bg-black/60 hover:bg-black/90 text-white p-3 rounded-full border border-white/20 shadow-lg transition-all cursor-pointer"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* Clear, Unblurred High-Res Image in Lightbox */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImage.url}
              alt="Showroom inspection"
              style={{
                transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease-out',
              }}
              className={
                rotation % 180 !== 0
                  ? 'max-h-[75vw] max-w-[70vh] object-contain rounded-lg shadow-2xl'
                  : 'max-h-[78vh] max-w-[88vw] object-contain rounded-lg shadow-2xl'
              }
            />

            {/* Floating Quick Action Toolbar (Bottom Center) */}
            <div className="absolute bottom-4 sm:bottom-6 z-30 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 backdrop-blur-md border border-white/20 shadow-2xl">
              <button
                type="button"
                onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                className="flex items-center gap-1.5 text-white hover:bg-white/20 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer"
                title="Rotate Left 90° (Counter-Clockwise) [L]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rotate Left</span>
              </button>

              <div className="h-4 w-px bg-white/20" />

              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="flex items-center gap-1.5 text-white hover:bg-white/20 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer"
                title="Rotate Right 90° (Clockwise) [R]"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rotate Right</span>
              </button>

              {(rotation !== 0 || zoomLevel !== 1) && (
                <>
                  <div className="h-4 w-px bg-white/20" />
                  <button
                    type="button"
                    onClick={() => {
                      setRotation(0)
                      setZoomLevel(1)
                    }}
                    className="flex items-center gap-1 text-amber-300 hover:bg-white/20 px-2 py-1 rounded-full text-xs font-bold transition-all cursor-pointer"
                    title="Reset Orientation [0]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reset ({rotation}°)</span>
                  </button>
                </>
              )}
            </div>

            {/* Right Nav Button */}
            <button
              type="button"
              onClick={() => {
                setActiveImageIndex((prev) => (prev < activeSessionImages.length - 1 ? prev + 1 : 0))
                setZoomLevel(1)
                setRotation(0)
              }}
              className="absolute right-2 sm:right-6 z-20 bg-black/60 hover:bg-black/90 text-white p-3 rounded-full border border-white/20 shadow-lg transition-all cursor-pointer"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Lightbox Bottom Thumbnail Strip */}
          <div className="w-full flex justify-center items-center gap-2 overflow-x-auto pt-2 pb-1 z-10 scrollbar-thin">
            {activeSessionImages.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => {
                  setActiveImageIndex(i)
                  setZoomLevel(1)
                  setRotation(0)
                }}
                className={`w-14 h-14 rounded-lg overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                  activeImageIndex === i ? 'border-white scale-105 shadow-md' : 'border-transparent opacity-50 hover:opacity-100'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={`Thumb ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* QR Code & Direct Branch Link Generator Dialog */}
      <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
        <DialogContent className="sm:max-w-lg text-center bg-white rounded-3xl border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center justify-center gap-2 text-slate-900">
              <QrCode className="w-5 h-5 text-[#055B65]" />
              Branch QR & Direct Upload Generator
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Select the exact brand, location, and department to generate a locked QR code & link for branch staff.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 flex flex-col items-center justify-center">
            {/* Branch Parameter Selectors inside QR Generator */}
            <div className="w-full grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/80 text-left">
              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase">Brand</Label>
                <Select value={qrBrand} onValueChange={(val) => handleQrBrandChange(val as ShowroomBrandKey)}>
                  <SelectTrigger className="h-8.5 bg-white text-xs font-semibold rounded-lg mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOWROOM_BRANDS.map((b) => (
                      <SelectItem key={b.key} value={b.key} className="text-xs">
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase">Location</Label>
                <Select value={qrLocation} onValueChange={setQrLocation}>
                  <SelectTrigger className="h-8.5 bg-white text-xs font-semibold rounded-lg mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {qrLocations.map((loc) => (
                      <SelectItem key={loc} value={loc} className="text-xs">
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-[10px] font-bold text-slate-500 uppercase">Department</Label>
                <Select value={qrDept} onValueChange={(val) => setQrDept(val as ShowroomDepartmentKey)}>
                  <SelectTrigger className="h-8.5 bg-white text-xs font-semibold rounded-lg mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sales" className="text-xs">Sales</SelectItem>
                    <SelectItem value="service" className="text-xs">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* QR Code Graphic */}
            <div className="p-3 bg-white rounded-2xl border-2 border-slate-200 shadow-xs inline-flex items-center justify-center min-w-[170px] min-h-[170px]">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="Branch QR Code" className="w-[170px] h-[170px]" />
              ) : (
                <div className="w-[170px] h-[170px] flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              )}
            </div>

            <div className="text-center space-y-1">
              <p className="text-xs font-bold text-slate-900 flex items-center justify-center gap-1.5">
                <span>{getShowroomBrandConfig(qrBrand)?.label}</span>
                <span className="text-slate-400">·</span>
                <span>{qrLocation}</span>
                <span className="bg-teal-50 text-[#055B65] px-2 py-0.5 rounded-full border border-teal-200 text-[10px] uppercase font-bold">
                  {qrDept}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 max-w-sm break-all font-mono bg-slate-50 p-2 rounded-xl border border-slate-200/60">
                {qrGeneratedUploadUrl}
              </p>
            </div>

            <div className="flex items-center gap-2 w-full pt-1">
              <Button
                variant="outline"
                onClick={copyUploadLink}
                className="flex-1 text-xs h-10 rounded-xl cursor-pointer border-slate-200"
              >
                {copiedLink ? <Check className="w-4 h-4 mr-1.5 text-emerald-600" /> : <Copy className="w-4 h-4 mr-1.5" />}
                {copiedLink ? 'Copied' : 'Copy Direct Link'}
              </Button>

              <a
                href={qrGeneratedUploadUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center text-xs h-10 rounded-xl bg-[#055B65] hover:bg-[#044850] text-white font-semibold transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 mr-1.5" />
                Open Upload Page
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

