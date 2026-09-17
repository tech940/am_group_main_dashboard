'use client'

import * as React from 'react'
import type { HPromiseCapabilities } from '@/lib/h-promise/access-shared'
import type { HpMeta } from '@/lib/h-promise/types'

/** What the vehicle drawer is showing. Forms open as panels inside it, over the same vehicle. */
export type VehiclePanel =
  | 'overview'
  | 'edit-purchase'
  | 'booking'
  | 'booking-edit'
  | 'refund'
  | 'sale'
  | 'documents'
  | 'broker-rc'
  | 'ledger'

export type DrawerState =
  | { kind: 'closed' }
  | { kind: 'vehicle'; id: string; panel: VehiclePanel; bookingId?: string }
  | { kind: 'new-purchase' }

export type HpSection = {
  caps: HPromiseCapabilities
  meta: HpMeta | undefined
  labels: ReadonlyMap<string, string>
  drawer: DrawerState
  openVehicle: (id: string, panel?: VehiclePanel, bookingId?: string) => void
  openNewPurchase: () => void
  closeDrawer: () => void
}

export const HpSectionContext = React.createContext<HpSection | null>(null)

export function useHpSection(): HpSection {
  const value = React.useContext(HpSectionContext)
  if (!value) throw new Error('useHpSection must be used inside the H Promise shell')
  return value
}

/** Label for a stored option value ("TATA NARWAL" → "Narwal"). */
export function useLabel() {
  const { labels } = useHpSection()
  return React.useCallback((value: string | null | undefined) => (value ? labels.get(value) ?? value : '—'), [labels])
}
