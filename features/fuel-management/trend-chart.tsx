'use client'

import * as React from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtInr, fmtQty } from './fuel-ui'

export type TrendDatum = { label: string; primary: number; secondary: number | null; extra?: number | null }

/**
 * Approved litres as bars, the recorded actual (or a second measure) as a line — one scale, one axis.
 * Colours come from the section tokens so the chart follows the dashboard accent and dark mode.
 */
export function TrendChart({
  data,
  primaryLabel,
  secondaryLabel,
  extraLabel,
  unit = 'L',
  height = 220,
  secondaryUnit,
}: {
  data: TrendDatum[]
  primaryLabel: string
  secondaryLabel: string
  extraLabel?: string
  unit?: string
  secondaryUnit?: string
  height?: number
}) {
  const hasSecondary = data.some((d) => (d.secondary ?? 0) > 0)
  const tickEvery = Math.max(1, Math.ceil(data.length / 8))
  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--fm-accent)]" />
          {primaryLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3.5 rounded bg-[var(--fm-ink)]" />
          {secondaryLabel}
          {!hasSecondary && <span className="text-slate-500">(none recorded yet)</span>}
        </span>
      </div>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 6, right: 8, bottom: 0, left: -12 }}
            title={`${primaryLabel} and ${secondaryLabel}`}
            desc={`${primaryLabel} as bars and ${secondaryLabel} as a line, one point per period.`}
          >
            <CartesianGrid vertical={false} stroke="var(--fm-rule)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={tickEvery - 1}
              tick={{ fontSize: 11, fill: 'var(--fm-muted)' }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={48}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: 'var(--fm-muted)' }}
            />
            {secondaryUnit && (
              // A second measure in a different unit gets its own scale — never drawn against litres.
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={40}
                tick={{ fontSize: 11, fill: 'var(--fm-muted)' }}
              />
            )}
            <Tooltip
              cursor={{ fill: 'rgba(var(--fm-accent-rgb), 0.06)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0]?.payload as TrendDatum | undefined
                if (!row) return null
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] shadow-[0_4px_16px_-4px_rgba(15,23,42,0.18)]">
                    <p className="font-semibold text-slate-900">{label}</p>
                    <p className="mt-1 tabular-nums text-slate-600">{primaryLabel}: {fmtQty(row.primary, unit)}</p>
                    <p className="tabular-nums text-slate-600">
                      {secondaryLabel}: {row.secondary === null ? '—' : secondaryUnit ? `${row.secondary.toFixed(1)} ${secondaryUnit}` : fmtQty(row.secondary, unit)}
                    </p>
                    {extraLabel && row.extra !== undefined && row.extra !== null && (
                      <p className="tabular-nums text-slate-600">{extraLabel}: {fmtInr(row.extra)}</p>
                    )}
                  </div>
                )
              }}
            />
            <Bar yAxisId="left" dataKey="primary" fill="var(--fm-accent)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Line
              yAxisId={secondaryUnit ? 'right' : 'left'}
              dataKey="secondary"
              type="monotone"
              stroke="var(--fm-ink)"
              strokeWidth={1.75}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{primaryLabel} and {secondaryLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{primaryLabel}</th>
            <th scope="col">{secondaryLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.filter((d) => d.primary || d.secondary).map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{fmtQty(d.primary, unit)}</td>
              <td>{d.secondary === null ? 'none' : secondaryUnit ? `${d.secondary.toFixed(1)} ${secondaryUnit}` : fmtQty(d.secondary, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
