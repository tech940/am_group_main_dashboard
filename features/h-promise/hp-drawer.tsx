'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { HPromiseCapabilities } from '@/lib/h-promise/access-shared'
import { HpSectionContext, type DrawerState, type HpSection, type VehiclePanel } from './hp-context'
import { useMeta, useOptionLabels } from './hp-data'
import { PurchaseForm } from './forms/purchase-form'
import { VehicleSheetBody } from './hp-vehicle'
import { RegPlate } from './hp-ui'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Holds the section's shared state: who the person is, the name lists, and the one vehicle drawer every area
 * opens. The drawer lives in local state only.
 *
 * ⚠️ The URL is never written: in Next 16 a history.replaceState triggers a server round trip (see the
 * next16-rsc-invocation-traps note). A `?v=<vehicle id>` link is READ once, so a vehicle can still be linked.
 */
export function HPromiseProvider({ caps, children }: { caps: HPromiseCapabilities; children: React.ReactNode }) {
  const metaQuery = useMeta()
  const labels = useOptionLabels(metaQuery.data)
  const [drawer, setDrawer] = React.useState<DrawerState>({ kind: 'closed' })

  React.useEffect(() => {
    let v: string | null = null
    try {
      v = new URLSearchParams(window.location.search).get('v')
    } catch {
      /* no URL access */
    }
    if (!v || !UUID.test(v)) return
    const id = v
    // After hydration, once: the server render never knows the query string's vehicle.
    const timer = window.setTimeout(() => setDrawer({ kind: 'vehicle', id, panel: 'overview' }), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const value = React.useMemo<HpSection>(() => ({
    caps,
    meta: metaQuery.data,
    labels,
    drawer,
    openVehicle: (id: string, panel: VehiclePanel = 'overview', bookingId?: string) => setDrawer({ kind: 'vehicle', id, panel, bookingId }),
    openNewPurchase: () => setDrawer({ kind: 'new-purchase' }),
    closeDrawer: () => setDrawer({ kind: 'closed' }),
  }), [caps, metaQuery.data, labels, drawer])

  return (
    <HpSectionContext.Provider value={value}>
      {children}
      <VehicleDrawer />
    </HpSectionContext.Provider>
  )
}

function VehicleDrawer() {
  const context = React.useContext(HpSectionContext)!
  const { drawer, closeDrawer, openVehicle } = context
  const open = drawer.kind !== 'closed'
  // Keep the last content while the sheet animates out (state adjusted during render, React's pattern).
  const [shown, setShown] = React.useState<DrawerState>(drawer)
  if (drawer.kind !== 'closed' && drawer !== shown) setShown(drawer)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && closeDrawer()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="hp-overlay fixed inset-0 z-50 bg-slate-950/40" />
        <DialogPrimitive.Content
          className="hp hp-sheet fixed inset-y-0 right-0 z-50 flex w-full max-w-[48rem] flex-col border-l border-slate-200 bg-white shadow-[-18px_0_40px_-14px_rgba(15,23,42,0.28)] outline-none"
          aria-describedby={undefined}
        >
          {shown.kind === 'new-purchase' ? (
            <>
              <div className="hp-sunken-bg flex items-center gap-3 border-b border-slate-200 px-5 py-4 pr-14 sm:px-6">
                <RegPlate label="NEW" size="md" />
                <div>
                  <DialogPrimitive.Title className="text-base font-semibold text-slate-900">Record a purchase</DialogPrimitive.Title>
                  <p className="text-xs text-slate-500">It goes to an approver once saved.</p>
                </div>
              </div>
              <PurchaseForm onDone={(id) => openVehicle(id)} onCancel={closeDrawer} />
            </>
          ) : shown.kind === 'vehicle' ? (
            <>
              <DialogPrimitive.Title className="sr-only">Vehicle details</DialogPrimitive.Title>
              <VehicleSheetBody key={shown.id} id={shown.id} panel={shown.panel} bookingId={shown.bookingId} />
            </>
          ) : (
            <DialogPrimitive.Title className="sr-only">Vehicle details</DialogPrimitive.Title>
          )}
          <DialogPrimitive.Close
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg hp-hover text-slate-400"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
