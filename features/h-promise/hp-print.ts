/**
 * The printable H Promise MIS summary — A4 landscape, through a hidden same-origin iframe (the pattern in
 * lib/kia/print-payment-order.ts): the system print dialog, no popup, nothing from the page underneath.
 * Client-safe. Every value is escaped; the accent colour is read from the live theme and checked before use.
 */

import { formatStockNo } from '@/lib/h-promise/constants'
import type { InsightFilters, InsightResult } from '@/lib/h-promise/insights-core'

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inr = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? '—' : INR.format(value))
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayOf = (ymd: string | null) => (ymd ? `${Number(ymd.slice(8, 10))} ${SHORT[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}` : '—')

function accentColour(): string {
  if (typeof window === 'undefined') return '#334155'
  const raw = window.getComputedStyle(window.document.documentElement).getPropertyValue('--dashboard-primary').trim()
  return /^#[0-9a-f]{3,8}$/i.test(raw) || /^rgba?\([\d\s.,%]+\)$/i.test(raw) ? raw : '#334155'
}

export function periodTitle(filters: InsightFilters): string {
  if (filters.year === 'all') return filters.month === 'all' ? 'All time' : `${MONTHS[filters.month - 1]}, every year`
  return filters.month === 'all' ? `Calendar year ${filters.year}` : `${MONTHS[filters.month - 1]} ${filters.year}`
}

export function buildMisHtml(result: InsightResult, filters: InsightFilters, context: { location: string | null; printedBy: string; printedAt: string }): string {
  const accent = accentColour()
  const p = result.period
  const s = result.stock
  const scope = [context.location ? `Location: ${context.location}` : 'All locations', filters.soldBy ? `Sold by: ${filters.soldBy}` : null, filters.soldTo ? `Sold to: ${filters.soldTo}` : null]
    .filter(Boolean).join(' · ')

  const kpis: Array<[string, string, string]> = [
    ['Purchased', String(p.purchasedCount), inr(p.purchasedValue)],
    ['Sold', String(p.soldCount), `${inr(p.saleValue)}${p.soldPendingApproval ? ` · ${p.soldPendingApproval} awaiting approval` : ''}`],
    ['Gross profit', inr(p.grossProfit), `With GST ${inr(p.grossProfitWithGst)}`],
    ['Interest', inr(p.interest), 'On sold vehicles, to the sale date'],
    ['Net profit', inr(p.netProfit), p.netMarginPct === null ? '—' : `${p.netMarginPct.toFixed(1)} % of sales`],
    ['Stock now', String(s.count), `${inr(s.valueAtCost)} at cost · ${s.over60} over 60 days`],
  ]

  const monthRows = result.months.map((m) => `
    <tr>
      <td>${esc(m.label)}</td><td class="n">${m.purchasedCount}</td><td class="n">${esc(inr(m.purchasedValue))}</td>
      <td class="n">${m.bookedCount}</td><td class="n">${m.soldCount}</td><td class="n">${esc(inr(m.saleValue))}</td>
      <td class="n">${esc(inr(m.grossProfit))}</td><td class="n">${esc(inr(m.interest))}</td>
      <td class="n ${m.netProfit < 0 ? 'neg' : ''}">${esc(inr(m.netProfit))}</td>
    </tr>`).join('')

  const soldRows = result.soldRows.slice(0, 40).map((r) => `
    <tr>
      <td class="mono">${esc(formatStockNo(r.stockNo))}</td><td class="mono">${esc(r.regNo)}</td><td>${esc(r.model)}</td>
      <td>${esc(dayOf(r.saleDate))}</td><td>${esc(r.soldBy ?? '')}</td><td>${esc(r.soldTo ?? '')}</td>
      <td class="n">${esc(inr(r.sellingPrice))}</td><td class="n ${(r.economics.netProfit ?? 0) < 0 ? 'neg' : ''}">${esc(inr(r.economics.netProfit))}</td>
      <td>${r.saleStatus === 'approved' ? 'Approved' : 'Awaiting'}</td>
    </tr>`).join('')

  const mix = (title: string, rows: Array<{ key: string; count: number; value: number; netProfit: number }>) => `
    <div class="mix"><h3>${esc(title)}</h3><table>
      <thead><tr><th></th><th class="n">Cars</th><th class="n">Value</th><th class="n">Net profit</th></tr></thead>
      <tbody>${rows.slice(0, 8).map((m) => `<tr><td>${esc(m.key)}</td><td class="n">${m.count}</td><td class="n">${esc(inr(m.value))}</td><td class="n">${esc(inr(m.netProfit))}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table></div>`

  return `<!doctype html><html><head><meta charset="utf-8"><title>H Promise MIS — ${esc(periodTitle(filters))}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; font-size: 10.5px; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${accent}; padding-bottom: 6px; margin-bottom: 10px; }
  .plate { display: inline-flex; border: 1.5px solid #1f2937; border-radius: 4px; overflow: hidden; font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; letter-spacing: .08em; }
  .plate b { background: ${accent}; color: #fff; padding: 3px 5px; font-size: 7px; display: flex; align-items: center; }
  .plate span { padding: 3px 8px; font-size: 12px; }
  h1 { font-size: 17px; margin: 4px 0 0; }
  h2 { font-size: 12px; margin: 12px 0 5px; color: ${accent}; text-transform: uppercase; letter-spacing: .06em; }
  h3 { font-size: 10.5px; margin: 0 0 4px; }
  .meta { color: #64748b; text-align: right; line-height: 1.5; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); border: 1px solid #e2e8f0; border-radius: 6px; }
  .kpi { padding: 7px 9px; border-right: 1px solid #e2e8f0; }
  .kpi:last-child { border-right: 0; }
  .kpi small { display: block; color: #64748b; text-transform: uppercase; letter-spacing: .05em; font-size: 8.5px; }
  .kpi strong { display: block; font-size: 15px; margin-top: 2px; }
  .kpi em { display: block; font-style: normal; color: #64748b; font-size: 9px; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 3px 5px; border-bottom: 1px solid #e2e8f0; text-align: left; }
  th { background: #f8fafc; color: #475569; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .neg { color: #be123c; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .mixes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .foot { margin-top: 10px; color: #64748b; font-size: 8.5px; }
  tr { break-inside: avoid; }
</style></head><body>
<header>
  <div>
    <div class="plate"><b>IND</b><span>H PROMISE</span></div>
    <h1>AM Tata pre-owned — ${esc(periodTitle(filters))}</h1>
    <div style="color:#64748b">${esc(scope)}</div>
  </div>
  <div class="meta">Printed ${esc(context.printedAt)}<br>by ${esc(context.printedBy)}</div>
</header>
<section class="kpis">${kpis.map(([label, value, sub]) => `<div class="kpi"><small>${esc(label)}</small><strong>${esc(value)}</strong><em>${esc(sub)}</em></div>`).join('')}</section>
<h2>Month by month</h2>
<table><thead><tr><th>Month</th><th class="n">Bought</th><th class="n">Purchase value</th><th class="n">Booked</th><th class="n">Sold</th><th class="n">Sale value</th><th class="n">Gross profit</th><th class="n">Interest</th><th class="n">Net profit</th></tr></thead>
<tbody>${monthRows || '<tr><td colspan="9">No activity in this period.</td></tr>'}
<tr style="font-weight:700"><td>Total</td><td class="n">${p.purchasedCount}</td><td class="n">${esc(inr(p.purchasedValue))}</td><td class="n">${p.bookedCount}</td><td class="n">${p.soldCount}</td><td class="n">${esc(inr(p.saleValue))}</td><td class="n">${esc(inr(p.grossProfit))}</td><td class="n">${esc(inr(p.interest))}</td><td class="n ${p.netProfit < 0 ? 'neg' : ''}">${esc(inr(p.netProfit))}</td></tr>
</tbody></table>
<div class="mixes">
  ${mix('Sales by location', result.mix.soldByLocation)}
  ${mix('Sales by seller', result.mix.soldBy)}
  ${mix('Sold to', result.mix.soldTo)}
</div>
<h2>Vehicles sold${result.soldRows.length > 40 ? ` (first 40 of ${result.soldRows.length})` : ''}</h2>
<table><thead><tr><th>Stock</th><th>Plate</th><th>Model</th><th>Sold</th><th>By</th><th>To</th><th class="n">Price</th><th class="n">Net profit</th><th>Approval</th></tr></thead>
<tbody>${soldRows || '<tr><td colspan="9">No sales in this period.</td></tr>'}</tbody></table>
<p class="foot">Gross profit = selling − (purchase + other cost). Net profit = selling − (purchase with GST + other cost) − interest at the yearly rate on the purchase price, from purchase to sale. Rejected purchases and withdrawn or rejected sales are left out. Stock: ${s.count} cars (${s.bookedCount} booked), ${esc(inr(s.valueAtCost))} at cost, ${esc(inr(s.interestAccrued))} interest so far.</p>
</body></html>`
}

export function printHtml(html: string): void {
  if (typeof document === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  const cleanup = () => { iframe.parentNode?.removeChild(iframe) }
  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) { cleanup(); return }
    win.addEventListener('afterprint', () => setTimeout(cleanup, 250))
    setTimeout(cleanup, 60_000)
    win.focus()
    win.print()
  }
  iframe.srcdoc = html
  document.body.appendChild(iframe)
}
