'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Car, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatIndiaDateTime } from '@/lib/date-time'

type FleetVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  branchLabel: string
  state: 'available' | 'reserved' | 'out'
  passNo: string | null
  driverName: string | null
  expectedReturnAt: string | null
  overdue: boolean
  sharedPlate: boolean
}

type Fleet = {
  total: number
  available: number
  reserved: number
  out: number
  overdue: number
  byBranch: Array<{
    dealerCode: string; branchLabel: string
    total: number; available: number; reserved: number; out: number; overdue: number
  }>
  vehicles: FleetVehicle[]
}

/*
 * Inline colours, not Tailwind classes — app/globals.css retints emerald/amber/rose utilities to
 * theme tokens with !important, so bg-emerald-100 does not render emerald here.
 */
const STATE_STYLE = {
  available: { bg: '#d1fae5', fg: '#065f46', label: 'Available' },
  reserved: { bg: '#e0e7ff', fg: '#3730a3', label: 'Booked' },
  out: { bg: '#fef3c7', fg: '#92400e', label: 'Out' },
} as const

/**
 * Fleet availability.
 *
 * Three states, not two. "Booked" — approved but still on the premises — is deliberately its own
 * state: the car is physically here, so calling it Out is a lie, but somebody is expecting to
 * collect it, so calling it Available sends two people to the same vehicle.
 */
export function FleetPanel() {
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['gate-pass-fleet'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/fleet', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load the fleet.')
      return res.json() as Promise<Fleet>
    },
    // A car going out changes this, so it should not sit stale on a wall display.
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900">Demo fleet</h2>
          <span className="text-sm text-slate-500">{data.total} cars</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <>Hide cars <ChevronUp className="ml-1 h-3.5 w-3.5" /></>
            : <>Show every car <ChevronDown className="ml-1 h-3.5 w-3.5" /></>}
        </Button>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
        <Count label="Available now" value={data.available} tone="available" />
        <Count label="Booked, not gone" value={data.reserved} tone="reserved" />
        <Count label="Out" value={data.out} tone="out"
          sub={data.overdue > 0 ? `${data.overdue} overdue` : undefined} />
      </div>

      {data.byBranch.length > 1 ? (
        <div className="divide-y divide-slate-100">
          {data.byBranch.map((b) => (
            <div key={b.dealerCode} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-medium text-slate-700">{b.branchLabel}</span>
              <span className="flex items-center gap-3 tabular-nums text-slate-600">
                <span><strong className="text-slate-900">{b.available}</strong> free</span>
                <span className="text-slate-300">·</span>
                <span>{b.reserved} booked</span>
                <span className="text-slate-300">·</span>
                <span>{b.out} out</span>
                <span className="text-slate-400">of {b.total}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="max-h-96 overflow-y-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <tbody>
              {data.vehicles.map((v) => {
                const s = STATE_STYLE[v.state]
                return (
                  <tr key={v.vin} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">
                        {v.registrationNumber || 'No registration'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {[v.model, v.color].filter(Boolean).join(' · ')}
                        {/* A trade plate is worn by several cars, so the VIN tail is the only way
                            to tell them apart on a forecourt. */}
                        {v.sharedPlate ? ` · VIN ${v.vin.slice(-6)}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{v.branchLabel}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {v.state === 'available' ? null : (
                        <>
                          {v.driverName}
                          {v.expectedReturnAt ? (
                            <div className={v.overdue ? 'font-medium text-rose-700' : 'text-slate-400'}>
                              {v.overdue ? 'Was due ' : 'Due '}{formatIndiaDateTime(v.expectedReturnAt)}
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: s.bg, color: s.fg }}>
                        {v.overdue ? 'Overdue' : s.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function Count({ label, value, tone, sub }: {
  label: string; value: number; tone: keyof typeof STATE_STYLE; sub?: string
}) {
  return (
    <div className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-3xl font-semibold tabular-nums" style={{ color: STATE_STYLE[tone].fg }}>
        {value}
      </p>
      {sub ? <p className="text-xs font-medium text-rose-700">{sub}</p> : null}
    </div>
  )
}
