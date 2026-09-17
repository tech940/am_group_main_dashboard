/**
 * Server-renders every H Promise screen and every vehicle-drawer panel with the REAL register, for a super admin
 * and for a view-only user, to catch render-time errors and personal values reaching a viewer.
 *
 *   npm run verify:h-promise-render
 *
 * READ-ONLY: it only calls the list/detail readers. No browser or sign-in is needed, which is why it exists —
 * the page itself sits behind the login.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { deriveCapabilities, HP_PERMISSION_KEYS } from '../lib/h-promise/access-shared'
import { getMeta, getVehicleDetail, listExchangeBonuses, listVehicles } from '../lib/h-promise/queries'
import { hpKeys, useOptionLabels } from '../features/h-promise/hp-data'
import { HpSectionContext, type HpSection, type VehiclePanel } from '../features/h-promise/hp-context'
import { HPromiseApp } from '../features/h-promise/hp-home'
import { HP_TABS } from '../features/h-promise/hp-keys'
import { VehicleSheetBody } from '../features/h-promise/hp-vehicle'
import { PurchaseForm } from '../features/h-promise/forms/purchase-form'
import { buildMisHtml } from '../features/h-promise/hp-print'
import { computeInsights, DEFAULT_INSIGHT_FILTERS } from '../lib/h-promise/insights-core'
import type { HpMeta } from '../lib/h-promise/types'

function Wrap({ client, section, children }: { client: QueryClient; section: Omit<HpSection, 'labels'> & { meta: HpMeta }; children: React.ReactNode }) {
  const labels = useOptionLabels(section.meta)
  return (
    <QueryClientProvider client={client}>
      <HpSectionContext.Provider value={{ ...section, labels }}>{children}</HpSectionContext.Provider>
    </QueryClientProvider>
  )
}

async function main() {
  const [list, meta, deleted] = await Promise.all([listVehicles('live'), getMeta(), listVehicles('deleted')])
  const user = { id: '00000000-0000-4000-8000-00000000abcd', name: 'Smoke Test' }
  const caps = {
    super: deriveCapabilities(user, {}, true),
    viewer: deriveCapabilities(user, { [HP_PERMISSION_KEYS.registerView]: true, [HP_PERMISSION_KEYS.insightsView]: true, [HP_PERMISSION_KEYS.approvalsView]: true, [HP_PERMISSION_KEYS.paymentsView]: true }, false),
  }
  const bonuses = await listExchangeBonuses(caps.super)
  console.log(`rows ${list.rows.length}, bookings ${list.bookings.length}, deleted ${deleted.rows.length}, staff ${meta.options.staff.length}, today ${list.today}`)

  const failures: string[] = []
  for (const [who, c] of Object.entries(caps)) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(hpKeys.vehicles('live'), list)
    client.setQueryData(hpKeys.vehicles('deleted'), deleted)
    client.setQueryData(hpKeys.meta, meta)
    client.setQueryData(hpKeys.bonuses, { rows: bonuses })
    client.setQueryData(hpKeys.settingsHistory, { rows: [] })
    const section = {
      caps: c,
      meta,
      drawer: { kind: 'closed' as const },
      openVehicle: () => {},
      openNewPurchase: () => {},
      closeDrawer: () => {},
    }
    // The button names come from the source, so a rename there does not break this check.
    const homeSource = readFileSync('features/h-promise/hp-home.tsx', 'utf8')
    const formsBlock = homeSource.slice(homeSource.indexOf('const FORMS'), homeSource.indexOf('function FormsBar'))
    const formLabels = [...formsBlock.matchAll(/\{ id: '[a-z]+', label: '([^']+)'/g)].map((m) => m[1])
    const barBlock = homeSource.slice(homeSource.indexOf('function FormsBar'))
    const barLabel = /<section aria-label="([^"]+)"/.exec(barBlock)?.[1]
    if (!barLabel) failures.push('the forms bar has no aria-label to recognise it by')
    if (formLabels.length !== 6) failures.push(`expected 6 form buttons in hp-home.tsx, found ${formLabels.length}`)
    const screens: Array<[string, React.ReactElement]> = [
      ...HP_TABS.map((tab): [string, React.ReactElement] => [`tab ${tab}`, <HPromiseApp key={tab} caps={c} initialTab={tab} />]),
      ['new purchase', <PurchaseForm key="n" onDone={() => {}} onCancel={() => {}} />],
    ]
    for (const [name, element] of screens) {
      try {
        const html = renderToString(<Wrap client={client} section={section}>{element}</Wrap>)
        if (name.startsWith('tab ') && who === 'super') {
          for (const form of formLabels) {
            if (!html.includes(`>${form}<`)) failures.push(`${who} ${name}: the ${form} form is missing`)
          }
        }
        if (name.startsWith('tab ') && who === 'super' && barLabel && !html.includes(`aria-label="${barLabel}"`)) failures.push(`${who} ${name}: the forms bar is missing`)
        if (name.startsWith('tab ') && who === 'viewer' && barLabel && html.includes(`aria-label="${barLabel}"`)) failures.push(`${who} ${name}: a view-only user is offered the forms`)
        const plates = (html.match(/hp-plate/g) ?? []).length
        console.log(`  [ok] ${who} ${name}: ${html.length} chars, ${plates} plates${html.includes('Loading') ? ' (loading state)' : ''}`)
        if (html.includes('9876') || /\b[6-9]\d{9}\b/.test(html)) {
          if (who === 'viewer') failures.push(`${who} ${name}: a full phone number appears`)
        }
      } catch (error) {
        failures.push(`${who} ${name}: ${error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : error}`)
      }
    }

    // A handful of vehicles in every drawer panel.
    const picks = [
      list.rows.find((r) => r.saleStatus === 'approved'),
      list.rows.find((r) => r.saleStatus === 'rejected'),
      list.rows.find((r) => r.purchaseStatus === 'rejected'),
      list.rows.find((r) => r.soldTo === 'BROKER'),
      list.rows.find((r) => r.stage === 'in_stock'),
      deleted.rows[0],
    ].filter(Boolean)
    for (const pick of picks) {
      const detail = await getVehicleDetail(c, pick!.id)
      client.setQueryData(hpKeys.vehicle(pick!.id), detail)
      if (who === 'viewer' && (detail.sellerPhone?.match(/^\d{10}$/) || detail.buyerAddress)) failures.push(`viewer detail ${pick!.stockNo} leaks personal values`)
      const panels: VehiclePanel[] = ['overview', 'edit-purchase', 'booking', 'sale', 'documents', 'broker-rc', 'ledger', 'refund', 'booking-edit']
      for (const panel of panels) {
        try {
          const html = renderToString(<Wrap client={client} section={section}><VehicleSheetBody id={pick!.id} panel={panel} /></Wrap>)
          if (panel === 'overview') console.log(`  [ok] ${who} drawer HP-${pick!.stockNo} ${detail.stage}/${detail.purchaseStatus}/${detail.saleStatus ?? '-'}: ${html.length} chars, ${detail.files.length} files, ${detail.events.length} events`)
        } catch (error) {
          failures.push(`${who} drawer ${pick!.stockNo} ${panel}: ${error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : error}`)
        }
      }
    }
  }
  const mis = computeInsights(list.rows, list.bookings, { ...DEFAULT_INSIGHT_FILTERS(list.today), year: 'all' }, list.today)
  const html = buildMisHtml(mis, { ...DEFAULT_INSIGHT_FILTERS(list.today), year: 'all' }, { location: null, printedBy: 'Smoke <test>', printedAt: 'now' })
  console.log(`  [ok] print html ${html.length} chars; escaped: ${html.includes('Smoke &lt;test&gt;')}`)
  console.log(`  all-time: purchased ${mis.period.purchasedCount} (${Math.round(mis.period.purchasedValue)}), sold ${mis.period.soldCount} (${Math.round(mis.period.saleValue)}), GP ${Math.round(mis.period.grossProfit)}, NP ${Math.round(mis.period.netProfit)}, stock ${mis.stock.count}, months ${mis.months.length}`)
  console.log(`  insight cards: ${mis.insights.length}`)
  console.log(failures.length ? `\nFAILURES:\n${failures.join('\n')}` : '\nno render failures')
  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
