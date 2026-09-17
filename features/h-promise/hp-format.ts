/**
 * H Promise display formatting. Indian grouping (₹4,95,000), IST for instants, and calendar days as written.
 */

import { INDIA_TIME_ZONE } from '@/lib/date-time'
import { NOT_TAKEN, NOT_TAKEN_LABEL, PAPERWORK_STATUS_LABELS, SOLD_TO_LABELS, isPaperworkStatus, isSoldTo } from '@/lib/h-promise/constants'

export const DASH = '—'
const NBSP = ' '

const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const COUNT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const ONE = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const TWO = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

const real = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

export function inr(value: number | null | undefined): string {
  return real(value) ? RUPEES.format(value) : DASH
}

/** Signed, for profit: "+₹53,000" / "−₹1,263". */
export function inrSigned(value: number | null | undefined): string {
  if (!real(value)) return DASH
  if (value === 0) return RUPEES.format(0)
  return `${value > 0 ? '+' : '−'}${RUPEES.format(Math.abs(value))}`
}

/** Lakh / crore, for headline figures: ₹4.95 L, ₹1.2 Cr. */
export function inrShort(value: number | null | undefined): string {
  if (!real(value)) return DASH
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs >= 1e7) return `${sign}₹${TWO.format(abs / 1e7)}${NBSP}Cr`
  if (abs >= 1e5) return `${sign}₹${TWO.format(abs / 1e5)}${NBSP}L`
  if (abs >= 1e3) return `${sign}₹${ONE.format(abs / 1e3)}${NBSP}K`
  return `${sign}₹${COUNT.format(abs)}`
}

export function count(value: number | null | undefined): string {
  return real(value) ? COUNT.format(value) : DASH
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (!real(value)) return DASH
  const text = Math.abs(value).toFixed(digits)
  return `${value < 0 && Number(text) !== 0 ? '−' : ''}${text}${NBSP}%`
}

export function km(value: number | null | undefined): string {
  return real(value) ? `${COUNT.format(value)}${NBSP}km` : DASH
}

export function days(value: number | null | undefined): string {
  if (!real(value)) return DASH
  return `${COUNT.format(value)}${NBSP}${value === 1 ? 'day' : 'days'}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = MONTHS

/** '2026-09-16' → '16 Sep 2026' (or '16 Sep'). A calendar day: no timezone is involved. */
export function day(ymd: string | null | undefined, withYear = true): string {
  if (!ymd) return DASH
  const [y, m, d] = ymd.slice(0, 10).split('-')
  const month = MONTHS[Number(m) - 1]
  if (!month) return ymd
  return withYear ? `${Number(d)}${NBSP}${month}${NBSP}${y}` : `${Number(d)}${NBSP}${month}`
}

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function when(iso: string | null | undefined): string {
  if (!iso) return DASH
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? DASH : WHEN.format(date)
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return DASH
  const minutes = Math.round((now - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const d = Math.round(hours / 24)
  if (d < 45) return `${d} ${d === 1 ? 'day' : 'days'} ago`
  return when(iso)
}

export function approverName(value: string | null | undefined, labels?: ReadonlyMap<string, string>): string {
  if (!value) return DASH
  if (value === NOT_TAKEN) return NOT_TAKEN_LABEL
  return labels?.get(value) ?? value
}

export function paperworkLabel(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  return isPaperworkStatus(value) ? PAPERWORK_STATUS_LABELS[value] : value
}

export function soldToLabel(value: string | null | undefined): string {
  if (!value) return DASH
  return isSoldTo(value) ? SOLD_TO_LABELS[value] : value
}

export function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return DASH
  return value ? 'Yes' : 'No'
}

export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${ONE.format(bytes / (1024 * 1024))}${NBSP}MB`
  return `${COUNT.format(Math.max(1, Math.round(bytes / 1024)))}${NBSP}KB`
}

/** "2026-09" for a calendar day. */
export function monthKeyOf(ymd: string | null | undefined): string | null {
  return ymd ? ymd.slice(0, 7) : null
}
