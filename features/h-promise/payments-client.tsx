'use client'

import * as React from 'react'
import { BadgeCheck, Upload, Wallet } from 'lucide-react'
import { formatStockNo } from '@/lib/h-promise/constants'
import { daysBetweenYmd } from '@/lib/h-promise/stage'
import { isSaleRecorded } from '@/lib/h-promise/insights-core'
import type { HpVehicleRow } from '@/lib/h-promise/types'
import { useVehicles } from './hp-data'
import { useHpSection, useLabel } from './hp-context'
import { day, inr, inrShort, soldToLabel, when } from './hp-format'
import {
  Band,
  BandCell,
  EmptyState,
  ErrorState,
  FilterSelect,
  HpButton,
  LoadingBlock,
  Panel,
  PlateSearch,
  RegPlate,
  StatusChip,
  ToneChip,
} from './hp-ui'

export function PaymentsClient() {
  const { caps, openVehicle, meta } = useHpSection()
  const label = useLabel()
  const query = useVehicles('live')
  const rows = React.useMemo(() => query.data?.rows ?? [], [query.data])
  const today = query.data?.today ?? meta?.today ?? ''
  const [search, setSearch] = React.useState('')
  const [location, setLocation] = React.useState('')

  const match = (row: HpVehicleRow) => {
    if (location && row.location !== location) return false
    const needle = search.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '')
    if (!needle) return true
    return `${row.regNo.replace(/[^A-Za-z0-9]/g, '')} ${row.model} ${row.buyerName ?? ''} ${row.soldBy ?? ''}`.toUpperCase().includes(needle.replace(/ /g, ''))
      || `${row.model} ${row.buyerName ?? ''} ${row.soldBy ?? ''}`.toUpperCase().includes(needle)
  }
  const sold = rows.filter(isSaleRecorded)
  const awaiting = sold.filter((r) => r.flags.ledgerPending && match(r))
    .sort((a, b) => (a.saleDate ?? '').localeCompare(b.saleDate ?? ''))
  const verified = sold.filter((r) => !r.flags.ledgerPending && match(r))
    .sort((a, b) => (b.paymentVerifiedAt ?? b.saleDate ?? '').localeCompare(a.paymentVerifiedAt ?? a.saleDate ?? ''))
  const age = (row: HpVehicleRow) => daysBetweenYmd(row.saleDate, today) ?? 0
  const overdue = awaiting.filter((r) => age(r) > 7).length

  if (query.isLoading) return <LoadingBlock label="Loading payments" rows={6} />
  if (query.isError && !query.data) return <ErrorState message={query.error instanceof Error ? query.error.message : 'Payments could not be loaded.'} onRetry={() => query.refetch()} />

  return (
    <div className="space-y-4">
      <Band cols={4} label="Payment verification">
        <BandCell label="Ledgers due" tone="pending" value={awaiting.length} sub={`${inrShort(awaiting.reduce((s, r) => s + (r.sellingPrice ?? 0), 0))} of sales`} />
        <BandCell label="Due over 7 days" tone={overdue ? 'rejected' : 'neutral'} value={overdue} sub="Since the sale date" />
        <BandCell label="Verified" tone="approved" value={verified.length} sub={`${inrShort(verified.reduce((s, r) => s + (r.sellingPrice ?? 0), 0))} of sales`} />
        <BandCell label="Sold vehicles" tone="sold" value={sold.length} sub="Awaiting approval or approved" />
      </Band>

      <div className="flex flex-wrap items-center gap-2">
        <PlateSearch value={search} onChange={setSearch} placeholder="Search plate, model, buyer, seller…" />
        <FilterSelect label="Location" value={location} onChange={setLocation} options={(meta?.options.location ?? []).map((o) => ({ value: o.value, label: o.label }))} allLabel="All locations" />
      </div>

      <Panel title="Waiting for the ledger" description="Oldest sale first. Upload the customer's account ledger once the payment is in." bodyClassName="p-0">
        {awaiting.length === 0 ? (
          <div className="p-4"><EmptyState title="Every sold vehicle has its ledger" icon={<BadgeCheck className="h-5 w-5" />} /></div>
        ) : (
          <div className="hp-scroll max-h-[60vh]">
            <table className="hp-table min-w-[900px]">
              <thead>
                <tr>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Sold by</th>
                  <th scope="col" className="text-right">Price</th>
                  <th scope="col">Sale approval</th>
                  <th scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((row) => (
                  <tr key={row.id} data-clickable="true" onClick={() => openVehicle(row.id)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <RegPlate regNo={row.regNo} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{row.model}</p>
                          <p className="hp-mono text-[11px] text-slate-500">{formatStockNo(row.stockNo)} · {label(row.location)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hp-num whitespace-nowrap">{day(row.saleDate)}</td>
                    <td><ToneChip tone={age(row) > 7 ? 'rejected' : 'pending'}>{age(row)} d</ToneChip></td>
                    <td className="text-slate-700">{row.buyerName ?? '—'}<span className="block text-[11px] text-slate-500">{soldToLabel(row.soldTo)}</span></td>
                    <td className="text-slate-700">{label(row.soldBy)}</td>
                    <td className="hp-num text-right font-semibold">{inr(row.sellingPrice)}</td>
                    <td><StatusChip flow="sale" status={row.saleStatus} managerStatus={row.saleManagerStatus} /></td>
                    <td className="text-right">
                      {caps.payments.edit && (
                        <HpButton size="sm" variant="accent" onClick={(event) => { event.stopPropagation(); openVehicle(row.id, 'ledger') }}>
                          <Upload /> Upload ledger
                        </HpButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Verified" description="Ledger on file." bodyClassName="p-0">
        {verified.length === 0 ? (
          <div className="p-4"><EmptyState title="No verified payments yet" icon={<Wallet className="h-5 w-5" />} /></div>
        ) : (
          <div className="hp-scroll max-h-[50vh]">
            <table className="hp-table min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Sold</th>
                  <th scope="col" className="text-right">Price</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Verified</th>
                </tr>
              </thead>
              <tbody>
                {verified.map((row) => (
                  <tr key={row.id} data-clickable="true" onClick={() => openVehicle(row.id)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <RegPlate regNo={row.regNo} size="sm" />
                        <span className="truncate font-semibold text-slate-900">{row.model}</span>
                      </div>
                    </td>
                    <td className="hp-num whitespace-nowrap">{day(row.saleDate)}</td>
                    <td className="hp-num text-right font-semibold">{inr(row.sellingPrice)}</td>
                    <td className="text-slate-700">{row.buyerName ?? '—'}</td>
                    <td className="whitespace-nowrap text-slate-700">
                      {row.paymentVerifiedByName ?? '—'}
                      {row.paymentVerifiedAt && <span className="block text-[11px] text-slate-500">{when(row.paymentVerifiedAt)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
