'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { FileKind } from '@/lib/h-promise/constants'
import { HP_MAX_UPLOAD_BYTES } from '@/lib/h-promise/constants'
import type {
  HpExchangeBonus,
  HpListResponse,
  HpMeta,
  HpRegCheck,
  HpUploadResult,
  HpVehicleDetail,
  HpVehicleRow,
} from '@/lib/h-promise/types'
import { hpKeys } from './hp-keys'

export { hpKeys }

/**
 * The H Promise client data layer.
 *
 * ⚠️ Every read passes `cache: 'no-store'`. components/providers/query-provider.tsx wraps window.fetch and
 * caches every /api GET for 30 minutes unless told not to, and a POST only clears its own four-segment path —
 * so without this a saved sale would keep showing as unsold.
 *
 * ⚠️ After any write, everything under ['h-promise'] is invalidated: the register, the approval queues, the
 * payments list and the MIS all read the same rows.
 */

export class HpRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'HpRequestError'
  }
}

const OFFLINE = 'Could not reach the server. Check the connection and try again.'
const SIGNED_OUT = 'Your session has ended. Sign in again.'

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = response.status === 401
      ? SIGNED_OUT
      : body && typeof body.error === 'string' ? body.error : fallback
    throw new HpRequestError(message, response.status)
  }
  return body as T
}

export async function hpGet<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' })
  } catch {
    throw new HpRequestError(OFFLINE, 0)
  }
  return parse<T>(response, 'That could not be loaded just now.')
}

export async function hpSend<T = { ok: true }>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', payload?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  } catch {
    throw new HpRequestError(OFFLINE, 0)
  }
  return parse<T>(response, 'That could not be saved just now.')
}


const FRESH = { staleTime: 20_000, refetchOnMount: true, refetchOnWindowFocus: true } as const

export function useVehicles(view: 'live' | 'deleted' = 'live', enabled = true) {
  return useQuery({
    queryKey: hpKeys.vehicles(view),
    queryFn: () => hpGet<HpListResponse>(`/api/h-promise/vehicles${view === 'deleted' ? '?view=deleted' : ''}`),
    enabled,
    ...FRESH,
  })
}

/**
 * The drawer opens on the register row the person clicked (a placeholder with no files, bookings or history,
 * flagged `partial`), so the plate, status, money and the approve buttons are there at once; the full record
 * replaces it a moment later.
 */
function placeholderFromList(client: QueryClient, id: string): HpVehicleDetail | undefined {
  const lists = [client.getQueryData<HpListResponse>(hpKeys.vehicles('live')), client.getQueryData<HpListResponse>(hpKeys.vehicles('deleted'))]
  const row: HpVehicleRow | undefined = lists.flatMap((list) => list?.rows ?? []).find((candidate) => candidate.id === id)
  if (!row) return undefined
  return {
    ...row,
    odometerKm: null,
    engineNo: null,
    chassisNo: null,
    expectedProfit: null,
    purchaseRemarks: null,
    purchaseFinanced: false,
    salesConsultant: null,
    sellerPhone: null,
    buyerPhone: null,
    buyerAddress: null,
    documentsRemarks: null,
    documentsUpdatedByName: null,
    documentsUpdatedAt: null,
    brokerRcRemarks: null,
    brokerRcUpdatedByName: null,
    brokerRcUpdatedAt: null,
    updatedByName: null,
    importRow: null,
    bookings: row.booking
      ? [{ ...row.booking, status: 'active', remarks: null, refundDate: null, refundRemarks: null, refundedByName: null, refundedAt: null, createdByName: '', createdAt: row.createdAt, files: [] }]
      : [],
    files: [],
    replacedFiles: [],
    events: [],
    redacted: true,
    partial: true,
  }
}

export function useVehicle(id: string | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: hpKeys.vehicle(id ?? 'none'),
    queryFn: () => hpGet<HpVehicleDetail>(`/api/h-promise/vehicles/${id}`),
    enabled: Boolean(id),
    placeholderData: () => (id ? placeholderFromList(client, id) : undefined),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })
}

/** Signed thumbnail URLs, asked for in parallel with the record. They last five minutes; refresh at four. */
export function useVehiclePreviews(id: string | null) {
  return useQuery({
    queryKey: hpKeys.previews(id ?? 'none'),
    queryFn: () => hpGet<{ previews: Record<string, string> }>(`/api/h-promise/vehicles/${id}/previews`),
    enabled: Boolean(id),
    staleTime: 3 * 60_000,
    refetchInterval: 4 * 60_000,
    refetchOnMount: true,
  })
}

export function useMeta() {
  return useQuery({
    queryKey: hpKeys.meta,
    queryFn: () => hpGet<HpMeta>('/api/h-promise/meta'),
    staleTime: 60_000,
    refetchOnMount: true,
  })
}

export function useBonuses(enabled: boolean) {
  return useQuery({
    queryKey: hpKeys.bonuses,
    queryFn: () => hpGet<{ rows: HpExchangeBonus[] }>('/api/h-promise/exchange-bonuses'),
    enabled,
    ...FRESH,
  })
}

export function useSettingsHistory(enabled: boolean) {
  return useQuery({
    queryKey: hpKeys.settingsHistory,
    queryFn: () => hpGet<{ rows: Array<{ id: string; action: string; actorName: string; remarks: string | null; changes: Record<string, unknown>; createdAt: string }> }>('/api/h-promise/settings-history'),
    enabled,
    staleTime: 30_000,
    refetchOnMount: true,
  })
}

/**
 * A write that refreshes the H Promise views that are on screen when it lands. The name lists and rates
 * (`meta`) are refetched only by writes that change them.
 */
export function useHpMutation<TVariables, TResult = unknown>(
  fn: (variables: TVariables) => Promise<TResult>,
  options: { meta?: boolean } = {},
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({
      queryKey: hpKeys.all,
      predicate: (query) => options.meta === true || query.queryKey[1] !== 'meta',
    }),
  })
}

export async function checkRegistration(regNo: string, excludeId?: string | null): Promise<HpRegCheck> {
  const params = new URLSearchParams({ regNo })
  if (excludeId) params.set('excludeId', excludeId)
  return hpGet<HpRegCheck>(`/api/h-promise/vehicles/check-reg?${params}`)
}

// ── Uploads ──────────────────────────────────────────────────────────────────────────────────────

const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That photo could not be read. Try a JPEG or PNG.'))
    }
    image.src = url
  })
}

/**
 * Photos are shrunk in the browser before upload (Vercel refuses request bodies over 4.5 MB). Documents keep
 * a larger size so small print stays legible. A photo that is already small is sent untouched.
 */
export async function compressForUpload(file: File, document: boolean): Promise<File> {
  if (!COMPRESSIBLE.has(file.type)) return file
  if (file.size <= 700 * 1024 && file.type !== 'image/heic' && file.type !== 'image/heif') return file
  const maxDimension = document ? 2400 : 1800
  const image = await loadImage(file)
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return file
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const quality of document ? [0.88, 0.8, 0.7] : [0.82, 0.72, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= HP_MAX_UPLOAD_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    }
  }
  throw new Error('That photo is too large even after shrinking. Take it again at a lower resolution.')
}

export async function uploadHpFile(kind: FileKind, file: File, document: boolean): Promise<HpUploadResult> {
  const prepared = await compressForUpload(file, document)
  if (prepared.size > HP_MAX_UPLOAD_BYTES) {
    throw new HpRequestError('That file is larger than 4 MB. Scan it again at a lower resolution.', 413)
  }
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', prepared)
  let response: Response
  try {
    response = await fetch('/api/h-promise/uploads', { method: 'POST', body: form, cache: 'no-store', credentials: 'same-origin' })
  } catch {
    throw new HpRequestError(OFFLINE, 0)
  }
  return parse<HpUploadResult>(response, 'The file could not be uploaded.')
}

export function fileUrl(fileId: string, download = false): string {
  return `/api/h-promise/files/${fileId}${download ? '?download=1' : ''}`
}

export async function downloadHpExport(path: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' })
  } catch {
    throw new HpRequestError(OFFLINE, 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new HpRequestError(response.status === 401 ? SIGNED_OUT : body?.error ?? 'The file could not be built just now.', response.status)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'h-promise.xlsx'
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = name
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const STORAGE_EVENT = 'hp-session-storage'

/**
 * A per-tab remembered UI value (a tab, a filter). Read with useSyncExternalStore so the server render and
 * the first client render agree; falls back to memory when storage is blocked.
 */
export function useSessionValue(key: string): [string | null, (value: string) => void] {
  const [local, setLocal] = React.useState<string | null>(null)
  const subscribe = React.useCallback((notify: () => void) => {
    window.addEventListener(STORAGE_EVENT, notify)
    return () => window.removeEventListener(STORAGE_EVENT, notify)
  }, [])
  const stored = React.useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.sessionStorage.getItem(key)
      } catch {
        return null
      }
    },
    () => null,
  )
  const set = React.useCallback((value: string) => {
    setLocal(value)
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      /* storage unavailable: the in-memory value still applies */
    }
    window.dispatchEvent(new Event(STORAGE_EVENT))
  }, [key])
  return [local ?? stored, set]
}

/** Labels for option values (stored upper case, shown as named). */
export function useOptionLabels(meta: HpMeta | undefined) {
  return React.useMemo(() => {
    const map = new Map<string, string>()
    if (!meta) return map
    for (const option of [...meta.options.staff, ...meta.options.approver, ...meta.options.location]) {
      map.set(option.value, option.label)
    }
    return map
  }, [meta])
}
