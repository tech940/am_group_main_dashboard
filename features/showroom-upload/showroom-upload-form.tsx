'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Building2,
  MapPin,
  User,
  ShieldCheck,
  AlertTriangle,
  Tv,
  Car,
  Sparkles,
  Check,
  Briefcase,
  Wrench,
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
  getShowroomCategoryConfig,
} from '@/lib/showroom-images/constants'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'

type SnappedPhoto = {
  id: string
  blob: Blob
  previewUrl: string
  timestamp: string
  category: ShowroomCategoryKey
  slot: number
}

const SLOT_DEFINITIONS = [
  {
    key: 'vehicles_1',
    category: 'vehicles' as ShowroomCategoryKey,
    categoryLabel: 'Vehicles',
    slotNumber: 1,
    title: 'Vehicle #1',
    subtitle: 'Display / floor vehicle (Angle 1)',
    icon: Car,
  },
  {
    key: 'vehicles_2',
    category: 'vehicles' as ShowroomCategoryKey,
    categoryLabel: 'Vehicles',
    slotNumber: 2,
    title: 'Vehicle #2',
    subtitle: 'Display / floor vehicle (Angle 2)',
    icon: Car,
  },
  {
    key: 'tv_1',
    category: 'tv' as ShowroomCategoryKey,
    categoryLabel: 'TV Display',
    slotNumber: 1,
    title: 'TV Screen #1',
    subtitle: 'Customer lounge / main showroom TV',
    icon: Tv,
  },
  {
    key: 'tv_2',
    category: 'tv' as ShowroomCategoryKey,
    categoryLabel: 'TV Display',
    slotNumber: 2,
    title: 'TV Screen #2',
    subtitle: 'Secondary display / AV screen',
    icon: Tv,
  },
  {
    key: 'bathroom_1',
    category: 'bathroom' as ShowroomCategoryKey,
    categoryLabel: 'Bathroom',
    slotNumber: 1,
    title: 'Bathroom #1',
    subtitle: 'Customer washroom cleanliness',
    icon: Sparkles,
  },
  {
    key: 'bathroom_2',
    category: 'bathroom' as ShowroomCategoryKey,
    categoryLabel: 'Bathroom',
    slotNumber: 2,
    title: 'Bathroom #2',
    subtitle: 'Staff / secondary washroom cleanliness',
    icon: Sparkles,
  },
] as const

export function ShowroomUploadForm({ initialBrand }: { initialBrand?: string | null }) {
  const [brand, setBrand] = useState<ShowroomBrandKey>(() => {
    const valid = SHOWROOM_BRANDS.find((b) => b.key === initialBrand?.toLowerCase())
    return valid ? valid.key : 'kia'
  })

  const locations = getLocationsForBrand(brand)
  const [location, setLocation] = useState<string>(() => locations[0] || 'Jammu')
  const [department, setDepartment] = useState<ShowroomDepartmentKey>('sales')
  const [uploaderName, setUploaderName] = useState<string>('')

  // Slot-based captured photos: map slotKey -> SnappedPhoto
  const [slotPhotos, setSlotPhotos] = useState<Record<string, SnappedPhoto>>({})
  const [activeSlotKey, setActiveSlotKey] = useState<string>('vehicles_1')

  // Camera state
  const [cameraActive, setCameraActive] = useState<boolean>(false)
  const [cameraError, setCameraError] = useState<string>('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isSnapping, setIsSnapping] = useState<boolean>(false)
  const [flashEffect, setFlashEffect] = useState<boolean>(false)
  const [uploading, setUploading] = useState<boolean>(false)
  const [uploadSuccess, setUploadSuccess] = useState<{
    brand: string
    location: string
    department: string
    count: number
  } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const slotPhotosRef = useRef<Record<string, SnappedPhoto>>({})

  // Keep ref synced
  slotPhotosRef.current = slotPhotos

  const activeSlot = useMemo(() => {
    return SLOT_DEFINITIONS.find((s) => s.key === activeSlotKey) || SLOT_DEFINITIONS[0]
  }, [activeSlotKey])

  const totalCaptured = Object.keys(slotPhotos).length

  // Update default location when brand changes
  const handleBrandChange = (newBrand: ShowroomBrandKey) => {
    setBrand(newBrand)
    const brandLocs = getLocationsForBrand(newBrand)
    if (!brandLocs.includes(location)) {
      setLocation(brandLocs[0] || 'Jammu')
    }
  }

  // Camera stream management
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setStream(null)
    setCameraActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is not supported on this browser or connection is not HTTPS.')
      return
    }

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }

      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })

      streamRef.current = media
      setStream(media)
      setCameraActive(true)
    } catch (err) {
      console.error('Camera access error:', err)
      setCameraError('Camera permission denied or unavailable. Please allow camera access and try again.')
      setCameraActive(false)
    }
  }, [])

  // Auto-start camera on mount
  useEffect(() => {
    startCamera()
  }, [startCamera])

  // Attach stream to video tag
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    video.srcObject = stream
    const play = () => video.play().catch(() => null)
    if (video.readyState >= 1) play()
    else video.onloadedmetadata = play
  }, [stream])

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      Object.values(slotPhotosRef.current).forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  // Rapid snap photo with IST watermark burning & WebP compression
  const snapPhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !activeSlot) return

    setIsSnapping(true)
    setFlashEffect(true)
    setTimeout(() => setFlashEffect(false), 120)

    const w = video.videoWidth || 1280
    const h = video.videoHeight || 960

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setIsSnapping(false)
      return
    }

    // Draw frame
    ctx.drawImage(video, 0, 0, w, h)

    // IST Timestamp
    const stamp = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })

    const brandCfg = getShowroomBrandConfig(brand)
    const brandLabel = brandCfg?.label || brand.toUpperCase()
    const deptLabel = department.toUpperCase()
    const catLabel = activeSlot.categoryLabel.toUpperCase()
    const watermarkText = `${brandLabel.toUpperCase()} · ${location.toUpperCase()} · ${deptLabel} · ${catLabel} #${activeSlot.slotNumber} · ${stamp} IST`

    // Watermark bar styling
    const barHeight = Math.max(38, Math.round(h * 0.058))
    const fontSize = Math.round(barHeight * 0.42)

    // Dark sleek gradient bar at bottom of photo
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)'
    ctx.fillRect(0, h - barHeight, w, barHeight)

    // Brand accent color block
    ctx.fillStyle = brandCfg?.accentColor || '#0284c7'
    ctx.fillRect(0, h - barHeight, Math.max(8, Math.round(w * 0.012)), barHeight)

    // Text overlay
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(watermarkText, Math.round(barHeight * 0.45), h - Math.round(barHeight / 2))

    // Compress to WebP (quality 0.82)
    canvas.toBlob(
      (blob) => {
        setIsSnapping(false)
        if (!blob) return

        const id = crypto.randomUUID()
        const previewUrl = URL.createObjectURL(blob)

        // If existing photo in this slot, revoke its URL
        const existing = slotPhotos[activeSlot.key]
        if (existing) URL.revokeObjectURL(existing.previewUrl)

        const newPhoto: SnappedPhoto = {
          id,
          blob,
          previewUrl,
          timestamp: stamp,
          category: activeSlot.category,
          slot: activeSlot.slotNumber,
        }

        setSlotPhotos((prev) => ({
          ...prev,
          [activeSlot.key]: newPhoto,
        }))

        // Auto-advance to next empty slot
        const currentIdx = SLOT_DEFINITIONS.findIndex((s) => s.key === activeSlot.key)
        const nextEmpty = SLOT_DEFINITIONS.find((s, idx) => idx > currentIdx && !slotPhotos[s.key])
          || SLOT_DEFINITIONS.find((s) => !slotPhotos[s.key] && s.key !== activeSlot.key)

        if (nextEmpty) {
          setActiveSlotKey(nextEmpty.key)
        } else {
          const nextSequential = SLOT_DEFINITIONS[(currentIdx + 1) % SLOT_DEFINITIONS.length]
          setActiveSlotKey(nextSequential.key)
        }
      },
      'image/webp',
      0.82
    )
  }

  // Remove single photo from slot
  const clearSlot = (slotKey: string) => {
    setSlotPhotos((prev) => {
      const target = prev[slotKey]
      if (target) URL.revokeObjectURL(target.previewUrl)
      const next = { ...prev }
      delete next[slotKey]
      return next
    })
  }

  // Submit all captured photos
  const handleSubmit = async () => {
    const photosToUpload = Object.values(slotPhotos)
    if (photosToUpload.length === 0) {
      toast({
        title: 'No photos captured',
        description: 'Please capture at least one photo before submitting.',
        variant: 'error',
      })
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('brand', brand)
      formData.append('location', location)
      formData.append('department', department)
      if (uploaderName.trim()) {
        formData.append('uploaderName', uploaderName.trim())
      }

      const manifest: Array<{ category: string; slot: number }> = []

      photosToUpload.forEach((p, idx) => {
        const file = new File([p.blob], `showroom_${p.category}_${p.slot}_${Date.now()}_${idx + 1}.webp`, {
          type: 'image/webp',
        })
        formData.append('photos', file)
        manifest.push({ category: p.category, slot: p.slot })
      })

      formData.append('manifest', JSON.stringify(manifest))

      const res = await fetch('/api/showroom-upload', {
        method: 'POST',
        body: formData,
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Upload failed. Please check your connection and try again.')
      }

      // Cleanup previews
      photosToUpload.forEach((p) => URL.revokeObjectURL(p.previewUrl))

      setUploadSuccess({
        brand: getShowroomBrandConfig(brand)?.label || brand,
        location,
        department: department === 'service' ? 'Service' : 'Sales',
        count: photosToUpload.length,
      })

      setSlotPhotos({})
    } catch (err) {
      toast({
        title: 'Upload Failed',
        description: err instanceof Error ? err.message : 'Could not upload photos.',
        variant: 'error',
      })
    } finally {
      setUploading(false)
    }
  }

  // Success view (Clean executive receipt)
  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Photos Uploaded Successfully
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm">
              <strong className="text-slate-800 font-semibold">{uploadSuccess.count} photos</strong> recorded under{' '}
              <strong className="text-slate-900 font-semibold">{uploadSuccess.department}</strong> for{' '}
              <strong className="text-slate-800 font-semibold">{uploadSuccess.brand}</strong> ({uploadSuccess.location}).
            </p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-left space-y-2.5 text-xs text-slate-600">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Brand</span>
              <span className="font-semibold text-slate-900">{uploadSuccess.brand}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Dealership Location</span>
              <span className="font-semibold text-slate-900">{uploadSuccess.location}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Department</span>
              <span className="font-bold text-slate-900 bg-slate-200 px-2 py-0.5 rounded-full">
                {uploadSuccess.department}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Photos Recorded</span>
              <span className="font-semibold text-slate-900">{uploadSuccess.count} Live Images</span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-slate-200">
              <span className="text-slate-500 font-medium">Dashboard Feed</span>
              <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-900" /> Live & Visible
              </span>
            </div>
          </div>

          <Button
            onClick={() => {
              setUploadSuccess(null)
              startCamera()
            }}
            className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm shadow-md transition-all cursor-pointer"
          >
            <Camera className="w-4 h-4 mr-2" />
            Capture More Showroom Photos
          </Button>
        </div>
      </div>
    )
  }

  const activeBrandConfig = getShowroomBrandConfig(brand)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-start pb-16">
      {/* Top Header */}
      <header className="w-full bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 sticky top-0 z-30 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-xs shadow-sm shrink-0"
            style={{ backgroundColor: activeBrandConfig?.accentColor || '#0f172a' }}
          >
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
              Showroom Camera
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">
              AM Group Inspection
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
            {department}
          </span>
          <div className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1 rounded-full text-xs font-bold">
            <span>{totalCaptured}/6 Snapped</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-lg px-4 pt-4 sm:pt-6 space-y-4">
        {/* Dealership & Department Selector Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          {/* Department Selector Toggle */}
          <div>
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-2">
              <Briefcase className="w-3.5 h-3.5 text-slate-700" /> Department
            </Label>
            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setDepartment('sales')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  department === 'sales'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                Sales Showroom
              </button>

              <button
                type="button"
                onClick={() => setDepartment('service')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  department === 'service'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                Service Center
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Brand Dropdown */}
            <div>
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <Building2 className="w-3 h-3 text-slate-600" /> Brand
              </Label>
              <Select value={brand} onValueChange={(val) => handleBrandChange(val as ShowroomBrandKey)}>
                <SelectTrigger className="h-11 bg-slate-50 border-slate-200 text-slate-900 font-semibold text-xs rounded-xl focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-900 shadow-lg">
                  {SHOWROOM_BRANDS.map((b) => (
                    <SelectItem key={b.key} value={b.key} className="text-xs font-medium cursor-pointer">
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Location Dropdown */}
            <div>
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <MapPin className="w-3 h-3 text-slate-600" /> Location
              </Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="h-11 bg-slate-50 border-slate-200 text-slate-900 font-semibold text-xs rounded-xl focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-900 shadow-lg">
                  {locations.map((loc) => (
                    <SelectItem key={loc} value={loc} className="text-xs font-medium cursor-pointer">
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Optional Uploader Name */}
          <div>
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
              <User className="w-3 h-3 text-slate-400" /> Person Uploading (Optional)
            </Label>
            <Input
              value={uploaderName}
              onChange={(e) => setUploaderName(e.target.value)}
              placeholder="e.g. Showroom Manager / Security"
              className="h-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* Guided Category & Slot Checklist Strip */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Required Photos (6 Total)
            </span>
            <span className="text-[11px] text-slate-500 font-semibold">
              2 Vehicles · 2 TV · 2 Bathroom
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {SHOWROOM_CATEGORIES.map((cat) => {
              const catSlots = SLOT_DEFINITIONS.filter((s) => s.category === cat.key)
              const countCaptured = catSlots.filter((s) => Boolean(slotPhotos[s.key])).length
              const isComplete = countCaptured === cat.slotCount
              const isCurrentCat = activeSlot.category === cat.key

              return (
                <div
                  key={cat.key}
                  className={`p-2.5 rounded-2xl border transition-all text-left ${
                    isCurrentCat
                      ? 'bg-slate-100 border-slate-400 shadow-xs ring-1 ring-slate-400'
                      : isComplete
                      ? 'bg-slate-50 border-slate-300 text-slate-800'
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {cat.label}
                    </span>
                    {isComplete ? (
                      <CheckCircle2 className="w-4 h-4 text-slate-900 shrink-0" />
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500">
                        {countCaptured}/2
                      </span>
                    )}
                  </div>

                  <div className="flex gap-1.5 mt-2">
                    {catSlots.map((slot) => {
                      const hasPhoto = Boolean(slotPhotos[slot.key])
                      const isTarget = activeSlotKey === slot.key

                      return (
                        <button
                          key={slot.key}
                          type="button"
                          onClick={() => setActiveSlotKey(slot.key)}
                          className={`flex-1 py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                            isTarget
                              ? 'bg-slate-900 text-white shadow-xs'
                              : hasPhoto
                              ? 'bg-slate-700 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          #{slot.slotNumber}
                          {hasPhoto && !isTarget && <Check className="w-2.5 h-2.5" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Current Active Slot Banner */}
        <div className="bg-slate-900 text-white rounded-2xl p-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center text-white shrink-0">
              <activeSlot.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold leading-tight flex items-center gap-1.5">
                <span>Capturing {activeSlot.title}</span>
                <span className="bg-white/20 text-[10px] px-2 py-0.2 rounded-full font-mono">
                  Slot {activeSlot.slotNumber} of 2
                </span>
              </p>
              <p className="text-[10px] text-slate-300 leading-tight">
                {activeSlot.subtitle}
              </p>
            </div>
          </div>

          {slotPhotos[activeSlot.key] && (
            <span className="text-[10px] font-bold bg-white text-slate-900 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> Captured
            </span>
          )}
        </div>

        {/* Live Camera Viewfinder Card */}
        <div className="relative overflow-hidden rounded-3xl border-2 border-slate-300 bg-slate-950 aspect-[4/3] shadow-md flex flex-col items-center justify-center">
          {/* Active Video Stream */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover transition-opacity duration-200 ${
              cameraActive ? 'opacity-100' : 'opacity-0 hidden'
            }`}
          />

          {/* Camera Disabled / Error State */}
          {!cameraActive && (
            <div className="p-6 text-center space-y-4 max-w-xs text-white">
              {cameraError ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <p className="text-xs text-amber-200 font-medium leading-relaxed">
                    {cameraError}
                  </p>
                  <Button
                    type="button"
                    onClick={startCamera}
                    variant="outline"
                    className="rounded-xl border-slate-700 bg-slate-900 text-white hover:bg-slate-800 text-xs h-10"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try Again
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-white/10 text-white flex items-center justify-center mx-auto border border-white/20 shadow-inner">
                    <Camera className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Live Camera</h3>
                    <p className="text-[11px] text-slate-300 mt-1">
                      Tap below to open camera and snap live showroom photos.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={startCamera}
                    className="w-full rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs h-11 shadow-lg cursor-pointer"
                  >
                    <Camera className="w-4 h-4 mr-2" /> Start Camera
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Live Watermark Preview Banner (Bottom overlay on camera) */}
          {cameraActive && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3.5 py-2.5 flex items-center justify-between text-[11px] font-bold text-white">
              <span className="flex items-center gap-2 drop-shadow-sm">
                <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
                <span>
                  {activeBrandConfig?.label} · {location} · {department.toUpperCase()} · {activeSlot.categoryLabel.toUpperCase()} #{activeSlot.slotNumber}
                </span>
              </span>
              <span className="text-[10px] text-slate-300 font-mono bg-black/40 px-2 py-0.5 rounded-full border border-white/10">
                IST WATERMARK
              </span>
            </div>
          )}

          {/* Quick 120ms Shutter Flash */}
          {flashEffect && (
            <div className="absolute inset-0 bg-white/70 pointer-events-none transition-opacity duration-100" />
          )}
        </div>

        {/* Hidden Canvas for Watermark & WebP Compression */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Camera Shutter & Actions */}
        {cameraActive && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
            <div className="text-left">
              <p className="text-xs font-bold text-slate-900">
                Snap {activeSlot.title}
              </p>
              <p className="text-[11px] text-slate-500">
                {slotPhotos[activeSlot.key] ? 'Tap shutter to retake photo' : 'Tap shutter to capture'}
              </p>
            </div>

            {/* iOS Style Circular Shutter Button */}
            <button
              type="button"
              onClick={snapPhoto}
              disabled={isSnapping}
              aria-label={`Take ${activeSlot.title} Photo`}
              className="relative w-16 h-16 rounded-full border-4 border-slate-300 flex items-center justify-center bg-transparent active:scale-90 transition-transform cursor-pointer shadow-sm group hover:border-slate-400"
            >
              <span className="w-12 h-12 rounded-full bg-rose-600 group-hover:bg-rose-500 transition-colors shadow-inner flex items-center justify-center text-white">
                <Camera className="w-5 h-5" />
              </span>
            </button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={stopCamera}
              className="text-xs h-9 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-100"
            >
              Pause
            </Button>
          </div>
        )}

        {/* 6-Photo Structured Slot Grid */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-slate-700" />
              Showroom Photo Checklist ({totalCaptured}/6)
            </h3>
            {totalCaptured > 0 && (
              <button
                type="button"
                onClick={() => {
                  Object.values(slotPhotos).forEach((p) => URL.revokeObjectURL(p.previewUrl))
                  setSlotPhotos({})
                }}
                className="text-xs text-rose-600 hover:text-rose-700 font-semibold cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {SLOT_DEFINITIONS.map((slot) => {
              const photo = slotPhotos[slot.key]
              const isSelected = activeSlotKey === slot.key

              return (
                <div
                  key={slot.key}
                  onClick={() => setActiveSlotKey(slot.key)}
                  className={`relative rounded-2xl border p-2.5 transition-all cursor-pointer flex flex-col justify-between min-h-[130px] ${
                    isSelected
                      ? 'border-slate-900 bg-slate-100/70 shadow-xs ring-2 ring-slate-300'
                      : photo
                      ? 'border-slate-300 bg-white'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100/80'
                  }`}
                >
                  {photo ? (
                    <div className="relative w-full h-20 rounded-xl overflow-hidden mb-2 bg-slate-900 shadow-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.previewUrl} alt={slot.title} className="w-full h-full object-cover" />
                      
                      {/* Prominent Label Tag */}
                      <span className="absolute top-1 left-1 bg-slate-900/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                        {slot.title}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          clearSlot(slot.key)
                        }}
                        aria-label={`Remove ${slot.title}`}
                        className="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white p-1 rounded-full shadow-xs transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-full h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 mb-2 bg-white">
                      <slot.icon className="w-5 h-5 mb-1 text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-600">Tap to Snap</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-left">
                    <div>
                      <p className="text-xs font-bold text-slate-900 leading-tight">
                        {slot.title}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {slot.categoryLabel}
                      </p>
                    </div>

                    {photo ? (
                      <CheckCircle2 className="w-4 h-4 text-slate-900 shrink-0" />
                    ) : isSelected ? (
                      <span className="w-2 h-2 rounded-full bg-slate-900 animate-ping" />
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Submit Button */}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={uploading || totalCaptured === 0}
            className="w-full h-13 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-md cursor-pointer transition-all mt-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading {totalCaptured} Photos…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 mr-2" /> Upload {totalCaptured} {department === 'sales' ? 'Sales' : 'Service'} Photos
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  )
}


