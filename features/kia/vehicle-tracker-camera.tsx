'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, RefreshCw, X, AlertTriangle, Upload, SwitchCamera, Sparkles, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CameraMode = 'idle' | 'live' | 'captured' | 'error'

async function compressImageFile(file: File, maxDim = 1280, quality = 0.75): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width: w, height: h } = img
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w)
          w = maxDim
        } else {
          w = Math.round((w * maxDim) / h)
          h = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          })
          resolve(compressedFile)
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

// Camera-first capture: opens the device camera via getUserMedia in a full-screen viewfinder,
// captures high-resolution frame, and burns a live IST timestamp into the image so the time is
// clearly visible on the photo. Emits a File to the parent.
export function VehicleTrackerCamera({
  label = 'Vehicle photo',
  onCapture,
  className,
  allowUpload = true,
}: {
  label?: string
  onCapture: (file: File | null) => void
  className?: string
  allowUpload?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [mode, setMode] = useState<CameraMode>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const stopStream = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop())
      return null
    })
  }, [])

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    clearPreview()
    stopStream()
    const compressed = await compressImageFile(rawFile, 1280, 0.75)
    const url = URL.createObjectURL(compressed)
    previewUrlRef.current = url
    setPreviewUrl(url)
    setMode('captured')
    onCapture(compressed)
  }

  const start = useCallback(async (facing: 'environment' | 'user' = facingMode) => {
    setError('')
    stopStream()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMode('error')
      setError('Camera is not available. Open this page over HTTPS on a device with a camera.')
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
      setStream(media)
      setMode('live')
    } catch {
      // Fallback without strict dimensions
      try {
        const mediaFallback = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        })
        setStream(mediaFallback)
        setMode('live')
      } catch {
        setMode('error')
        setError('Camera permission was blocked. Allow camera access in browser settings, then tap Try again.')
      }
    }
  }, [facingMode, stopStream])

  const toggleFacingMode = useCallback(() => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(nextFacing)
    if (mode === 'live') {
      start(nextFacing)
    }
  }, [facingMode, mode, start])

  // Attach the stream to the <video> whenever stream or mode changes
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    video.srcObject = stream
    const play = () => video.play().catch(() => null)
    if (video.readyState >= 1) play()
    else video.onloadedmetadata = play
    return () => {
      video.onloadedmetadata = null
    }
  }, [stream, mode])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    let rawW = video.videoWidth || 1280
    let rawH = video.videoHeight || 720
    const maxDim = 1280
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
    if (!ctx) return
    ctx.drawImage(video, 0, 0, rawW, rawH)

    // Burn a clearly-visible timestamp into the bottom of the frame
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
    const text = `AM KIA  ·  ${stamp} IST`
    const barH = Math.max(28, Math.round(rawH * 0.05))
    const fontPx = Math.round(barH * 0.52)
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(0, rawH - barH, rawW, barH)
    ctx.fillStyle = '#e11d48'
    ctx.fillRect(0, rawH - barH, Math.max(5, Math.round(rawW * 0.008)), barH)
    ctx.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, Math.round(barH * 0.4), rawH - Math.round(barH / 2))

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        previewUrlRef.current = url
        setPreviewUrl(url)
        stopStream()
        setMode('captured')
        onCapture(file)
      },
      'image/jpeg',
      0.75,
    )
  }, [onCapture, stopStream])

  useEffect(() => {
    return () => {
      setStream((current) => {
        current?.getTracks().forEach((track) => track.stop())
        return null
      })
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  // Full screen camera overlay rendered in portal
  const fullScreenOverlay = mode === 'live' && mounted ? createPortal(
    <div
      data-radix-portal=""
      className="fixed inset-0 z-[999999] bg-black flex flex-col justify-between select-none overflow-hidden pointer-events-auto animate-in fade-in duration-200"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Live Video element taking 100% full screen */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover pointer-events-none"
      />

      {/* Top Header Bar */}
      <div className="relative z-50 flex items-center justify-between p-4 sm:p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-md border border-white/20 text-white">
            <Camera className="h-5 w-5 text-indigo-400 pointer-events-none" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white drop-shadow-sm">{label}</h3>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              LIVE · Full Screen Viewfinder
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            stopStream()
            setMode('idle')
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-md border border-white/20 text-white hover:bg-black/70 active:scale-95 transition-all pointer-events-auto"
          aria-label="Close Camera"
        >
          <X className="h-6 w-6 pointer-events-none" />
        </button>
      </div>

      {/* Bottom Controls Bar */}
      <div className="relative z-50 flex items-center justify-around p-6 sm:pb-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-auto">
        {/* Flip / Switch Camera Button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggleFacingMode()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer flex flex-col items-center gap-1 text-white/80 hover:text-white active:scale-90 transition-transform pointer-events-auto"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur-md border border-white/20 pointer-events-none">
            <SwitchCamera className="h-5 w-5" />
          </div>
          <span className="text-[10px] font-semibold pointer-events-none">Flip</span>
        </button>

        {/* Big Shutter Capture Button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            capture()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer group relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-transparent active:scale-90 transition-all shadow-[0_0_20px_rgba(255,255,255,0.4)] pointer-events-auto"
          aria-label="Capture Photo"
        >
          <div className="h-16 w-16 rounded-full bg-white group-hover:bg-slate-100 group-active:scale-95 transition-all shadow-inner pointer-events-none" />
        </button>

        {/* Upload Fallback Button */}
        {allowUpload ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              fileInputRef.current?.click()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="cursor-pointer flex flex-col items-center gap-1 text-white/80 hover:text-white active:scale-90 transition-transform pointer-events-auto"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur-md border border-white/20 pointer-events-none">
              <Upload className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-semibold pointer-events-none">Gallery</span>
          </button>
        ) : (
          <div className="w-12" />
        )}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className={cn('space-y-2', className)}>
      {fullScreenOverlay}

      {/* Inline Preview / Trigger Card */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 min-h-[160px] flex items-center justify-center">
        {mode === 'captured' && previewUrl ? (
          <div className="relative h-48 w-full group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Captured preview" className="h-full w-full object-cover rounded-xl" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => start()}
                className="bg-white/90 text-slate-900 font-bold hover:bg-white text-xs shadow"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retake
              </Button>
            </div>
            <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow">
              <Check className="h-3 w-3" /> Captured
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => start()}
            className="flex h-full w-full min-h-[160px] flex-col items-center justify-center gap-2.5 p-6 text-center text-slate-600 hover:bg-indigo-50/50 hover:text-indigo-600 transition-all group"
          >
            {mode === 'error' ? (
              <AlertTriangle className="h-10 w-10 text-amber-500" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                <Camera className="h-6 w-6" />
              </div>
            )}
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                {mode === 'error' ? 'Camera Access Issue' : `Open Full-Screen Camera`}
              </p>
              <p className="text-[11px] text-slate-500 max-w-[240px]">
                {mode === 'error' ? error : `Tap to open full-screen camera to capture crisp ${label.toLowerCase()}`}
              </p>
            </div>
          </button>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      {allowUpload ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(mode === 'captured' || mode === 'error') && (
          <Button
            type="button"
            variant="outline"
            onClick={() => start()}
            className="h-10 flex-1 rounded-xl font-bold text-xs"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {mode === 'error' ? 'Try camera again' : 'Retake with Full-Screen Camera'}
          </Button>
        )}
        {allowUpload && (mode === 'idle' || mode === 'error' || mode === 'captured') && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-slate-500 hover:text-slate-800 font-medium"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {mode === 'captured' ? 'Upload different file' : 'Or choose photo from gallery'}
          </Button>
        )}
      </div>
    </div>
  )
}

