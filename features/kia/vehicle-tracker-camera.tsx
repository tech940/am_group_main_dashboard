'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CameraMode = 'idle' | 'live' | 'captured' | 'error'

// Camera-only capture: opens the device camera via getUserMedia (no gallery/file
// picker is offered), captures a frame, and burns a live IST timestamp into the
// image so the time is clearly visible on the photo. Emits a File to the parent.
export function VehicleTrackerCamera({
  label = 'Vehicle photo',
  onCapture,
  className,
}: {
  label?: string
  onCapture: (file: File | null) => void
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [mode, setMode] = useState<CameraMode>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

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

  const start = useCallback(async () => {
    setError('')
    onCapture(null)
    clearPreview()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMode('error')
      setError('Camera is not available. Open this page over HTTPS on a device with a camera.')
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      setStream(media)
      setMode('live')
    } catch {
      setMode('error')
      setError('Camera permission was blocked. Allow camera access, then tap Try again.')
    }
  }, [onCapture, clearPreview])

  // Attach the stream to the <video> after it mounts (fixes the black-screen race).
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
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 960
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)

    // Burn a clearly-visible timestamp into the bottom of the frame.
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
    const barH = Math.max(30, Math.round(h * 0.06))
    const fontPx = Math.round(barH * 0.5)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, h - barH, w, barH)
    ctx.fillStyle = '#e11d48'
    ctx.fillRect(0, h - barH, Math.max(4, Math.round(w * 0.01)), barH)
    ctx.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, Math.round(barH * 0.4), h - Math.round(barH / 2))

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `vehicle_${Date.now()}.jpg`, { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        previewUrlRef.current = url
        setPreviewUrl(url)
        stopStream()
        setMode('captured')
        onCapture(file)
      },
      'image/jpeg',
      0.9,
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

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-black aspect-[4/3]">
        {/* Video stays mounted while live so the ref is stable for the attach effect. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn('h-full w-full object-cover', mode === 'live' ? 'block' : 'hidden')}
        />
        {mode === 'captured' && previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Captured vehicle" className="h-full w-full object-cover" />
        )}
        {(mode === 'idle' || mode === 'error') && (
          <button
            type="button"
            onClick={start}
            className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-white/80"
          >
            {mode === 'error' ? <AlertTriangle className="h-9 w-9 text-amber-400" /> : <Camera className="h-9 w-9" />}
            <span className="text-sm font-semibold">
              {mode === 'error' ? error : `Tap to open the camera and capture the ${label.toLowerCase()}`}
            </span>
          </button>
        )}
        {mode === 'live' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/50 px-3 py-1.5 text-[11px] font-bold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> LIVE · time is stamped on capture
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-2">
        {mode === 'live' && (
          <>
            <Button type="button" onClick={capture} className="h-12 flex-1 rounded-xl text-base font-bold">
              <Camera className="mr-2 h-5 w-5" /> Capture
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { stopStream(); setMode('idle') }}
              className="h-12 rounded-xl px-4"
            >
              <X className="h-5 w-5" />
            </Button>
          </>
        )}
        {(mode === 'captured' || mode === 'error') && (
          <Button type="button" variant="outline" onClick={start} className="h-11 flex-1 rounded-xl font-bold">
            <RefreshCw className="mr-2 h-4 w-4" /> {mode === 'error' ? 'Try again' : 'Retake'}
          </Button>
        )}
      </div>
    </div>
  )
}
