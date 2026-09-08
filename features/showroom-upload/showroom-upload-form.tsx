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
  Sparkles,
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
  const [uploading, setUploading] = useState<boolean>(false)
  const [uploadSuccess, setUploadSuccess] = useState<{
    brand: string
    location: string
    count: number
  } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
    setStream((curr) => {
      curr?.getTracks().forEach((track) => track.stop())
      return null
    })
    setCameraActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is not supported on this browser or connection is not HTTPS.')
      return
    }

    try {
      // Stop any existing stream
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
      }

      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })

      setStream(media)
      setCameraActive(true)
    } catch (err) {
      console.error('Camera access error:', err)
      setCameraError('Camera permission denied or camera unavailable. Please allow camera access and try again.')
      setCameraActive(false)
    }
  }, [stream])

  // Attach stream to video tag
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    video.srcObject = stream
    const play = () => video.play().catch(() => null)
    if (video.readyState >= 1) play()
    else video.onloadedmetadata = play
  }, [stream])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [stream, photos])

  // Rapid snap photo with IST watermark & compression
  const snapPhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    setIsSnapping(true)

    const w = video.videoWidth || 1280
    const h = video.videoHeight || 960

    // Set canvas dimensions
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setIsSnapping(false)
      return
    }

    // Draw video frame
    ctx.drawImage(video, 0, 0, w, h)

    // Format IST Date & Time
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
    const barHeight = Math.max(34, Math.round(h * 0.06))
    const fontSize = Math.round(barHeight * 0.48)

    // Dark gradient bar at bottom
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.fillRect(0, h - barHeight, w, barHeight)

    // Brand accent line
    ctx.fillStyle = brandCfg?.accentColor || '#e11d48'
    ctx.fillRect(0, h - barHeight, Math.max(6, Math.round(w * 0.012)), barHeight)

    // Text overlay
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(watermarkText, Math.round(barHeight * 0.45), h - Math.round(barHeight / 2))

    // Compress to WebP / JPEG (quality 0.82)
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

        toast({
          title: `Photo ${photos.length + 1} Captured`,
          description: 'Added to your upload batch.',
        })
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
        title: 'No photos to upload',
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
      stopCamera()

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

  // Success view
  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 text-center space-y-6 shadow-2xl animate-in fade-in zoom-in duration-300">
          <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/30">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Showroom Photos Uploaded!
            </h2>
            <p className="text-slate-400 text-sm">
              <strong className="text-white font-semibold">{uploadSuccess.count} photos</strong> recorded for{' '}
              <span className="text-indigo-400 font-semibold">{uploadSuccess.brand}</span> ({uploadSuccess.location}).
            </p>
          </div>

          <div className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/60 text-left space-y-2 text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">Brand</span>
              <span className="font-semibold text-white">{uploadSuccess.brand}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Dealership Location</span>
              <span className="font-semibold text-white">{uploadSuccess.location}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Status</span>
              <span className="font-semibold text-emerald-400">Live in Dashboard</span>
            </div>
          </div>

          <Button
            onClick={() => setUploadSuccess(null)}
            className="w-full h-14 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base shadow-lg shadow-indigo-600/30"
          >
            <Camera className="w-5 h-5 mr-2" />
            Capture More Photos
          </Button>
        </div>
      </div>
    )
  }

  const activeBrandConfig = getShowroomBrandConfig(brand)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start pb-12">
      {/* Top Header */}
      <header className="w-full bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-3 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-white text-xs shadow"
            style={{ backgroundColor: activeBrandConfig?.accentColor || '#6366f1' }}
          >
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">Showroom Camera</h1>
            <p className="text-[10px] text-slate-400 font-medium">AM Group Live Capture</p>
          </div>
        </div>

        {photos.length > 0 && (
          <div className="flex items-center gap-1.5 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-2.5 py-1 rounded-full text-xs font-semibold">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>{photos.length} snapped</span>
          </div>
        )}
      </header>

      <main className="w-full max-w-lg px-4 pt-4 space-y-4">
        {/* Brand & Location Selector Card */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 space-y-3.5 shadow-lg">
          <div className="grid grid-cols-2 gap-3">
            {/* Brand Dropdown */}
            <div>
              <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <Building2 className="w-3 h-3 text-indigo-400" /> Brand
              </Label>
              <Select value={brand} onValueChange={(val) => handleBrandChange(val as ShowroomBrandKey)}>
                <SelectTrigger className="h-11 bg-slate-800 border-slate-700 text-white font-semibold text-xs rounded-xl focus:ring-indigo-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 text-white">
                  {SHOWROOM_BRANDS.map((b) => (
                    <SelectItem key={b.key} value={b.key} className="focus:bg-slate-700 text-xs font-medium">
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Location Dropdown */}
            <div>
              <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <MapPin className="w-3 h-3 text-emerald-400" /> Location
              </Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="h-11 bg-slate-800 border-slate-700 text-white font-semibold text-xs rounded-xl focus:ring-emerald-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 text-white">
                  {locations.map((loc) => (
                    <SelectItem key={loc} value={loc} className="focus:bg-slate-700 text-xs font-medium">
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Optional Uploader Name */}
          <div>
            <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
              <User className="w-3 h-3 text-slate-400" /> Person Uploading (Optional)
            </Label>
            <Input
              value={uploaderName}
              onChange={(e) => setUploaderName(e.target.value)}
              placeholder="e.g. Security / Showroom Manager"
              className="h-10 bg-slate-800 border-slate-700 text-white text-xs rounded-xl"
            />
          </div>
        </div>

        {/* Live Camera Viewfinder */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-black aspect-[4/3] shadow-2xl flex flex-col items-center justify-center">
          {/* Active Video */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover transition-opacity duration-200 ${
              cameraActive ? 'opacity-100' : 'opacity-0 hidden'
            }`}
          />

          {/* Idle / Error Overlay */}
          {!cameraActive && (
            <div className="p-6 text-center space-y-4 max-w-xs">
              {cameraError ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <p className="text-xs text-amber-300 font-medium leading-relaxed">{cameraError}</p>
                  <Button
                    type="button"
                    onClick={startCamera}
                    variant="outline"
                    className="rounded-xl border-slate-700 text-white hover:bg-slate-800 text-xs h-10"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try Again
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/30">
                    <Camera className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Ready to Capture</h3>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Camera-only mode: live shutter automatically stamps location &amp; IST time.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={startCamera}
                    className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs h-11 shadow-lg shadow-indigo-600/30"
                  >
                    <Camera className="w-4 h-4 mr-2" /> Start Live Camera
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Live Watermark Preview Strip */}
          {cameraActive && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 backdrop-blur-sm px-3 py-1.5 flex items-center justify-between text-[10px] font-bold text-white border-t border-white/10">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                LIVE · {activeBrandConfig?.label} · {location}
              </span>
              <span className="text-slate-400 font-mono text-[9px]">TIME-STAMPED</span>
            </div>
          )}

          {/* Flash animation on shutter */}
          {isSnapping && <div className="absolute inset-0 bg-white/70 animate-ping pointer-events-none" />}
        </div>

        {/* Hidden Canvas for watermark burning & compression */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Camera Control Buttons */}
        {cameraActive && (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={snapPhoto}
              disabled={isSnapping}
              className="flex-1 h-14 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-base shadow-lg shadow-rose-600/30 active:scale-95 transition-all"
            >
              <Camera className="w-5 h-5 mr-2" />
              {isSnapping ? 'Capturing…' : 'Snap Photo'}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={stopCamera}
              className="h-14 px-4 rounded-2xl border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            >
              Pause
            </Button>
          </div>
        )}

        {/* Snapped Photos Tray */}
        {photos.length > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                Captured Photos ({photos.length})
              </h3>
              <button
                type="button"
                onClick={() => {
                  photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
                  setPhotos([])
                }}
                className="text-[11px] text-rose-400 hover:text-rose-300 font-medium"
              >
                Clear all
              </button>
            </div>

            {/* Horizontal Scroll Thumbnail List */}
            <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin">
              {photos.map((photo, index) => (
                <div
                  key={photo.id}
                  className="relative group shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 shadow"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">
                    #{index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    className="absolute top-1 right-1 bg-rose-600/90 hover:bg-rose-700 text-white p-1 rounded-full shadow"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Submit All Photos Button */}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={uploading}
              className="w-full h-13 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 cursor-pointer"
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
