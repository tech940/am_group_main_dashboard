'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Fuel,
  FileText,
  Gauge,
  IndianRupee,
  Calendar,
  CheckCircle2,
  ZoomIn,
  X,
  Edit3,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatIndiaDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'

type FuelProofViewerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pass: {
    id: string
    passNo: string
    driverName: string
    registrationNumber: string | null
    model: string | null
    fuelAmount?: string | number | null
    fuelLitres?: string | number | null
    fuelSlipPath?: string | null
    pumpStartPath?: string | null
    pumpStopPath?: string | null
    fuelSlipUrl?: string | null
    pumpStartUrl?: string | null
    pumpStopUrl?: string | null
    fuelDocsUploadedAt?: string | null
  } | null
  onEdit?: () => void
}

type FuelDocsResponse = {
  passId: string
  passNo: string
  fuelSlipUrl: string | null
  pumpStartUrl: string | null
  pumpStopUrl: string | null
  fuelAmount: string | number | null
  fuelLitres: string | number | null
  fuelDocsUploadedAt: string | null
  isComplete: boolean
}

export function FuelProofViewerDialog({
  open,
  onOpenChange,
  pass,
  onEdit,
}: FuelProofViewerDialogProps) {
  const [lightbox, setLightbox] = useState<{ label: string; url: string } | null>(null)

  const hasPreloadedData = Boolean(
    pass && (pass.fuelSlipUrl || pass.pumpStartUrl || pass.pumpStopUrl || pass.fuelDocsUploadedAt)
  )

  const { data, isLoading, error } = useQuery<FuelDocsResponse>({
    queryKey: ['fuel-proofs-viewer', pass?.id],
    queryFn: async () => {
      if (!pass?.id) throw new Error('No pass provided')
      const res = await fetch(`/api/gate-pass/${pass.id}/fuel-proofs`, { cache: 'no-store' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load fuel proofs.')
      }
      return res.json()
    },
    enabled: Boolean(open && pass?.id && !hasPreloadedData),
    initialData: pass && hasPreloadedData
      ? {
          passId: pass.id,
          passNo: pass.passNo,
          fuelSlipUrl: pass.fuelSlipUrl ?? null,
          pumpStartUrl: pass.pumpStartUrl ?? null,
          pumpStopUrl: pass.pumpStopUrl ?? null,
          fuelAmount: pass.fuelAmount ?? null,
          fuelLitres: pass.fuelLitres ?? null,
          fuelDocsUploadedAt: pass.fuelDocsUploadedAt ?? null,
          isComplete: Boolean(pass.fuelSlipUrl && pass.pumpStartUrl && pass.pumpStopUrl),
        }
      : undefined,
    staleTime: 60_000,
  })

  if (!pass) return null

  const effectiveAmount = data?.fuelAmount ?? pass.fuelAmount
  const effectiveLitres = data?.fuelLitres ?? pass.fuelLitres
  const uploadedAt = data?.fuelDocsUploadedAt ?? pass.fuelDocsUploadedAt

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto w-[96vw] sm:w-full sm:max-w-3xl p-0 gap-0 border-slate-200 bg-white shadow-2xl rounded-2xl"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-amber-200/60 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/20 text-amber-800 flex items-center justify-center font-bold">
                    <Fuel className="h-5 w-5" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg sm:text-xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                      Fuel Filling Proofs
                      <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300/80">
                        {pass.passNo}
                      </span>
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500">
                      Verified petrol station slip, zero start dispenser, and final amount proofs.
                    </DialogDescription>
                  </div>
                </div>
              </div>

              {onEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false)
                    onEdit()
                  }}
                  className="h-8 text-xs font-semibold border-amber-200 text-amber-800 hover:bg-amber-50 gap-1.5 cursor-pointer"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Update Proofs
                </Button>
              )}
            </div>

            {/* Price & Summary Ribbon */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Total Fuel Cost */}
              <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-2.5">
                <span className="text-[10px] uppercase font-bold text-teal-800 block tracking-wider">
                  Total Fuel Price
                </span>
                <span className="text-base sm:text-lg font-black text-teal-950 font-mono">
                  {effectiveAmount ? `₹${Number(effectiveAmount).toLocaleString('en-IN')}` : '—'}
                </span>
              </div>

              {/* Litres */}
              <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Fuel Quantity
                </span>
                <span className="text-sm sm:text-base font-bold text-slate-800 font-mono">
                  {effectiveLitres ? `${effectiveLitres} L` : 'Recorded on slip'}
                </span>
              </div>

              {/* Vehicle */}
              <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Vehicle
                </span>
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {pass.registrationNumber || pass.model || 'Demo Car'}
                </span>
              </div>

              {/* Driver */}
              <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Driver
                </span>
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {pass.driverName}
                </span>
              </div>
            </div>
          </div>

          {/* Proofs Grid */}
          <div className="p-5 sm:p-6 space-y-4">
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
                <span className="text-xs font-medium">Loading verified fuel proof images...</span>
              </div>
            ) : error ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Could not load fuel proofs: {(error as Error).message}</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 1. Physical Fuel Slip */}
                <ProofCard
                  title="1. Physical Fuel Slip"
                  icon={FileText}
                  iconColor="text-amber-600"
                  url={data?.fuelSlipUrl ?? pass.fuelSlipUrl}
                  onZoom={() => {
                    const u = data?.fuelSlipUrl ?? pass.fuelSlipUrl
                    if (u) setLightbox({ label: '1. Physical Fuel Slip Receipt', url: u })
                  }}
                />

                {/* 2. Pump Start (0.00) */}
                <ProofCard
                  title="2. Pump Start (0.00)"
                  icon={Gauge}
                  iconColor="text-blue-600"
                  url={data?.pumpStartUrl ?? pass.pumpStartUrl}
                  onZoom={() => {
                    const u = data?.pumpStartUrl ?? pass.pumpStartUrl
                    if (u) setLightbox({ label: '2. Pump Dispenser Zero Start (0.00)', url: u })
                  }}
                />

                {/* 3. Pump Stop (Amount) */}
                <ProofCard
                  title="3. Pump Stop (Amount)"
                  icon={IndianRupee}
                  iconColor="text-teal-700"
                  url={data?.pumpStopUrl ?? pass.pumpStopUrl}
                  onZoom={() => {
                    const u = data?.pumpStopUrl ?? pass.pumpStopUrl
                    if (u) setLightbox({ label: '3. Pump Dispenser Stop (Total Amount)', url: u })
                  }}
                />
              </div>
            )}

            {uploadedAt && (
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" /> Upload Timestamp
                </span>
                <span className="font-semibold text-slate-700 font-mono">
                  {formatIndiaDateTime(uploadedAt)}
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="bg-slate-50 border-t border-slate-200/80 px-5 py-3.5 sm:px-6">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="font-semibold border-slate-300"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox / Fullscreen Image Preview */}
      {lightbox && (
        <Dialog open={Boolean(lightbox)} onOpenChange={() => setLightbox(null)}>
          <DialogContent className="max-w-2xl p-4 bg-white border border-slate-200 text-slate-900 shadow-2xl rounded-2xl">
            <DialogHeader className="pb-3 flex flex-row items-center justify-between border-b border-slate-100">
              <DialogTitle className="text-sm font-bold text-slate-800">{lightbox.label}</DialogTitle>
              <a
                href={lightbox.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 font-semibold"
              >
                Open original
              </a>
            </DialogHeader>
            <div className="flex items-center justify-center p-3 bg-slate-50/70 rounded-xl border border-slate-100/80 mt-2">
              <img
                src={lightbox.url}
                alt={lightbox.label}
                className="max-h-[72vh] w-auto rounded-lg object-contain shadow-md"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function ProofCard({
  title,
  icon: Icon,
  iconColor,
  url,
  onZoom,
}: {
  title: string
  icon: typeof FileText
  iconColor: string
  url?: string | null
  onZoom: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs flex flex-col">
      <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <Icon className={cn('h-3.5 w-3.5', iconColor)} />
          {title}
        </span>
        {url ? (
          <Badge className="bg-teal-50 text-teal-800 border-teal-200 text-[10px] px-1.5 py-0">
            Attached
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-slate-400">
            Missing
          </Badge>
        )}
      </div>

      <div className="relative aspect-[4/3] bg-slate-100 flex items-center justify-center group overflow-hidden">
        {url ? (
          <>
            <img
              src={url}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div
              onClick={onZoom}
              className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer gap-1.5 text-white text-xs font-semibold backdrop-blur-[1px]"
            >
              <ZoomIn className="h-4 w-4" />
              <span>Click to Enlarge</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-400 text-xs p-4 text-center">
            <Icon className="h-8 w-8 mb-1 opacity-30" />
            <span>No proof document attached</span>
          </div>
        )}
      </div>
    </div>
  )
}
