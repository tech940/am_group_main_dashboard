import 'server-only'

import ExcelJS from 'exceljs'
import type { DiscountExportFilters } from './filters'

/*
 * Approved AM Hyundai / AM Platinum discount requests as an Excel workbook or a PDF (owner, 2026-09-19:
 * "export or download PDF … with filters … only approved or finalised"). Rows arrive already filtered and
 * already APPROVED (app/api/discount-approvals/export/route.ts); this file only lays them out.
 *
 * The PDF is written by hand — no PDF library in this repo, same approach as lib/kia-proforma/invoice.ts:
 * standard Helvetica with WinAnsi encoding, so text is folded to plain Latin and ₹ is printed as "Rs".
 */

export type ExportRow = {
  id: string
  branch: string
  requesterName: string
  tlManager: string | null
  customerId: string
  customerName: string | null
  model: string | null
  variant: string | null
  color: string | null
  insuranceType: string | null
  discountAmount: string | number
  accessoriesAmount: string | number | null
  teleDate: string | null
  reference: string | null
  remarks: string | null
  createdAt: Date | string
  history: unknown
}

export type ExportMeta = {
  filters: DiscountExportFilters
  generatedBy: string
  generatedAt: Date
}

const BRANCH_LABEL: Record<string, string> = { hyundai: 'AM Hyundai', platinum: 'AM Platinum' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const branchLabel = (b: string) => BRANCH_LABEL[String(b).toLowerCase()] ?? String(b).toUpperCase()

/** IST calendar parts of an instant. */
function ist(d: Date) {
  const t = new Date(d.getTime() + 330 * 60_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() }
}
/** '2026-09-19' (a plain calendar day) -> '19 Sep 2026'. */
function dayLabel(ymd: string | null | undefined) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(ymd || ''))
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}
function instantDayLabel(v: unknown) {
  const d = v instanceof Date ? v : new Date(String(v || ''))
  if (Number.isNaN(d.getTime())) return ''
  const p = ist(d)
  return `${p.d} ${MONTHS[p.m]} ${p.y}`
}
function stampLabel(d: Date) {
  const p = ist(d)
  const h12 = p.hh % 12 || 12
  return `${p.d} ${MONTHS[p.m]} ${p.y}, ${h12}:${String(p.mm).padStart(2, '0')} ${p.hh < 12 ? 'am' : 'pm'} IST`
}
function monthLabel(ym: string) {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(ym)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ym
}

type Approval = { name: string; at: string | null }
/** Who cleared each stage, read from the request's own history (the last matching entry wins). */
function approvals(history: unknown): { stage1: Approval | null; md: Approval | null } {
  const list = Array.isArray(history) ? (history as Array<Record<string, unknown>>) : []
  let stage1: Approval | null = null
  let md: Approval | null = null
  for (const h of list) {
    if (h?.action !== 'APPROVED') continue
    const a = { name: String(h.actorName || '').replace(/\s+/g, ' ').trim(), at: h.timestamp ? String(h.timestamp) : null }
    if (h.newStatus === 'PENDING_MD') stage1 = a
    else if (h.newStatus === 'APPROVED') md = a
  }
  return { stage1, md }
}

/** A plain-words description of the filters, for the file's header. */
export function describeFilters(f: DiscountExportFilters): string {
  const parts = [
    f.branch && f.branch !== 'all' ? branchLabel(f.branch) : 'AM Hyundai + AM Platinum',
    f.month && f.month !== 'all' ? `Tele month: ${monthLabel(f.month)}` : 'All months',
    f.insurance && f.insurance !== 'all' ? `Insurance: ${f.insurance}` : 'All insurance types',
  ]
  if (f.q.trim()) parts.push(`Search: "${f.q.trim()}"`)
  return parts.join(' · ')
}

export function exportFileName(f: DiscountExportFilters, ext: 'xlsx' | 'pdf', at: Date) {
  const p = ist(at)
  const day = `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
  const brand = f.branch && f.branch !== 'all' ? f.branch : 'hyundai-platinum'
  const month = f.month && f.month !== 'all' ? `_${f.month}` : ''
  return `approved-discounts_${brand}${month}_${day}.${ext}`
}

// ── Excel ────────────────────────────────────────────────────────────────────────────────────────────

export async function buildDiscountExcel(rows: ExportRow[], meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AM Group Dashboard'
  wb.created = meta.generatedAt
  const ws = wb.addWorksheet('Approved discounts', { views: [{ state: 'frozen', ySplit: 1 }] })
  const money = '"₹"#,##0'
  ws.columns = [
    { header: 'Tele Date', key: 'tele', width: 13 },
    { header: 'Branch', key: 'branch', width: 13 },
    { header: 'Requester (Sales Exec)', key: 'requester', width: 22 },
    { header: 'TL / Manager', key: 'tl', width: 18 },
    { header: 'Customer ID', key: 'customerId', width: 15 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Model', key: 'model', width: 16 },
    { header: 'Variant', key: 'variant', width: 30 },
    { header: 'Colour', key: 'color', width: 16 },
    { header: 'Insurance', key: 'insurance', width: 11 },
    { header: 'Discount', key: 'discount', width: 12, style: { numFmt: money } },
    { header: 'Accessories', key: 'accessories', width: 12, style: { numFmt: money } },
    { header: 'Stage 1 approved by', key: 'stage1By', width: 20 },
    { header: 'Stage 1 approved on', key: 'stage1On', width: 15 },
    { header: 'MD approved by', key: 'mdBy', width: 20 },
    { header: 'MD approved on', key: 'mdOn', width: 15 },
    { header: 'Reference', key: 'reference', width: 20 },
    { header: 'Remarks', key: 'remarks', width: 28 },
    { header: 'Submitted on', key: 'submitted', width: 14 },
  ]
  for (const r of rows) {
    const a = approvals(r.history)
    ws.addRow({
      tele: dayLabel(r.teleDate) || instantDayLabel(r.createdAt),
      branch: branchLabel(r.branch),
      requester: r.requesterName,
      tl: r.tlManager || '',
      customerId: r.customerId,
      customer: r.customerName || '',
      model: r.model || '',
      variant: r.variant || '',
      color: r.color || '',
      insurance: r.insuranceType || '',
      discount: num(r.discountAmount),
      accessories: num(r.accessoriesAmount),
      stage1By: a.stage1?.name || '',
      stage1On: a.stage1?.at ? instantDayLabel(a.stage1.at) : '',
      mdBy: a.md?.name || '',
      mdOn: a.md?.at ? instantDayLabel(a.md.at) : '',
      reference: r.reference || '',
      remarks: r.remarks || '',
      submitted: instantDayLabel(r.createdAt),
    })
  }
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF055B65' } }
  header.alignment = { vertical: 'middle' }
  header.height = 20
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: ws.columns.length } }
  const total = ws.addRow({
    customer: `Total — ${rows.length} approved`,
    discount: rows.reduce((s, r) => s + num(r.discountAmount), 0),
    accessories: rows.reduce((s, r) => s + num(r.accessoriesAmount), 0),
  })
  total.font = { bold: true }
  total.border = { top: { style: 'thin' } }

  const about = wb.addWorksheet('About this export')
  about.columns = [{ width: 22 }, { width: 70 }]
  about.addRows([
    ['Contents', 'Discount requests the MD has approved (status APPROVED). Pending and rejected requests are never exported.'],
    ['Filters', describeFilters(meta.filters)],
    ['Requests', rows.length],
    ['Generated', stampLabel(meta.generatedAt)],
    ['Generated by', meta.generatedBy],
  ])
  about.getColumn(1).font = { bold: true }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ── PDF ──────────────────────────────────────────────────────────────────────────────────────────────

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, from the standard AFM metrics.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]

/**
 * Fold to what standard Helvetica (WinAnsi) can print: ASCII plus the Latin-1 range (the "·" separator),
 * accents dropped, ₹ as "Rs", one space for any whitespace run — anything else becomes "?".
 */
function pdfText(value: unknown): string {
  return String(value ?? '')
    .replace(/₹/g, 'Rs ')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .trim()
}
function textWidth(s: string, size: number, bold: boolean) {
  const table = bold ? W_BOLD : W_REG
  let w = 0
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    w += c >= 32 && c <= 126 ? table[c - 32] : 556
  }
  return (w * size) / 1000
}
/** Cut to fit `max` points, ending in "..." when cut. */
function fit(s: string, max: number, size: number, bold: boolean) {
  if (textWidth(s, size, bold) <= max) return s
  let out = s
  while (out.length > 1 && textWidth(`${out}...`, size, bold) > max) out = out.slice(0, -1)
  return `${out.trimEnd()}...`
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const rupees = (v: number) => `Rs ${Math.round(v).toLocaleString('en-IN')}`

type Rgb = [number, number, number]
const TEAL: Rgb = [0.02, 0.357, 0.396]
const INK: Rgb = [0.09, 0.12, 0.16]
const MUTED: Rgb = [0.39, 0.45, 0.53]
const ZEBRA: Rgb = [0.965, 0.973, 0.98]
const RULE: Rgb = [0.85, 0.88, 0.91]
const WHITE: Rgb = [1, 1, 1]
const rgb = (c: Rgb) => c.map((n) => n.toFixed(3)).join(' ')

type Col = { title: string; w: number; right?: boolean; cell: (r: ExportRow, i: number) => string }

export function buildDiscountPdf(rows: ExportRow[], meta: ExportMeta): Buffer {
  const PAGE_W = 842
  const PAGE_H = 595
  const M = 28
  const ROW_H = 15
  const HEAD_H = 18
  const FONT = 7.2
  const PAD = 3

  const cols: Col[] = [
    { title: '#', w: 18, right: true, cell: (_r, i) => String(i + 1) },
    { title: 'Tele date', w: 48, cell: (r) => dayLabel(r.teleDate) || instantDayLabel(r.createdAt) },
    { title: 'Branch', w: 50, cell: (r) => branchLabel(r.branch) },
    { title: 'Requester', w: 74, cell: (r) => r.requesterName },
    { title: 'TL / Manager', w: 62, cell: (r) => r.tlManager || '' },
    { title: 'Customer ID', w: 60, cell: (r) => r.customerId },
    { title: 'Customer', w: 86, cell: (r) => r.customerName || '' },
    { title: 'Vehicle', w: 120, cell: (r) => [r.model, r.variant].filter(Boolean).join(' - ') },
    { title: 'Insurance', w: 46, cell: (r) => r.insuranceType || '' },
    { title: 'Discount', w: 52, right: true, cell: (r) => rupees(num(r.discountAmount)) },
    { title: 'Accessories', w: 54, right: true, cell: (r) => (num(r.accessoriesAmount) ? rupees(num(r.accessoriesAmount)) : '-') },
    { title: 'Approved by', w: 62, cell: (r) => approvals(r.history).md?.name || '' },
    { title: 'Approved on', w: 54, cell: (r) => { const md = approvals(r.history).md; return md?.at ? instantDayLabel(md.at) : '' } },
  ]
  const tableW = cols.reduce((s, c) => s + c.w, 0) // 786 = the page width inside the margins (keep it so)

  const title = meta.filters.branch && meta.filters.branch !== 'all'
    ? `${branchLabel(meta.filters.branch)} - approved discount requests`
    : 'AM Hyundai + AM Platinum - approved discount requests'
  const totalDiscount = rows.reduce((s, r) => s + num(r.discountAmount), 0)
  const totalAccessories = rows.reduce((s, r) => s + num(r.accessoriesAmount), 0)

  const pages: string[][] = []
  let ops: string[] = []
  let y = 0

  const text = (s: string, x: number, yy: number, size: number, bold: boolean, color: Rgb) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td (${esc(s)}) Tj ET`)
  const rect = (x: number, yy: number, w: number, h: number, color: Rgb) =>
    ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`)
  const rule = (x1: number, yy: number, x2: number, color: Rgb) =>
    ops.push(`${rgb(color)} RG 0.5 w ${x1.toFixed(2)} ${yy.toFixed(2)} m ${x2.toFixed(2)} ${yy.toFixed(2)} l S`)

  const headerRow = () => {
    rect(M, y - HEAD_H, tableW, HEAD_H, TEAL)
    let x = M
    for (const c of cols) {
      const t = fit(c.title.toUpperCase(), c.w - 2 * PAD, 6.4, true)
      const tx = c.right ? x + c.w - PAD - textWidth(t, 6.4, true) : x + PAD
      text(t, tx, y - HEAD_H + 6.3, 6.4, true, WHITE)
      x += c.w
    }
    y -= HEAD_H
  }
  const newPage = (first: boolean) => {
    if (ops.length) pages.push(ops)
    ops = []
    y = PAGE_H - M
    if (first) {
      text(pdfText(title), M, y - 14, 14, true, INK)
      text(pdfText(describeFilters(meta.filters)), M, y - 28, 8.5, false, MUTED)
      text(pdfText(`${rows.length} approved request${rows.length === 1 ? '' : 's'}  ·  Discount ${rupees(totalDiscount)}  ·  Accessories ${rupees(totalAccessories)}`), M, y - 41, 8.5, true, INK)
      y -= 52
    } else {
      text(pdfText(`${title} (continued)`), M, y - 10, 9, true, MUTED)
      y -= 18
    }
    headerRow()
  }

  newPage(true)
  if (rows.length === 0) {
    text('No approved requests match these filters.', M + PAD, y - 12, 8.5, false, MUTED)
    y -= ROW_H
  }
  rows.forEach((r, i) => {
    if (y - ROW_H < M + 14) newPage(false)
    if (i % 2 === 1) rect(M, y - ROW_H, tableW, ROW_H, ZEBRA)
    let x = M
    for (const c of cols) {
      const t = fit(pdfText(c.cell(r, i)), c.w - 2 * PAD, FONT, false)
      const tx = c.right ? x + c.w - PAD - textWidth(t, FONT, false) : x + PAD
      text(t, tx, y - ROW_H + 5, FONT, false, INK)
      x += c.w
    }
    y -= ROW_H
  })
  if (rows.length) {
    if (y - ROW_H < M + 14) newPage(false)
    rule(M, y, M + tableW, RULE)
    const discountX = M + cols.slice(0, 9).reduce((s, c) => s + c.w, 0)
    text(`Total - ${rows.length} approved`, M + PAD, y - ROW_H + 5, FONT, true, INK)
    const d = rupees(totalDiscount)
    const a = rupees(totalAccessories)
    text(d, discountX + cols[9].w - PAD - textWidth(d, FONT, true), y - ROW_H + 5, FONT, true, INK)
    text(a, discountX + cols[9].w + cols[10].w - PAD - textWidth(a, FONT, true), y - ROW_H + 5, FONT, true, INK)
    y -= ROW_H
  }
  pages.push(ops)

  // Footers need the page count, so they are added once every page exists.
  const footer = pdfText(`Generated ${stampLabel(meta.generatedAt)} by ${meta.generatedBy} · Approved requests only · AM Group`)
  pages.forEach((p, i) => {
    ops = p
    text(fit(footer, 600, 7, false), M, 16, 7, false, MUTED)
    const pn = `Page ${i + 1} of ${pages.length}`
    text(pn, PAGE_W - M - textWidth(pn, 7, false), 16, 7, false, MUTED)
  })

  // Assemble: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page + its content per page.
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 5 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pages.forEach((p, i) => {
    const pageId = pageIds[i]
    const content = p.join('\n')
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1')
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
