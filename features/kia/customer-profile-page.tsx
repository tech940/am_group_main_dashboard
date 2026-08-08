'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import type { KiaCustomerGaps, KiaCustomerListResult, KiaCustomerProfile, KiaCustomerSummary } from '@/lib/kia/customer-profile/reader'

/**
 * KIA Customer Profile.
 *
 * ⚠️ Theming: every colour here is a CSS variable (--dashboard-*), never a hex literal, so the
 * section follows the seven accent themes. Hardcoding a hex pins it to one theme and the
 * switcher silently does nothing — that has already happened twice in this codebase.
 *
 * ⚠️ PII is redacted SERVER-side before it reaches this component (see
 * lib/kia/customer-profile/redact.ts). Anything shown here as a mask is already a mask in the
 * payload — the client is the second layer, never the first.
 */

type GapKey = keyof KiaCustomerGaps

const GAPS: { key: GapKey; label: string; help: string }[] = [
  { key: 'enquiryNoBooking', label: 'Enquired, never booked', help: 'Showed interest but no booking was ever raised.' },
  { key: 'bookingNoInsurance', label: 'No insurance on record', help: 'We sold the vehicle but hold no policy for it. They may be insured elsewhere.' },
  { key: 'noRecentService', label: 'No recent service', help: 'No billed service within the chosen window. They may be using another workshop.' },
  { key: 'openComplaint', label: 'Open complaint', help: 'A complaint that has never been closed.' },
  { key: 'insuranceLapsed', label: 'Insurance lapsed', help: 'The most recent policy we hold has already expired.' },
  { key: 'bookedNotDelivered', label: 'Booked, not delivered', help: 'A booking exists with no delivery date recorded.' },
]

function fmtDate(value: string | null) {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

export function KiaCustomerProfilePage({ canViewPii }: { canViewPii: boolean }) {
  const [draftSearch, setDraftSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [gap, setGap] = useState<GapKey | null>(null)
  const [serviceGapMonths, setServiceGapMonths] = useState(12)
  const [page, setPage] = useState(1)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const deferredSearch = useDeferredValue(appliedSearch)

  const listParams = useMemo(() => {
    const params = new URLSearchParams()
    if (deferredSearch) params.set('search', deferredSearch)
    if (gap) params.set('gap', gap)
    params.set('service_gap_months', String(serviceGapMonths))
    params.set('page', String(page))
    params.set('page_size', '25')
    return params.toString()
  }, [deferredSearch, gap, serviceGapMonths, page])

  const list = useQuery<KiaCustomerListResult>({
    queryKey: ['kia-customer-profile', 'list', listParams],
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/customer-profile?${listParams}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  const profile = useQuery<KiaCustomerProfile>({
    queryKey: ['kia-customer-profile', 'detail', openKey, serviceGapMonths],
    enabled: Boolean(openKey),
    queryFn: async () => {
      const res = await fetch(
        `/api/brands/kia/customer-profile/${encodeURIComponent(openKey!)}?service_gap_months=${serviceGapMonths}`,
      )
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  const applySearch = () => { setAppliedSearch(draftSearch.trim()); setPage(1) }

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6">
        <header>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--dashboard-primary-dark)' }}>
            Customer Profile
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Everything one customer has done with us — enquiry, booking, insurance, service and
            complaints — and what is missing.
          </p>
        </header>

        {/* Gap strip. Counts are lifetime, never affected by the search box. */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {GAPS.map((item) => {
            const active = gap === item.key
            const count = list.data?.gapCounts?.[item.key]
            return (
              <button
                key={item.key}
                type="button"
                title={item.help}
                onClick={() => { setGap(active ? null : item.key); setPage(1) }}
                className="rounded-lg border p-3 text-left transition-colors"
                style={{
                  borderColor: active ? 'var(--dashboard-primary)' : 'var(--dashboard-border)',
                  backgroundColor: active ? 'rgba(var(--dashboard-primary-rgb), 0.10)' : 'white',
                }}
              >
                <div className="text-xl font-semibold" style={{ color: 'var(--dashboard-primary)' }}>
                  {count === undefined ? '—' : count.toLocaleString('en-IN')}
                </div>
                <div className="mt-0.5 text-xs leading-tight text-slate-600">{item.label}</div>
              </button>
            )
          })}
        </section>

        {/* Filters. Draft state is committed only on Apply so the query key stays stable. */}
        <section className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
          style={{ borderColor: 'var(--dashboard-border)' }}>
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="cp-search">
              Search by phone, name, chassis/VIN or registration
            </label>
            <input
              id="cp-search"
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') applySearch() }}
              placeholder="9149517648 · MZBEB812LTN036625 · JK02DU8842 · Sharma"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--dashboard-border)' }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="cp-months">
              Service gap (months)
            </label>
            <select
              id="cp-months"
              value={serviceGapMonths}
              onChange={(event) => { setServiceGapMonths(Number(event.target.value)); setPage(1) }}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--dashboard-border)' }}
            >
              {[6, 9, 12, 18, 24].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={applySearch}
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
          >
            Apply
          </button>
          {(appliedSearch || gap) && (
            <button
              type="button"
              onClick={() => { setDraftSearch(''); setAppliedSearch(''); setGap(null); setPage(1) }}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--dashboard-border)' }}
            >
              Clear
            </button>
          )}
        </section>

        {!canViewPii && (
          <p className="rounded-md border px-3 py-2 text-xs text-slate-600"
            style={{ borderColor: 'var(--dashboard-border)', backgroundColor: 'var(--dashboard-primary-soft)' }}>
            Customer phone numbers and email addresses are hidden for your role. They are not sent to
            this page at all, not merely hidden from view.
          </p>
        )}

        <section className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--dashboard-border)' }}>
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--dashboard-primary)' }}>
                {['Customer', 'Contact', 'Enquiries', 'Bookings', 'Vehicles', 'Services', 'Last activity', 'Gaps'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-white">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Loading…</td></tr>
              )}
              {list.isError && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-rose-600">
                  {(list.error as Error)?.message || 'Failed to load'}
                </td></tr>
              )}
              {list.data?.rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  No customer matches that search.
                </td></tr>
              )}
              {list.data?.rows.map((row: KiaCustomerSummary) => (
                <tr
                  key={row.key}
                  onClick={() => setOpenKey(row.key)}
                  className="cursor-pointer border-t"
                  // Inline style, not a Tailwind arbitrary value: arbitrary-value backgrounds
                  // silently do not apply to <tr> in this codebase.
                  style={{ borderColor: 'var(--dashboard-border)' }}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{row.name || '—'}</div>
                    <div className="text-xs text-slate-500">
                      {row.kind === 'vehicle' ? 'Service customer · no sales record' : row.customerId}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    <div>{row.phone || '—'}</div>
                    <div className="text-xs text-slate-500">{row.city || ''}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.enquiryCount}</td>
                  <td className="px-3 py-2 tabular-nums">{row.bookingCount}</td>
                  <td className="px-3 py-2 tabular-nums">{row.vehicleCount}</td>
                  <td className="px-3 py-2 tabular-nums">{row.serviceCount}</td>
                  <td className="px-3 py-2">{fmtDate(row.lastActivityDate)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {GAPS.filter((g) => row.gaps[g.key]).map((g) => (
                        <span key={g.key} className="rounded px-1.5 py-0.5 text-[11px]"
                          style={{
                            backgroundColor: 'rgba(var(--dashboard-warning-rgb), 0.15)',
                            color: 'var(--dashboard-warning-text)',
                          }}>
                          {g.label}
                        </span>
                      ))}
                      {row.gapCount === 0 && <span className="text-xs text-slate-400">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {list.data && list.data.total > list.data.pageSize && (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {((list.data.page - 1) * list.data.pageSize + 1).toLocaleString('en-IN')}–
              {Math.min(list.data.page * list.data.pageSize, list.data.total).toLocaleString('en-IN')}
              {' of '}{list.data.total.toLocaleString('en-IN')}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="rounded border px-3 py-1 disabled:opacity-40"
                style={{ borderColor: 'var(--dashboard-border)' }}>Previous</button>
              <button type="button"
                disabled={list.data.page * list.data.pageSize >= list.data.total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border px-3 py-1 disabled:opacity-40"
                style={{ borderColor: 'var(--dashboard-border)' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(openKey)} onOpenChange={(open) => { if (!open) setOpenKey(null) }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{profile.data?.name || 'Customer profile'}</DialogTitle>
          </DialogHeader>
          {profile.isLoading && <p className="py-8 text-center text-slate-500">Loading…</p>}
          {profile.data && <ProfileBody profile={profile.data} />}
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--dashboard-primary-dark)' }}>{title}</h3>
      {children}
    </section>
  )
}

function ProfileBody({ profile }: { profile: KiaCustomerProfile }) {
  return (
    <div className="space-y-5 text-sm">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Phone', profile.phone || '—'],
          ['Email', profile.email || '—'],
          ['City', profile.city || '—'],
          ['Branch', profile.dealerCode || '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-slate-800">{value}</div>
          </div>
        ))}
      </div>

      {profile.notes.length > 0 && (
        <ul className="space-y-1 rounded-md border px-3 py-2 text-xs text-slate-700"
          style={{ borderColor: 'var(--dashboard-border)', backgroundColor: 'var(--dashboard-primary-soft)' }}>
          {profile.notes.map((note) => <li key={note}>• {note}</li>)}
        </ul>
      )}

      <Section title={`Vehicles (${profile.vehicles.length})`}>
        {profile.vehicles.length === 0
          ? <p className="text-slate-500">No vehicle on record.</p>
          : profile.vehicles.map((vehicle) => (
            <div key={vehicle.vin} className="rounded-md border p-3"
              style={{ borderColor: 'var(--dashboard-border)' }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium text-slate-800">
                  {vehicle.model || 'Unknown model'}
                  <span className="ml-2 text-xs font-normal text-slate-500">{vehicle.registration || vehicle.vin}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {vehicle.serviceCount} service{vehicle.serviceCount === 1 ? '' : 's'}
                  {vehicle.lastServiceDate ? ` · last ${fmtDate(vehicle.lastServiceDate)}` : ''}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                VIN {vehicle.vin}
                {' · '}
                {vehicle.insurance
                  ? `Insured to ${fmtDate(vehicle.insurance.expiryDate)}${vehicle.insurance.lapsed ? ' (LAPSED)' : ''}`
                  : 'No policy on record with us'}
              </div>
              {vehicle.complaints.length > 0 && (
                <div className="mt-2 text-xs">
                  {vehicle.complaints.map((c) => (
                    <div key={`${c.complaintNo}-${c.date}`} className="text-slate-700">
                      Complaint {c.complaintNo || '—'} · {fmtDate(c.date)} ·{' '}
                      {c.closeDate ? `closed ${fmtDate(c.closeDate)}` : 'OPEN'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </Section>

      {profile.enquiries.length > 0 && (
        <Section title={`Enquiries (${profile.enquiries.length})`}>
          <div className="space-y-1">
            {profile.enquiries.map((e) => (
              <div key={`${e.enquiryNo}`} className="flex flex-wrap gap-x-3 text-xs text-slate-700">
                <span className="text-slate-500">{fmtDate(e.enquiryDate)}</span>
                <span>{e.model || '—'}</span>
                <span className="text-slate-500">{e.status || ''}</span>
                {e.bookingNo
                  ? <span>→ booked {e.bookingNo} {e.deliveryDate ? `· delivered ${fmtDate(e.deliveryDate)}` : '· not delivered'}</span>
                  : <span className="text-slate-400">no booking</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {profile.receipts.length > 0 && (
        <Section title={`Payments (${profile.receipts.length})`}>
          <div className="text-xs text-slate-700">
            {profile.receipts.map((r, i) => (
              <span key={`${r.receiptDate}-${i}`} className="mr-3">{fmtDate(r.receiptDate)}</span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
