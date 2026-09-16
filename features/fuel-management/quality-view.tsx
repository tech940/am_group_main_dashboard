'use client'

import * as React from 'react'
import Link from 'next/link'
import type { FuelManagementResponse } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { Bar, EmptyState, Panel, fmtCount } from './fuel-ui'

/**
 * What the figures on this page are missing, and where. A gap here is why a mileage, cost or comparison
 * elsewhere reads "not enough data" — never a reason to estimate one.
 */
export function QualityView({ data, navigate }: { data: FuelManagementResponse; navigate: FuelNavigate }) {
  const rows = data.quality
  return (
    <Panel id="fm-quality" title="Data quality" bodyClassName="p-0">
      <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-[12px] leading-relaxed text-slate-500">
        Figures on this page are only calculated from complete records. Each line shows how many records are missing
        something, out of the records that should have it.
      </div>
      {rows.length === 0 ? (
        <div className="p-6"><EmptyState title="No records to check in this view" /></div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => {
            const complete = row.of ? ((row.of - row.count) / row.of) * 100 : 100
            const canList = row.key !== 'gps_missing' && row.count > 0
            return (
              <li key={row.key} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-center hover:bg-slate-50/50 transition-colors">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-slate-900">{row.label}</p>
                  <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-slate-500">{row.description}</p>
                </div>
                <div>
                  <div className="mb-2 flex items-baseline justify-between text-[12px] tabular-nums">
                    {row.count ? (
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11.5px] font-bold text-amber-800 ring-1 ring-amber-200/70">
                        {fmtCount(row.count)} missing
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-800 ring-1 ring-emerald-200/70">
                        100% Complete
                      </span>
                    )}
                    <span className="font-mono text-[11.5px] text-slate-500">of {fmtCount(row.of)}</span>
                  </div>
                  <Bar pct={complete} tone={row.count ? 'review' : 'ok'} label={`${Math.round(complete)}% complete`} />
                </div>
                <div className="md:text-right">
                  {canList ? (
                    <button
                      type="button"
                      onClick={() => navigate.toTab('records', { quality: row.key, recordState: '' })}
                      className="inline-flex h-8.5 items-center rounded-xl border border-slate-200/90 bg-white px-3.5 text-[12.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-teal-300 hover:bg-teal-50/40 hover:text-teal-900"
                    >
                      Show {fmtCount(row.count)}
                      <span className="sr-only"> records: {row.label}</span>
                    </button>
                  ) : row.key === 'gps_missing' && row.count > 0 ? (
                    <Link href="/gate-pass" className="inline-flex h-8.5 items-center rounded-xl border border-slate-200/90 bg-white px-3.5 text-[12.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-teal-300 hover:bg-teal-50/40 hover:text-teal-900">
                      Link trackers
                    </Link>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-3 text-[11.5px] leading-relaxed text-slate-500">
        Checks for approved litres, actual litres, the gate-pass link and the full-tank answer only count records raised or closed
        from 16 Sep 2026, when those fields were added. Fuel-station location cannot be checked against GPS: stations are not
        recorded with coordinates.
      </div>
    </Panel>
  )
}
