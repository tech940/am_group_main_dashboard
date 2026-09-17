'use client'

import * as React from 'react'
import { Calendar, Car, FileSpreadsheet, Layers, ShieldCheck, Download, Printer } from 'lucide-react'
import { FUEL_REPORTS, type FuelReportGroup } from '@/lib/fuel-management/reports'
import type { FuelManagementResponse } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { BreakdownTable } from './overview-view'
import { Panel, fmtRange } from './fuel-ui'

const GROUP_CONFIG: Record<FuelReportGroup, { label: string; icon: React.ComponentType<{ className?: string }>; badgeClass: string; iconClass: string }> = {
  Period: { label: 'Period', icon: Calendar, badgeClass: 'bg-blue-50 text-blue-700 ring-blue-200/70', iconClass: 'group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:ring-blue-200' },
  Vehicles: { label: 'Vehicles', icon: Car, badgeClass: 'bg-amber-50 text-amber-800 ring-amber-200/70', iconClass: 'group-hover:bg-amber-50 group-hover:text-amber-700 group-hover:ring-amber-200' },
  Organisation: { label: 'Organisation', icon: Layers, badgeClass: 'bg-violet-50 text-violet-700 ring-violet-200/70', iconClass: 'group-hover:bg-violet-50 group-hover:text-violet-700 group-hover:ring-violet-200' },
  Accountability: { label: 'Accountability', icon: ShieldCheck, badgeClass: 'bg-emerald-50 text-emerald-800 ring-emerald-200/70', iconClass: 'group-hover:bg-emerald-50 group-hover:text-emerald-700 group-hover:ring-emerald-200' },
}

const GROUPS: FuelReportGroup[] = ['Period', 'Vehicles', 'Organisation', 'Accountability']

export function ReportsView({ data, navigate }: { data: FuelManagementResponse; navigate: FuelNavigate }) {
  const period = fmtRange(data.filters.from, data.filters.to)
  const maxOf = (rows: { approvedQty: number }[]) => Math.max(1, ...rows.map((r) => r.approvedQty))
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Panel
        id="fm-report-catalogue"
        title="Download a report"
        className="fm-noprint xl:col-span-1"
        bodyClassName="p-0"
        action={<span className="text-[12px] font-semibold text-slate-500">{period}</span>}
      >
        <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-[12px] leading-relaxed text-slate-500">
          Each report is an Excel file built from the same figures as this page, with the period and filters you have chosen.
        </div>
        <div className="divide-y divide-slate-100">
          {GROUPS.map((group) => {
            const conf = GROUP_CONFIG[group]
            const GroupIcon = conf.icon
            return (
              <div key={group} className="px-5 py-4">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${conf.badgeClass}`}>
                    <GroupIcon className="size-3" />
                    {conf.label}
                  </span>
                </div>
                <ul className="space-y-2">
                  {FUEL_REPORTS.filter((r) => r.group === group).map((report) => (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => navigate.download(report.id)}
                        className="group flex w-full items-start gap-3 rounded-xl border border-transparent p-2.5 text-left transition-all duration-150 hover:border-slate-200/80 hover:bg-slate-50/90 hover:shadow-2xs cursor-pointer"
                      >
                        <div className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 ring-1 ring-slate-200/60 transition-colors ${conf.iconClass}`}>
                          <Download aria-hidden className="size-4" />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-slate-900 group-hover:text-slate-950">{report.title}</span>
                          <span className="block text-xs leading-snug text-slate-500 font-normal">{report.description}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </Panel>

      <div className="space-y-5 xl:col-span-2 print:col-span-3">
        <Panel
          id="fm-report-branch"
          title="By branch"
          bodyClassName="p-0"
          action={
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:text-slate-900 print:hidden"
            >
              <Printer aria-hidden className="size-3.5" /> Print
            </button>
          }
        >
          <BreakdownTable rows={data.breakdowns.branch} maxQty={maxOf(data.breakdowns.branch)} label="Branch" />
        </Panel>
        <Panel id="fm-report-department" title="By department using the fuel" bodyClassName="p-0">
          <BreakdownTable rows={data.breakdowns.department} maxQty={maxOf(data.breakdowns.department)} label="Department" />
          {data.breakdowns.department.some((r) => r.key === 'NONE') && (
            <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-3 text-[11.5px] leading-relaxed text-slate-500">
              &ldquo;Not recorded&rdquo; is fuel requested before the department was asked for on the request form (16 Sep 2026).
            </div>
          )}
        </Panel>
        <Panel id="fm-report-vehicle" title="Top consumers" bodyClassName="p-0">
          <BreakdownTable rows={data.breakdowns.vehicle} maxQty={maxOf(data.breakdowns.vehicle)} label="Vehicle or equipment" />
        </Panel>
      </div>
    </div>
  )
}
