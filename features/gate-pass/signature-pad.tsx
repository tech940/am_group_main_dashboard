'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SignaturePadLib from 'signature_pad'
import { RotateCcw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Digital signature capture.
 *
 * Deliberately the SAME contract as VehicleTrackerCamera — `onCapture(file: File | null)` — so the
 * guard form treats a signature and a photo identically and there is one upload path, not two.
 *
 * ── Why a library and not a hand-rolled canvas ────────────────────────────────────────────────
 * The camera in this repo is hand-rolled because getUserMedia has no good wrapper. Signatures do,
 * and the parts a hand-roll gets wrong are exactly the parts that matter on a cheap Android phone
 * at a gate: the devicePixelRatio backing store (without it the stroke is blurry and lands offset
 * from the finger), touch-action (without it every stroke scrolls the page on iOS), and pointer
 * coalescing (without it the line is a visible polygon).
 */
export function GateSignaturePad({
  label = 'Signature',
  onCapture,
  className,
}: {
  label?: string
  onCapture: (file: File | null) => void
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePadLib | null>(null)
  const [signed, setSigned] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  /**
   * Size the backing store to the device pixel ratio, and rescale on resize/rotate.
   * Resizing a canvas clears it, so a signature in progress is discarded and the state reset —
   * silently keeping a half-erased stroke would be worse than asking for it again.
   */
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)
    padRef.current?.clear()
    setSigned(false)
    setConfirmed(false)
    onCapture(null)
  }, [onCapture])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const pad = new SignaturePadLib(canvas, {
      penColor: '#0f172a',
      backgroundColor: 'rgba(255,255,255,1)',
      minWidth: 0.8,
      maxWidth: 2.4,
    })
    padRef.current = pad
    pad.addEventListener('endStroke', () => setSigned(!pad.isEmpty()))
    resize()

    window.addEventListener('resize', resize)
    window.addEventListener('orientationchange', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', resize)
      pad.off()
      padRef.current = null
    }
    // resize is stable via useCallback; re-running this would tear down a live signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    padRef.current?.clear()
    setSigned(false)
    setConfirmed(false)
    onCapture(null)
  }

  const confirm = () => {
    const canvas = canvasRef.current
    const pad = padRef.current
    if (!canvas || !pad || pad.isEmpty()) return
    canvas.toBlob((blob) => {
      if (!blob) return
      onCapture(new File([blob], 'signature.png', { type: 'image/png' }))
      setConfirmed(true)
    }, 'image/png')
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {confirmed ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Captured
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          /* touch-action:none is load-bearing — without it a stroke scrolls the page on iOS. */
          className="h-40 w-full touch-none rounded-lg"
          aria-label={label}
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!signed && !confirmed}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={!signed || confirmed}>
          Use this signature
        </Button>
      </div>
    </div>
  )
}
