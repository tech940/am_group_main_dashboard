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
  Search,
  Share2,
  Sparkles,
  User,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  Copy,
  Check,
  Briefcase,
  Wrench,
  Tv,
  Car,
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
import QRCode from 'qrcode'

export function ShowroomGalleryClient({
  initialUserBrand,
}: {
  initialUserBrand?: string | null
}) {
  const [selectedBrand, setSelectedBrand] = useState<string>('all')
  const [selectedLocation, setSelectedLocation] = useState<string>('all')
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('all')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')

  // QR Modal
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copiedLink, setCopiedLink] = useState(false)

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

  // Reset location filter if brand changes
  const handleBrandChange = (brandKey: string) => {
    setSelectedBrand(brandKey)
    setSelectedLocation('all')
  }

  // Calculate Date bounds
  const { startDate, endDate } = useMemo(() => {
    const now = new Date()
    if (dateFilter === 'today') {
      const todayStr = now.toISOString().split('T')[0]
      return { startDate: todayStr, endDate: todayStr }
    }
    if (dateFilter === 'yesterday') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      const yStr = y.toISOString().split('T')[0]
      return { startDate: yStr, endDate: yStr }
    }
    if (dateFilter === 'last7days') {
      const last7 = new Date(now)
      last7.setDate(last7.getDate() - 7)
      return { startDate: last7.toISOString().split('T')[0], endDate: now.toISOString().split('T')[0] }
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
      } else if (e.key === 'Escape') {
        setLightboxOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxOpen, activeSessionImages.length])

  // Direct public upload link
  const uploadUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/showroom-upload'
    const url = new URL('/showroom-upload', window.location.origin)
    if (selectedBrand !== 'all') url.searchParams.set('brand', selectedBrand)
    if (selectedDepartment !== 'all') url.searchParams.set('dept', selectedDepartment)
    return url.toString()
  }, [selectedBrand, selectedDepartment])

  useEffect(() => {
    if (uploadUrl) {
      QRCode.toDataURL(uploadUrl, { width: 240, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''))
    }
  }, [uploadUrl])

  const copyUploadLink = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(uploadUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
      toast({
        title: 'Link Copied',
        description: 'Public showroom camera upload link copied to clipboard.',
      })
    }
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-slate-800" />
              Showroom Images
            </h1>
            <span className="bg-slate-100 text-slate-800 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-slate-200">
              Live Feed
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time inspection of vehicles, TV displays, and washrooms across all AM Group dealerships.
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
            className="text-xs h-9 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-sm cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 mr-1.5" />
            Upload / Scan QR
          </Button>
        </div>
      </div>

      {/* Brand Selector Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        <button
          type="button"
          onClick={() => handleBrandChange('all')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
            selectedBrand === 'all'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          All Brands ({totalImages})
        </button>

        {SHOWROOM_BRANDS.map((b) => {
          const isActive = selectedBrand === b.key
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => handleBrandChange(b.key)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: isActive ? '#ffffff' : b.accentColor }}
              />
              {b.label}
            </button>
          )
        })}
      </div>

      {/* Filters Bar: Department, Category, Location & Date Range */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Department Filter Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setSelectedDepartment('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedDepartment === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
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
                  ? 'bg-slate-900 text-white shadow-xs'
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
                  ? 'bg-slate-900 text-white shadow-xs'
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
              <SelectTrigger className="h-9 w-36 text-xs font-semibold bg-slate-50 border-slate-200 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-medium">All Categories</SelectItem>
                <SelectItem value="vehicles" className="text-xs font-medium">🚗 Vehicles (2)</SelectItem>
                <SelectItem value="tv" className="text-xs font-medium">📺 TV Display (2)</SelectItem>
                <SelectItem value="bathroom" className="text-xs font-medium">🚻 Bathroom (2)</SelectItem>
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
              <SelectTrigger className="h-9 w-32 text-xs font-semibold bg-slate-50 border-slate-200 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-medium">All Time</SelectItem>
                <SelectItem value="today" className="text-xs font-medium">Today</SelectItem>
                <SelectItem value="yesterday" className="text-xs font-medium">Yesterday</SelectItem>
                <SelectItem value="last7days" className="text-xs font-medium">Last 7 Days</SelectItem>
                <SelectItem value="custom" className="text-xs font-medium">Custom Date</SelectItem>
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
          <Loader2 className="w-8 h-8 animate-spin text-slate-900" />
          <p className="text-xs font-medium">Loading showroom photo sessions…</p>
        </div>
      )}

      {/* Gallery Feed Empty State */}
      {!isLoading && sessions.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center space-y-4 shadow-xs">
          <div className="w-14 h-14 bg-slate-100 text-slate-800 rounded-2xl flex items-center justify-center mx-auto border border-slate-200">
            <ImageIcon className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900">No Showroom Photos Found</h3>
            <p className="text-xs text-slate-500">
              No photos recorded matching this filter. Staff can open the camera form to upload showroom condition photos.
            </p>
          </div>
          <Button
            onClick={() => setQrModalOpen(true)}
            className="text-xs h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 mr-1.5" />
            Open Mobile Camera / Scan QR
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
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all space-y-4 p-5"
              >
                {/* Session Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Brand Pill */}
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full border ${
                        brandCfg?.badgeClass || 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {brandCfg?.label || session.brand.toUpperCase()}
                    </span>

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

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 font-medium">
                      {dateStr} IST
                    </span>
                    <span className="bg-slate-900 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                      {session.totalImages} {session.totalImages === 1 ? 'photo' : 'photos'}
                    </span>
                  </div>
                </div>

                {/* Categorized Photo Sections with Ultra-Prominent Badges */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  {/* Category 1: Vehicles */}
                  <div className="bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Car className="w-4 h-4 text-slate-800" />
                        Vehicles ({session.byCategory?.vehicles?.length || 0}/2)
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Floor Cars</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {session.byCategory?.vehicles?.length ? (
                        session.byCategory.vehicles.map((img, idx) => (
                          <div
                            key={img.id}
                            onClick={() => {
                              const globalIdx = session.images.findIndex((i) => i.id === img.id)
                              openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                            }}
                            className="group relative aspect-[4/3] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 cursor-pointer shadow-xs hover:border-slate-400 hover:scale-[1.02] transition-all"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={`Vehicle photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            
                            {/* Prominent High-Contrast Label Badge */}
                            <div className="absolute top-1.5 left-1.5 z-10 bg-slate-950/90 text-white font-bold text-[10px] px-2 py-0.5 rounded-md shadow-md flex items-center gap-1 border border-white/20">
                              <span>🚗 Vehicle #{img.categorySlot || idx + 1}</span>
                            </div>

                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ZoomIn className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-2 h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                          <Car className="w-4 h-4 mb-1 text-slate-300" />
                          No vehicle photos
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Category 2: TV Display */}
                  <div className="bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Tv className="w-4 h-4 text-slate-800" />
                        TV Display ({session.byCategory?.tv?.length || 0}/2)
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Screen Status</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {session.byCategory?.tv?.length ? (
                        session.byCategory.tv.map((img, idx) => (
                          <div
                            key={img.id}
                            onClick={() => {
                              const globalIdx = session.images.findIndex((i) => i.id === img.id)
                              openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                            }}
                            className="group relative aspect-[4/3] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 cursor-pointer shadow-xs hover:border-slate-400 hover:scale-[1.02] transition-all"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={`TV photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            
                            {/* Prominent High-Contrast Label Badge */}
                            <div className="absolute top-1.5 left-1.5 z-10 bg-slate-950/90 text-white font-bold text-[10px] px-2 py-0.5 rounded-md shadow-md flex items-center gap-1 border border-white/20">
                              <span>📺 TV Screen #{img.categorySlot || idx + 1}</span>
                            </div>

                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ZoomIn className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-2 h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                          <Tv className="w-4 h-4 mb-1 text-slate-300" />
                          No TV display photos
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Category 3: Bathroom */}
                  <div className="bg-slate-50/70 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-slate-800" />
                        Bathroom ({session.byCategory?.bathroom?.length || 0}/2)
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Cleanliness</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {session.byCategory?.bathroom?.length ? (
                        session.byCategory.bathroom.map((img, idx) => (
                          <div
                            key={img.id}
                            onClick={() => {
                              const globalIdx = session.images.findIndex((i) => i.id === img.id)
                              openLightbox(session.images, globalIdx >= 0 ? globalIdx : 0)
                            }}
                            className="group relative aspect-[4/3] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 cursor-pointer shadow-xs hover:border-slate-400 hover:scale-[1.02] transition-all"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={`Bathroom photo ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            
                            {/* Prominent High-Contrast Label Badge */}
                            <div className="absolute top-1.5 left-1.5 z-10 bg-slate-950/90 text-white font-bold text-[10px] px-2 py-0.5 rounded-md shadow-md flex items-center gap-1 border border-white/20">
                              <span>🚻 Bathroom #{img.categorySlot || idx + 1}</span>
                            </div>

                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ZoomIn className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-2 h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-[11px] text-slate-400 bg-white">
                          <Sparkles className="w-4 h-4 mb-1 text-slate-300" />
                          No bathroom photos
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

      {/* Lightbox Full-Screen Modal */}
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
                    {activeImage.category} #{activeImage.categorySlot || 1}
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

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="text-white hover:bg-white/20 h-9 w-9 p-0 cursor-pointer"
                title="Rotate Clockwise"
              >
                <RotateCw className="w-4 h-4" />
              </Button>
              <a
                href={activeImage.url}
                download={`showroom_${activeImage.brand}_${activeImage.category}_${Date.now()}.webp`}
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
                className="text-white hover:bg-rose-600/80 h-9 w-9 p-0 rounded-lg ml-2 cursor-pointer"
                title="Close"
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

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImage.url}
              alt="Showroom inspection"
              style={{
                transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease-out',
              }}
              className="max-h-[80vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            />

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

      {/* QR Code & Mobile Launch Dialog */}
      <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center justify-center gap-2 text-slate-900">
              <QrCode className="w-5 h-5 text-slate-800" />
              Capture Showroom Photos
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Scan this QR code with any mobile device to open the guided 6-photo showroom camera form.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4 flex flex-col items-center justify-center">
            {/* QR Code */}
            <div className="p-4 bg-white rounded-2xl border-2 border-slate-200 shadow-md inline-flex items-center justify-center min-w-[180px] min-h-[180px]">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR Code" className="w-[180px] h-[180px]" />
              ) : (
                <div className="w-[180px] h-[180px] flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              )}
            </div>

            <div className="text-center space-y-1">
              <p className="text-xs font-bold text-slate-800 flex items-center justify-center gap-1.5">
                <span>{selectedBrand !== 'all' ? getShowroomBrandConfig(selectedBrand)?.label : 'All Brands'}</span>
                {selectedDepartment !== 'all' && (
                  <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full border border-slate-200 text-[10px] uppercase font-bold">
                    {selectedDepartment}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-slate-500 max-w-xs break-all font-mono">
                {uploadUrl}
              </p>
            </div>

            <div className="flex items-center gap-2 w-full pt-2">
              <Button
                variant="outline"
                onClick={copyUploadLink}
                className="flex-1 text-xs h-11 rounded-xl cursor-pointer border-slate-200"
              >
                {copiedLink ? <Check className="w-4 h-4 mr-1.5 text-slate-900" /> : <Copy className="w-4 h-4 mr-1.5" />}
                {copiedLink ? 'Copied' : 'Copy Link'}
              </Button>

              <a
                href={uploadUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center text-xs h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 mr-1.5" />
                Open in Browser
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
