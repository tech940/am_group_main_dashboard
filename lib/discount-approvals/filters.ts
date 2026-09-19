/**
 * The Hyundai / Platinum discount dashboard's filters, as ONE pure function (client-safe, no server-only).
 *
 * The dashboard counts "N approved to export" with it and the export route selects rows with it, so the
 * number on the button is always the number of rows in the file. It mirrors the table's own filter in
 * app/brands/hyundai/sales/discount-approvals/discount-approvals-client.tsx — change both together.
 */

export type DiscountExportFilters = {
  /** 'hyundai' | 'platinum' | 'all' — 'all' means every branch the viewer may see. */
  branch: string
  /** 'YYYY-MM' (tele date, else submitted date) or 'all'. */
  month: string
  /** 'In House' | 'Out House' | 'all'. */
  insurance: string
  /** Free text over customer, customer ID, requester, TL / manager and model. */
  q: string
}

export type DiscountFilterable = {
  branch: string
  status: string
  customerName: string | null
  customerId: string | null
  requesterName: string | null
  tlManager: string | null
  model: string | null
  insuranceType?: string | null
  teleDate?: string | null
  createdAt: string | Date
}

/** Only a request the MD has finally approved is exported — never pending or rejected ones. */
export const EXPORTABLE_STATUS = 'APPROVED'

function monthOf(item: DiscountFilterable): string {
  const created = item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt || '')
  return (item.teleDate || created.substring(0, 10)).substring(0, 7)
}

export function matchesDiscountFilters(item: DiscountFilterable, f: DiscountExportFilters): boolean {
  const q = f.q.trim().toLowerCase()
  if (q) {
    const hit = [item.customerName, item.customerId, item.requesterName, item.tlManager, item.model]
      .some((v) => (v || '').toLowerCase().includes(q))
    if (!hit) return false
  }
  if (f.branch && f.branch !== 'all' && (item.branch || '').toLowerCase() !== f.branch.toLowerCase()) return false
  if (f.month && f.month !== 'all' && monthOf(item) !== f.month) return false
  if (f.insurance && f.insurance !== 'all' && item.insuranceType !== f.insurance) return false
  return true
}

export function isExportable(item: DiscountFilterable, f: DiscountExportFilters): boolean {
  return item.status === EXPORTABLE_STATUS && matchesDiscountFilters(item, f)
}

export function parseDiscountExportFilters(params: URLSearchParams): DiscountExportFilters {
  const month = (params.get('month') || 'all').trim()
  const insurance = (params.get('insurance') || 'all').trim()
  return {
    branch: (params.get('branch') || 'all').trim().toLowerCase(),
    month: /^[0-9]{4}-[0-9]{2}$/.test(month) ? month : 'all',
    insurance: insurance === 'In House' || insurance === 'Out House' ? insurance : 'all',
    q: (params.get('q') || '').slice(0, 100),
  }
}

export function discountExportQuery(f: DiscountExportFilters, format: 'xlsx' | 'pdf'): string {
  const p = new URLSearchParams({ format, branch: f.branch || 'all', month: f.month || 'all', insurance: f.insurance || 'all' })
  if (f.q.trim()) p.set('q', f.q.trim())
  return p.toString()
}
