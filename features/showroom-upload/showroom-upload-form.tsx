'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import {
  SHOWROOM_BRANDS,
  type ShowroomBrandKey,
  getLocationsForBrand,
  getShowroomBrandConfig,
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
}

export function ShowroomUploadForm({ initialBrand }: { initialBrand?: string | null }) {
  const [brand, setBrand] = useState<ShowroomBrandKey>(() => {
    const valid = SHOWROOM_BRANDS.find((b) => b.key === initialBrand?.toLowerCase())
    return valid ? valid.key : 'kia'
  })

  const locations = getLocationsForBrand(brand)
  const [location, setLocation] = useState<string>(() => locations[0] || 'Jammu')
  const [uploaderName, setUploaderName] = useState<string>('')

  // Snapped photos queue
  const [photos, setPhotos] = useState<SnappedPhoto[]>([])

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
    count: number
  } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photosRef = useRef<SnappedPhoto[]>([])

  // Keep photosRef synced for unmount cleanup
  photosRef.current = photos

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
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  // Rapid snap photo with IST watermark & WebP compression
  const snapPhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

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
    const watermarkText = `${brandLabel.toUpperCase()} · ${location.toUpperCase()} · ${stamp} IST`

    // Watermark bar styling
    const barHeight = Math.max(36, Math.round(h * 0.055))
    const fontSize = Math.round(barHeight * 0.44)

    // Dark sleek gradient bar at bottom of photo
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(0, h - barHeight, w, barHeight)

    // Brand accent color block
    ctx.fillStyle = brandCfg?.accentColor || '#4f46e5'
    ctx.fillRect(0, h - barHeight, Math.max(8, Math.round(w * 0.012)), barHeight)

    // Text overlay
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
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

        setPhotos((prev) => [
          ...prev,
          {
            id,
            blob,
            previewUrl,
            timestamp: stamp,
          },
        ])
      },
      'image/webp',
      0.82
    )
  }

  // Remove single photo from queue
  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  // Submit all captured photos
  const handleSubmit = async () => {
    if (photos.length === 0) {
      toast({
        title: 'No photos captured',
        description: 'Please tap the camera shutter button to capture at least one photo.',
        variant: 'error',
      })
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('brand', brand)
      formData.append('location', location)
      if (uploaderName.trim()) {
        formData.append('uploaderName', uploaderName.trim())
      }

      photos.forEach((p, idx) => {
        const file = new File([p.blob], `showroom_${Date.now()}_${idx + 1}.webp`, {
          type: 'image/webp',
        })
        formData.append('photos', file)
      })

      const res = await fetch('/api/showroom-upload', {
        method: 'POST',
        body: formData,
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Upload failed. Please check your connection and try again.')
      }

      // Cleanup previews
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))

      setUploadSuccess({
        brand: getShowroomBrandConfig(brand)?.label || brand,
        location,
        count: photos.length,
      })

      setPhotos([])
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

  // Success view (Clean light executive receipt)
  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200/80 shadow-xl p-6 sm:p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100 shadow-sm">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Photos Uploaded Successfully
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm">
              <strong className="text-slate-800 font-semibold">{uploadSuccess.count} photos</strong> have been recorded and timestamped in the AM Group dashboard.
            </p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 text-left space-y-2.5 text-xs text-slate-600">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Brand</span>
              <span className="font-semibold text-slate-900">{uploadSuccess.brand}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Dealership Location</span>
              <span className="font-semibold text-slate-900">{uploadSuccess.location}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Photos Recorded</span>
              <span className="font-semibold text-slate-900">{uploadSuccess.count} Live Images</span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-slate-200/60">
              <span className="text-slate-500 font-medium">Dashboard Feed</span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live & Visible
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
      {/* Top Clean Header */}
      <header className="w-full bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-3.5 sticky top-0 z-30 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-xs shadow-sm shrink-0"
            style={{ backgroundColor: activeBrandConfig?.accentColor || '#4f46e5' }}
          >
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
              Showroom Camera
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">
              AM Group Live Photo Capture
            </p>
          </div>
        </div>

        {photos.length > 0 && (
          <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200/60 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>{photos.length} Captured</span>
          </div>
        )}
      </header>

      <main className="w-full max-w-lg px-4 pt-4 sm:pt-6 space-y-4">
        {/* Dealership Details Card */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            {/* Brand Dropdown */}
            <div>
              <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <Building2 className="w-3 h-3 text-indigo-600" /> Brand
              </Label>
              <Select value={brand} onValueChange={(val) => handleBrandChange(val as ShowroomBrandKey)}>
                <SelectTrigger className="h-11 bg-slate-50 border-slate-200 text-slate-900 font-semibold text-xs rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all">
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
                <MapPin className="w-3 h-3 text-emerald-600" /> Location
              </Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="h-11 bg-slate-50 border-slate-200 text-slate-900 font-semibold text-xs rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all">
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
              className="h-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* Live Camera Viewfinder Card */}
        <div className="relative overflow-hidden rounded-3xl border-2 border-slate-200/90 bg-slate-950 aspect-[4/3] shadow-md flex flex-col items-center justify-center">
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
                    className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs h-11 shadow-lg shadow-indigo-600/30 cursor-pointer"
                  >
                    <Camera className="w-4 h-4 mr-2" /> Start Camera
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Live Watermark Preview Banner (Bottom overlay on camera) */}
          {cameraActive && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3.5 py-2.5 flex items-center justify-between text-[11px] font-bold text-white">
              <span className="flex items-center gap-2 drop-shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{activeBrandConfig?.label} · {location}</span>
              </span>
              <span className="text-[10px] text-slate-300 font-mono bg-black/40 px-2 py-0.5 rounded-full border border-white/10">
                IST WATERMARK
              </span>
            </div>
          )}

          {/* Quick 120ms Shutter Flash (Micro visual feedback without blocking camera) */}
          {flashEffect && (
            <div className="absolute inset-0 bg-white/70 pointer-events-none transition-opacity duration-100" />
          )}
        </div>

        {/* Hidden Canvas for Watermark & WebP Compression */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Camera Shutter & Actions */}
        {cameraActive && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
            <div className="text-left">
              <p className="text-xs font-bold text-slate-900">
                {photos.length === 0 ? 'Ready to Shoot' : `${photos.length} Photo${photos.length > 1 ? 's' : ''} Ready`}
              </p>
              <p className="text-[11px] text-slate-500">
                Continuous live shooting
              </p>
            </div>

            {/* iOS Style Circular Shutter Button */}
            <button
              type="button"
              onClick={snapPhoto}
              disabled={isSnapping}
              aria-label="Take Photo"
              className="relative w-16 h-16 rounded-full border-4 border-slate-200 flex items-center justify-center bg-transparent active:scale-90 transition-transform cursor-pointer shadow-sm group hover:border-slate-300"
            >
              <span className="w-12 h-12 rounded-full bg-rose-600 group-hover:bg-rose-500 transition-colors shadow-inner" />
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

        {/* Snapped Photos Tray */}
        {photos.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-indigo-600" />
                Captured Photos ({photos.length})
              </h3>
              <button
                type="button"
                onClick={() => {
                  photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
                  setPhotos([])
                }}
                className="text-xs text-rose-600 hover:text-rose-700 font-semibold cursor-pointer"
              >
                Clear all
              </button>
            </div>

            {/* Horizontal Scroll Thumbnail List */}
            <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin">
              {photos.map((photo, index) => (
                <div
                  key={photo.id}
                  className="relative group shrink-0 w-24 h-24 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 shadow-xs"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 bg-slate-900/80 text-white text-[9px] px-1.5 py-0.5 rounded-md font-bold">
                    #{index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    aria-label={`Delete photo ${index + 1}`}
                    className="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white p-1 rounded-full shadow-sm cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Upload Button */}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={uploading}
              className="w-full h-13 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-600/20 cursor-pointer transition-all"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading {photos.length} Photos…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" /> Upload {photos.length} Showroom {photos.length === 1 ? 'Photo' : 'Photos'}
                </>
              )}
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
