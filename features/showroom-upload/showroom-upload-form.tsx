'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Building2,
  MapPin,
  User,
  ShieldCheck,
  AlertTriangle,
  Tv,
  Car,
  Droplets,
  Check,
  Briefcase,
  Wrench,
  Lock,
  X,
  SwitchCamera,
  Upload,
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

export type SlotDefinition = {
  key: string
  category: ShowroomCategoryKey
  categoryLabel: string
  slotNumber: number
  title: string
  subtitle: string
  icon: typeof Car | typeof Wrench | typeof Tv | typeof Droplets | typeof Presentation | typeof Armchair
}

export function getSlotDefinitions(dept: ShowroomDepartmentKey = 'sales'): SlotDefinition[] {
  const isService = dept === 'service'

  if (isService) {
    return [
      {
        key: 'vehicles_1',
        category: 'vehicles',
        categoryLabel: 'Workshop Bays',
        slotNumber: 1,
        title: 'Service Bay #1',
        subtitle: 'Active service bay / repair area',
        icon: Wrench,
      },
      {
        key: 'vehicles_2',
        category: 'vehicles',
        categoryLabel: 'Workshop Bays',
        slotNumber: 2,
        title: 'Service Bay #2',
        subtitle: 'Workshop floor / inspection hoist',
        icon: Wrench,
      },
      {
        key: 'vehicles_3',
        category: 'vehicles',
        categoryLabel: 'Workshop Bays',
        slotNumber: 3,
        title: 'Service Bay #3',
        subtitle: 'Customer reception / service delivery',
        icon: Wrench,
      },
      {
        key: 'tv_1',
        category: 'tv',
        categoryLabel: 'TV Display',
        slotNumber: 1,
        title: 'TV Screen #1',
        subtitle: 'Customer waiting lounge TV screen',
        icon: Tv,
      },
      {
        key: 'lounge_1',
        category: 'lounge',
        categoryLabel: 'Customer Lounge',
        slotNumber: 1,
        title: 'Customer Lounge #1',
        subtitle: 'Customer waiting lounge & seating area',
        icon: Armchair,
      },
      {
        key: 'bathroom_1',
        category: 'bathroom',
        categoryLabel: 'Washroom',
        slotNumber: 1,
        title: 'Washroom #1',
        subtitle: 'Service & customer washroom cleanliness',
        icon: Droplets,
      },
    ]
  }

  // Sales Showroom
  return [
    {
      key: 'vehicles_1',
      category: 'vehicles',
      categoryLabel: 'Display Vehicles',
      slotNumber: 1,
      title: 'Vehicle #1',
      subtitle: 'Display floor vehicle (Angle 1)',
      icon: Car,
    },
    {
      key: 'vehicles_2',
      category: 'vehicles',
      categoryLabel: 'Display Vehicles',
      slotNumber: 2,
      title: 'Vehicle #2',
      subtitle: 'Display floor vehicle (Angle 2)',
      icon: Car,
    },
    {
      key: 'vehicles_3',
      category: 'vehicles',
      categoryLabel: 'Display Vehicles',
      slotNumber: 3,
      title: 'Vehicle #3',
      subtitle: 'Display floor vehicle (Angle 3)',
      icon: Car,
    },
    {
      key: 'tv_1',
      category: 'tv',
      categoryLabel: 'TV Display',
      slotNumber: 1,
      title: 'TV Screen #1',
      subtitle: 'Customer lounge / display TV screen',
      icon: Tv,
    },
    {
      key: 'standee_1',
      category: 'standee',
      categoryLabel: 'Standee',
      slotNumber: 1,
      title: 'Standee #1',
      subtitle: 'Showroom promotional / model standee',
      icon: Presentation,
    },
    {
      key: 'bathroom_1',
      category: 'bathroom',
      categoryLabel: 'Washroom',
      slotNumber: 1,
      title: 'Washroom #1',
      subtitle: 'Showroom washroom cleanliness',
      icon: Droplets,
    },
  ]
}

interface ShowroomUploadFormProps {
  brand: ShowroomBrandKey
  location: string
  department: ShowroomDepartmentKey
}

export function ShowroomUploadForm({
  brand,
  location,
  department,
}: ShowroomUploadFormProps) {
  const brandConfig = useMemo(() => getShowroomBrandConfig(brand), [brand])

  const [uploaderName, setUploaderName] = useState<string>('')

  // Slot-based captured photos: map slotKey -> SnappedPhoto
  const [slotPhotos, setSlotPhotos] = useState<Record<string, SnappedPhoto>>({})
  const [activeSlotKey, setActiveSlotKey] = useState<string>('vehicles_1')

  // Full-screen camera state
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [cameraError, setCameraError] = useState<string>('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isSnapping, setIsSnapping] = useState<boolean>(false)
  const [flashEffect, setFlashEffect] = useState<boolean>(false)
  const [uploading, setUploading] = useState<boolean>(false)
  const [mounted, setMounted] = useState<boolean>(false)
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const targetSlotKeyForFileRef = useRef<string>('vehicles_1')

  slotPhotosRef.current = slotPhotos

  useEffect(() => {
    setMounted(true)
  }, [])

  const slotDefinitions = useMemo(() => getSlotDefinitions(department), [department])

  const activeSlot = useMemo(() => {
    return slotDefinitions.find((s) => s.key === activeSlotKey) || slotDefinitions[0]
  }, [slotDefinitions, activeSlotKey])

  const totalCaptured = Object.keys(slotPhotos).length

  const safeBrand: ShowroomBrandKey = brand || 'kia'
  const safeLocation: string = location || 'Jammu'
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setStream(null)
  }, [])

  const startCamera = useCallback(
    async (facing: 'environment' | 'user' = facingMode) => {
      setCameraError('')
      stopStream()
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Live camera requires HTTPS or is unsupported by your browser. Please tap Gallery below to choose or take a photo.'
        )
        return
      }

      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          },
          audio: false,
        })
        streamRef.current = media
        setStream(media)
      } catch {
        try {
          const mediaFallback = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing } },
            audio: false,
          })
          streamRef.current = mediaFallback
          setStream(mediaFallback)
        } catch (err) {
          console.warn('Camera access denied:', err)
          setCameraError(
            'Camera permission was blocked. Allow camera access in browser settings, or use the file upload option.'
          )
        }
      }
    },
    [facingMode, stopStream]
  )

  const openFullscreenCamera = (slotKey?: string) => {
    if (slotKey) {
      setActiveSlotKey(slotKey)
    }
    setIsCameraOpen(true)
    startCamera(facingMode)
  }

  const closeFullscreenCamera = () => {
    stopStream()
    setIsCameraOpen(false)
  }

  const toggleFacingMode = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    startCamera(next)
  }

  // Attach stream to video tag whenever active
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream || !isCameraOpen) return
    video.srcObject = stream
    const play = () => video.play().catch(() => null)
    if (video.readyState >= 1) play()
    else video.onloadedmetadata = play
  }, [stream, isCameraOpen])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      Object.values(slotPhotosRef.current).forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  // Process & Watermark Photo into Slot
  const saveProcessedPhoto = useCallback(
    (canvas: HTMLCanvasElement, targetSlot: SlotDefinition) => {
      canvas.toBlob(
        (blob) => {
          setIsSnapping(false)
          if (!blob) return

          const id = crypto.randomUUID()
          const previewUrl = URL.createObjectURL(blob)

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

          // Revoke old blob URL if existing in slot
          const existing = slotPhotos[targetSlot.key]
          if (existing) URL.revokeObjectURL(existing.previewUrl)

          const newPhoto: SnappedPhoto = {
            id,
            blob,
            previewUrl,
            timestamp: stamp,
            category: targetSlot.category,
            slot: targetSlot.slotNumber,
          }

          setSlotPhotos((prev) => ({
            ...prev,
            [targetSlot.key]: newPhoto,
          }))

          // Find next empty slot
          const currentIdx = slotDefinitions.findIndex((s) => s.key === targetSlot.key)
          const nextEmpty =
            slotDefinitions.find((s, idx) => idx > currentIdx && !slotPhotos[s.key]) ||
            slotDefinitions.find((s) => !slotPhotos[s.key] && s.key !== targetSlot.key)

          if (nextEmpty) {
            setActiveSlotKey(nextEmpty.key)
            toast({
              title: `${targetSlot.title} Saved`,
              description: `Now capturing ${nextEmpty.title} (${nextEmpty.categoryLabel})`,
            })
          } else {
            // All 6 captured!
            closeFullscreenCamera()
            toast({
              title: 'All 6 Photos Captured!',
              description: 'You can now review your inspection photos and tap Upload.',
            })
          }
        },
        'image/jpeg',
        0.82
      )
    },
    [slotDefinitions, slotPhotos]
  )

  // Snap photo from full-screen live video
  const snapLivePhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current || document.createElement('canvas')
    if (!video || !activeSlot) return

    setIsSnapping(true)
    setFlashEffect(true)
    setTimeout(() => setFlashEffect(false), 140)

    let rawW = video.videoWidth || 1280
    let rawH = video.videoHeight || 960
    const maxDim = 1600

    if (rawW > maxDim || rawH > maxDim) {
      if (rawW > rawH) {
        rawH = Math.round((rawH * maxDim) / rawW)
        rawW = maxDim
      } else {
        rawW = Math.round((rawW * maxDim) / rawH)
        rawH = maxDim
      }
    }

    canvas.width = rawW
    canvas.height = rawH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setIsSnapping(false)
      return
    }

    ctx.drawImage(video, 0, 0, rawW, rawH)

    // Burn Official Watermark
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

    const brandCfg = getShowroomBrandConfig(safeBrand)
    const brandLabel = brandCfg?.label || safeBrand.toUpperCase()
    const deptLabel = department.toUpperCase()
    const catLabel = activeSlot.categoryLabel.toUpperCase()
    const watermarkText = `${brandLabel.toUpperCase()} · ${safeLocation.toUpperCase()} · ${deptLabel} · ${catLabel} #${activeSlot.slotNumber} · ${stamp} IST`

    const barHeight = Math.max(34, Math.round(rawH * 0.052))
    const fontSize = Math.round(barHeight * 0.44)

    // Dark bar background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.fillRect(0, rawH - barHeight, rawW, barHeight)

    // Accent strip
    ctx.fillStyle = '#055B65'
    ctx.fillRect(0, rawH - barHeight, Math.max(6, Math.round(rawW * 0.01)), barHeight)

    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(watermarkText, Math.round(barHeight * 0.4), rawH - Math.round(barHeight / 2))

    saveProcessedPhoto(canvas, activeSlot)
  }

  // Trigger Native File Input
  const triggerNativeCamera = (slotKey?: string) => {
    const keyToUse = slotKey || activeSlotKey
    setActiveSlotKey(keyToUse)
    targetSlotKeyForFileRef.current = keyToUse
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  // Process file/gallery capture
  const handleNativeCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const slotKey = targetSlotKeyForFileRef.current || activeSlotKey
    const targetSlot = slotDefinitions.find((s) => s.key === slotKey) || activeSlot

    setIsSnapping(true)

    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = canvasRef.current || document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setIsSnapping(false)
        return
      }

      const maxDim = 1600
      let w = img.naturalWidth || img.width
      let h = img.naturalHeight || img.height

      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w)
          w = maxDim
        } else {
          w = Math.round((w * maxDim) / h)
          h = maxDim
        }
      }

      canvas.width = w
      canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)

      // Burn Watermark
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

      const brandCfg = getShowroomBrandConfig(safeBrand)
      const brandLabel = brandCfg?.label || safeBrand.toUpperCase()
      const deptLabel = department.toUpperCase()
      const catLabel = targetSlot.categoryLabel.toUpperCase()
      const watermarkText = `${brandLabel.toUpperCase()} · ${safeLocation.toUpperCase()} · ${deptLabel} · ${catLabel} #${targetSlot.slotNumber} · ${stamp} IST`

      const barHeight = Math.max(34, Math.round(h * 0.052))
      const fontSize = Math.round(barHeight * 0.44)

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
      ctx.fillRect(0, h - barHeight, w, barHeight)

      ctx.fillStyle = '#055B65'
      ctx.fillRect(0, h - barHeight, Math.max(6, Math.round(w * 0.01)), barHeight)

      ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(watermarkText, Math.round(barHeight * 0.4), h - Math.round(barHeight / 2))

      saveProcessedPhoto(canvas, targetSlot)
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      setIsSnapping(false)
      toast({
        title: 'Image Error',
        description: 'Failed to process camera capture. Please try again.',
        variant: 'error',
      })
    }

    img.src = objectUrl
  }

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
        description: 'Please capture at least one showroom photo before submitting.',
        variant: 'error',
      })
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('brand', safeBrand)
      formData.append('location', safeLocation)
      formData.append('department', department)
      if (uploaderName.trim()) {
        formData.append('uploaderName', uploaderName.trim())
      }

      const manifest: Array<{ category: string; slot: number }> = []

      photosToUpload.forEach((p, idx) => {
        const file = new File(
          [p.blob],
          `showroom_${p.category}_${p.slot}_${Date.now()}_${idx + 1}.jpg`,
          { type: 'image/jpeg' }
        )
        formData.append('photos', file)
        manifest.push({ category: p.category, slot: p.slot })
      })

      formData.append('manifest', JSON.stringify(manifest))

      let res: Response | null = null
      let lastErr: unknown = null

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 45000)

          res = await fetch('/api/showroom-upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          })

          clearTimeout(timeoutId)
          if (res.ok) break
        } catch (fetchErr) {
          lastErr = fetchErr
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1200))
          }
        }
      }

      if (!res) {
        throw new Error(
          lastErr instanceof Error
            ? lastErr.message
            : 'Network connection was interrupted. Please tap Upload again.'
        )
      }

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || 'Upload failed. Please check connection and try again.')
      }

      photosToUpload.forEach((p) => URL.revokeObjectURL(p.previewUrl))

      setUploadSuccess({
        brand: getShowroomBrandConfig(safeBrand)?.label || safeBrand,
        location: safeLocation,
        department: department === 'service' ? 'Service' : 'Sales',
        count: photosToUpload.length,
      })

      setSlotPhotos({})
    } catch (err) {
      toast({
        title: 'Upload Failed',
        description:
          err instanceof Error ? err.message : 'Could not upload photos. Please try again.',
        variant: 'error',
      })
    } finally {
      setUploading(false)
    }
  }

  // Full-Screen Camera Portal
  const fullScreenCameraOverlay =
    isCameraOpen && mounted
      ? createPortal(
          <div
            data-radix-portal=""
            className="fixed inset-0 z-[999999] bg-black flex flex-col justify-between select-none overflow-hidden animate-in fade-in duration-200"
          >
            {/* Live Video Element */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            />

            {/* Camera Flash overlay */}
            {flashEffect && (
              <div className="absolute inset-0 bg-white/80 pointer-events-none transition-opacity duration-100 z-30" />
            )}

            {/* Top Bar Overlay */}
            <div className="relative z-40 flex items-center justify-between p-4 sm:p-6 bg-gradient-to-b from-black/85 via-black/40 to-transparent">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/60 backdrop-blur-md border border-white/20 text-white shadow-sm">
                  <activeSlot.icon className="h-5 w-5 text-teal-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-white drop-shadow-sm">
                      {activeSlot.title}
                    </h3>
                    <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-mono font-bold">
                      {activeSlot.categoryLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    LIVE VIEW · {safeBrand.toUpperCase()} · {safeLocation}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeFullscreenCamera}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-black/80 active:scale-95 transition-all cursor-pointer"
                aria-label="Close Camera"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Center Error Banner if Camera is blocked */}
            {cameraError && (
              <div className="relative z-40 mx-6 p-4 rounded-2xl bg-black/80 backdrop-blur-md border border-amber-500/40 text-white text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                <p className="text-xs font-medium text-slate-200">{cameraError}</p>
                <Button
                  onClick={() => triggerNativeCamera(activeSlotKey)}
                  className="bg-white text-slate-900 font-bold text-xs h-10 rounded-xl"
                >
                  <Upload className="w-4 h-4 mr-1.5" /> Choose from Gallery / Files
                </Button>
              </div>
            )}

            {/* Bottom Controls Bar */}
            <div className="relative z-40 flex items-center justify-around p-6 sm:pb-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
              {/* Flip Camera */}
              <button
                type="button"
                onClick={toggleFacingMode}
                className="cursor-pointer flex flex-col items-center gap-1 text-white/80 hover:text-white active:scale-90 transition-transform"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur-md border border-white/20">
                  <SwitchCamera className="h-5 w-5 text-white" />
                </div>
                <span className="text-[10px] font-semibold">Flip</span>
              </button>

              {/* Big Shutter Button */}
              <button
                type="button"
                onClick={snapLivePhoto}
                disabled={isSnapping}
                className="cursor-pointer group relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-transparent active:scale-90 transition-all shadow-[0_0_25px_rgba(255,255,255,0.4)]"
                aria-label="Capture Photo"
              >
                <div className="h-16 w-16 rounded-full bg-white group-hover:bg-slate-100 group-active:scale-95 transition-all shadow-inner" />
              </button>

              {/* Gallery / File Picker */}
              <button
                type="button"
                onClick={() => triggerNativeCamera(activeSlotKey)}
                className="cursor-pointer flex flex-col items-center gap-1 text-white/80 hover:text-white active:scale-90 transition-transform"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur-md border border-white/20">
                  <Upload className="h-5 w-5 text-white" />
                </div>
                <span className="text-[10px] font-semibold">Gallery</span>
              </button>
            </div>
          </div>,
          document.body
        )
      : null

  // Success Receipt
  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200/90 shadow-lg p-6 sm:p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-[#055B65] text-white flex items-center justify-center mx-auto shadow-md">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Photos Uploaded Successfully
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm">
              <strong className="text-slate-800 font-semibold">{uploadSuccess.count} photos</strong>{' '}
              recorded under{' '}
              <strong className="text-[#055B65] font-semibold">{uploadSuccess.department}</strong>{' '}
              for <strong className="text-slate-900 font-semibold">{uploadSuccess.brand}</strong> (
              {uploadSuccess.location}).
            </p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2.5 text-xs text-slate-600">
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
              <span className="font-bold text-[#055B65] bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                {uploadSuccess.department}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Photos Recorded</span>
              <span className="font-semibold text-slate-900">
                {uploadSuccess.count} Live Images
              </span>
            </div>
          </div>

          <Button
            onClick={() => {
              setUploadSuccess(null)
            }}
            className="w-full h-12 rounded-xl bg-[#055B65] hover:bg-[#044850] text-white font-semibold text-sm shadow-sm transition-all cursor-pointer"
          >
            <Camera className="w-4 h-4 mr-2" />
            Capture More Showroom Photos
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col items-center justify-start pb-20">
      {fullScreenCameraOverlay}

      {/* Hidden File Input for Native / Gallery fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleNativeCameraCapture}
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="w-full bg-white border-b border-slate-200/90 px-4 sm:px-6 py-3.5 sticky top-0 z-30 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#055B65] text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
            <Building2 className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
              Showroom Camera Inspection
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">
              AM Group Official Cleanliness & Display Check
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
            {department}
          </span>
          <div className="flex items-center gap-1.5 bg-[#055B65] text-white px-3 py-1 rounded-full text-xs font-bold shadow-2xs">
            <span>{totalCaptured}/6 Snapped</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-lg px-4 pt-4 sm:pt-6 space-y-4">
        {/* Dealership & Department Strictly Locked Card */}
        <div className="bg-white border border-teal-200/90 rounded-2xl p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#055B65] uppercase tracking-wider bg-teal-50 px-2.5 py-1 rounded-full border border-teal-200">
              <Lock className="w-3 h-3" /> Branch Locked via URL / QR
            </span>
            <span className="text-[11px] font-bold text-slate-700 uppercase">
              {department} Department
            </span>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-base font-bold text-slate-900">
                {brandConfig?.label || brand.toUpperCase()}
              </p>
              <p className="text-xs text-slate-500 font-medium flex items-center gap-1 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                {location} Dealership
              </p>
            </div>
            <a
              href="/showroom-upload"
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2"
            >
              Change Branch
            </a>
          </div>

          {/* Inspected By Name */}
          <div className="pt-2 border-t border-slate-100">
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
              <User className="w-3 h-3 text-slate-400" /> Inspected By (Optional)
            </Label>
            <Input
              value={uploaderName}
              onChange={(e) => setUploaderName(e.target.value)}
              placeholder="e.g. Showroom Manager / Floor Lead"
              className="h-9.5 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl"
            />
          </div>
        </div>

        {/* Guided Category Counts Checklist */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Required Inspection Slots (6 Photos)
            </span>
            <span className="text-[11px] text-[#055B65] font-bold">
              {department === 'service'
                ? '3 Workshop Bays · 1 TV · 1 Lounge · 1 Washroom'
                : '3 Vehicles · 1 TV · 1 Standee · 1 Washroom'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SHOWROOM_CATEGORIES.filter((cat) => {
              if (cat.key === 'standee') return department === 'sales'
              if (cat.key === 'lounge') return department === 'service'
              return true
            }).map((cat) => {
              const catSlots = slotDefinitions.filter((s) => s.category === cat.key)
              const countCaptured = catSlots.filter((s) => Boolean(slotPhotos[s.key])).length
              const isComplete = countCaptured === cat.slotCount
              const isCurrentCat = activeSlot.category === cat.key
              const catLabel =
                cat.key === 'vehicles' && department === 'service'
                  ? 'Workshop Bays'
                  : cat.label

              return (
                <div
                  key={cat.key}
                  className={`p-2.5 rounded-2xl border transition-all text-left ${
                    isCurrentCat
                      ? 'bg-teal-50/70 border-teal-400 shadow-2xs ring-1 ring-teal-300'
                      : isComplete
                      ? 'bg-emerald-50/60 border-emerald-300 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold truncate">{catLabel}</span>
                    {isComplete ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500">
                        {countCaptured}/{cat.slotCount}
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
                          onClick={() => {
                            setActiveSlotKey(slot.key)
                          }}
                          className={`flex-1 py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-0.5 ${
                            isTarget
                              ? 'bg-[#055B65] text-white shadow-2xs'
                              : hasPhoto
                              ? 'bg-emerald-600 text-white'
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

        {/* Primary Fullscreen Camera Launcher Action Banner */}
        <div className="bg-white border-2 border-teal-600/30 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-left w-full sm:w-auto">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 text-[#055B65] border border-teal-200 flex items-center justify-center shrink-0">
              <activeSlot.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900 leading-tight flex items-center gap-1.5">
                <span>Capturing {activeSlot.title}</span>
                <span className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.2 rounded-full font-mono">
                  {activeSlot.categoryLabel}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                {activeSlot.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              onClick={() => openFullscreenCamera(activeSlotKey)}
              className="flex-1 sm:flex-initial h-11 px-5 rounded-xl bg-[#055B65] hover:bg-[#044850] text-white font-bold text-xs shadow-sm cursor-pointer flex items-center justify-center gap-2"
            >
              <Camera className="w-4 h-4" />
              Open Full-Screen Camera
            </Button>
          </div>
        </div>

        {/* 6 Structured Photo Slots Grid */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-slate-600" />
              Inspection Photos ({totalCaptured}/6)
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
            {slotDefinitions.map((slot) => {
              const photo = slotPhotos[slot.key]
              const isSelected = activeSlotKey === slot.key

              return (
                <div
                  key={slot.key}
                  onClick={() => {
                    setActiveSlotKey(slot.key)
                    if (!photo) {
                      openFullscreenCamera(slot.key)
                    }
                  }}
                  className={`relative rounded-2xl border p-2.5 transition-all cursor-pointer flex flex-col justify-between min-h-[140px] ${
                    isSelected
                      ? 'border-[#055B65] bg-teal-50/40 shadow-2xs ring-2 ring-teal-200'
                      : photo
                      ? 'border-slate-200 bg-white'
                      : 'border-slate-200 bg-slate-50/80 hover:bg-slate-100/80'
                  }`}
                >
                  {photo ? (
                    <div className="relative w-full h-22 rounded-xl overflow-hidden mb-2 bg-slate-900 shadow-2xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.previewUrl}
                        alt={slot.title}
                        className="w-full h-full object-cover"
                      />

                      <span className="absolute top-1 left-1 bg-black/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                        {slot.title}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          clearSlot(slot.key)
                        }}
                        aria-label={`Remove ${slot.title}`}
                        className="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white p-1 rounded-full shadow-xs transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-full h-22 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 mb-2 bg-white">
                      <slot.icon className="w-5 h-5 mb-1 text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-600">Tap to Snap</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-left pt-0.5">
                    <div className="truncate pr-1">
                      <p className="text-xs font-bold text-slate-900 leading-tight truncate">
                        {slot.title}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {slot.categoryLabel}
                      </p>
                    </div>

                    {photo ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : isSelected ? (
                      <span className="w-2 h-2 rounded-full bg-[#055B65] animate-ping shrink-0" />
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Submit Action */}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={uploading || totalCaptured === 0}
            className="w-full h-12 rounded-xl bg-[#055B65] hover:bg-[#044850] text-white font-bold text-sm shadow-sm cursor-pointer transition-all mt-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading {totalCaptured}{' '}
                Photos…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 mr-2" /> Upload {totalCaptured}{' '}
                {department === 'sales' ? 'Sales' : 'Service'} Photos
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  )
}



