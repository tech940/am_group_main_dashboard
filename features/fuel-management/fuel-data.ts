'use client'

import { getIndiaYmd } from '@/lib/date-time'
import type { FuelEnergy, FuelFilters } from '@/lib/fuel-management/types'

/** What the filter bar holds. Empty string = "all". */
export type FilterState = {
  preset: PeriodPreset
  from: string
  to: string
  branch: string
  brand: string
  purpose: string
  department: string
  energy: '' | FuelEnergy
  fleet: '' | 'demo' | 'other'
  vehicle: string
}

export type PeriodPreset = 'today' | '7d' | 'month' | 'last_month' | 'custom'

export const PERIOD_OPTIONS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom' },
]

function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** India calendar days for a preset. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today = getIndiaYmd()): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: shift(today, -6), to: today }
    case 'last_month': {
      const firstThis = `${today.slice(0, 8)}01`
      const lastPrev = shift(firstThis, -1)
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev }
    }
    case 'month':
    default:
      return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

export function initialFilters(): FilterState {
  const range = presetRange('month')
  return { preset: 'month', ...range, branch: '', brand: '', purpose: '', department: '', energy: '', fleet: '', vehicle: '' }
}

export function activeFilterCount(f: FilterState): number {
  return [f.branch, f.brand, f.purpose, f.department, f.energy, f.fleet, f.vehicle].filter(Boolean).length
}

/** The query string every Fuel Management endpoint understands. */
export function filterParams(f: FilterState, extra: Record<string, string | number | null | undefined> = {}): string {
  const params = new URLSearchParams()
  params.set('from', f.from)
  params.set('to', f.to)
  const pairs: [string, string][] = [
    ['branch', f.branch], ['brand', f.brand], ['purpose', f.purpose], ['department', f.department],
    ['energy', f.energy], ['fleet', f.fleet], ['vehicle', f.vehicle],
  ]
  for (const [key, value] of pairs) if (value) params.set(key, value)
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.toString()
}

export class FuelRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const OFFLINE = "Can't reach the server — check your connection and try again."
const SIGNED_OUT = 'Your session has ended. Sign in again to continue.'

/** GET a Fuel Management endpoint. A patched window.fetch caches GET /api/* unless told not to. */
export async function fetchFuel<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' })
  } catch {
    throw new FuelRequestError(OFFLINE, 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = res.status === 401
      ? SIGNED_OUT
      : body && typeof body.error === 'string' ? body.error : 'Fuel figures could not be loaded just now.'
    throw new FuelRequestError(message, res.status)
  }
  return body as T
}

/** Downloads a report, telling the person when it fails instead of saving an error as a file. */
export async function downloadFuelReport(path: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' })
  } catch {
    throw new FuelRequestError(OFFLINE, 0)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new FuelRequestError(res.status === 401 ? SIGNED_OUT : body?.error ?? 'The report could not be built just now.', res.status)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'fuel-report.xlsx'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function sendFuel<T>(path: string, method: 'POST' | 'PUT', payload: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new FuelRequestError(OFFLINE, 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = res.status === 401
      ? SIGNED_OUT
      : body && typeof body.error === 'string' ? body.error : 'The change could not be saved just now.'
    throw new FuelRequestError(message, res.status)
  }
  return body as T
}

export function toApiFilters(f: FilterState): FuelFilters {
  return {
    from: f.from,
    to: f.to,
    branch: f.branch || null,
    brand: f.brand || null,
    purpose: f.purpose || null,
    department: f.department || null,
    energy: f.energy || null,
    fleet: f.fleet || null,
    vehicle: f.vehicle || null,
  }
}
