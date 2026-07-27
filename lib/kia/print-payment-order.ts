// Print engine for Vendor Payment orders. Builds a self-contained A4 voucher and hands it to the
// BROWSER's print pipeline via a hidden same-origin iframe:
//  - the system print dialog lists every printer the user's OS knows (local, network, shared), so
//    "print with my printer wherever it is" works without any server-side print infrastructure;
//  - an iframe (not window.open) means no popup blockers, no navigation, and the page underneath is
//    never part of the printout;
//  - the document is fully inline (no external CSS/images) so it prints identically everywhere.
// Client-safe: no server imports; call it from any onClick.

export type PrintablePaymentOrder = {
  id: string
  createdAt: string
  name: string
  email: string
  employeeId: string | null
  location: string | null
  dealerName: string | null
  department: string | null
  approvalType: string | null
  vendorName: string | null
  amount: string
  typeOfPayment: string | null
  previousAdvance: string | null
  gst: string | null
  glCode: string | null
  glName: string | null
  tallyGroup: string | null
  invoiceNumber: string | null
  remarks: string | null
  managementRemarks: string | null
  vpApproval: string | null
  accountApproval: string | null
  hrApproval: string | null
  eaApproval: string | null
  managementApproval: string | null
  paymentStatus: string
  utrNumber: string | null
  paymentCompletedAt: string | null
}

// Every value is user-entered data (vendor names, remarks); escape everything that lands in HTML.
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  return `${h ? ONES[h] + ' Hundred' : ''}${h && rest ? ' ' : ''}${rest ? twoDigits(rest) : ''}`
}

/** Indian-system (crore/lakh) amount in words, e.g. 1234567.5 → "Twelve Lakh Thirty Four Thousand …". */
export function amountInWordsINR(value: number): string {
  if (!Number.isFinite(value) || value < 0) return ''
  const rupees = Math.floor(value)
  const paise = Math.round((value - rupees) * 100)
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only'

  const parts: string[] = []
  const crore = Math.floor(rupees / 10000000)
  const lakh = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const below = rupees % 1000
  if (crore) parts.push(`${twoDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (below) parts.push(threeDigits(below))

  let words = parts.length ? `${parts.join(' ')} Rupees` : ''
  if (paise) words += `${words ? ' and ' : ''}${twoDigits(paise)} Paise`
  return `${words} Only`
}

function formatINR(value: string): string {
  const n = Number(String(value).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n)) return esc(value)
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return esc(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function approvalCell(label: string, value: string | null): string {
  const v = String(value || '').trim()
  const upper = v.toUpperCase()
  const tone = upper.includes('APPROV') || upper === 'YES'
    ? '#047857'
    : upper.includes('REJECT') || upper.includes('DECLIN') || upper === 'NO'
      ? '#be123c'
      : '#92400e'
  return `<td>
    <div class="appr-label">${esc(label)}</div>
    <div class="appr-value" style="color:${tone}">${esc(v || 'Pending')}</div>
  </td>`
}

function row(label: string, value: string): string {
  return `<tr><td class="k">${esc(label)}</td><td class="v">${value}</td></tr>`
}

export function buildPaymentOrderHtml(order: PrintablePaymentOrder): string {
  const ref = order.id.slice(0, 8).toUpperCase()
  const amountNumber = Number(String(order.amount).replace(/[^0-9.-]/g, ''))
  const words = Number.isFinite(amountNumber) ? amountInWordsINR(amountNumber) : ''
  const paid = String(order.paymentStatus || '').toLowerCase() === 'completed'

  return `<!doctype html><html><head><meta charset="utf-8"><title>Payment Order ${esc(ref)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.45; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 10px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: .5px; }
  .brand small { display: block; font-size: 11px; font-weight: 600; color: #475569; letter-spacing: 2px; }
  .doc { text-align: right; }
  .doc .title { font-size: 15px; font-weight: 800; letter-spacing: 1.5px; }
  .doc .ref { font-family: Consolas, monospace; font-size: 13px; font-weight: 700; margin-top: 2px; }
  .doc .date { color: #475569; font-size: 11px; margin-top: 2px; }
  .grid { display: flex; gap: 12px; margin-top: 12px; }
  .panel { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; }
  .panel h3 { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: 2.5px 0; vertical-align: top; }
  table.kv td.k { color: #64748b; width: 42%; padding-right: 8px; }
  table.kv td.v { font-weight: 600; }
  .amount-box { margin-top: 12px; border: 2px solid #0f172a; border-radius: 6px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
  .amount-box .num { font-size: 22px; font-weight: 800; }
  .amount-box .words { font-size: 11px; font-weight: 600; color: #334155; max-width: 60%; text-align: right; }
  .appr { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .appr td { border: 1px solid #cbd5e1; padding: 8px 10px; width: 20%; }
  .appr-label { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #64748b; }
  .appr-value { font-weight: 700; font-size: 11.5px; margin-top: 2px; }
  .paid-stamp { display: inline-block; margin-left: 8px; padding: 2px 10px; border: 2px solid #047857; color: #047857; border-radius: 4px; font-weight: 800; font-size: 11px; letter-spacing: 1px; }
  .remarks { margin-top: 12px; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 8px 12px; color: #334155; }
  .sig { display: flex; justify-content: space-between; gap: 16px; margin-top: 34px; }
  .sig div { flex: 1; text-align: center; font-size: 10.5px; color: #475569; border-top: 1px solid #0f172a; padding-top: 5px; }
  .foot { margin-top: 18px; text-align: center; font-size: 9.5px; color: #94a3b8; }
</style></head><body>
  <div class="head">
    <div class="brand">AM GROUP<small>${esc(order.dealerName || 'VENDOR PAYMENTS')}</small></div>
    <div class="doc">
      <div class="title">VENDOR PAYMENT ORDER</div>
      <div class="ref">#${esc(ref)}</div>
      <div class="date">Requested: ${formatDate(order.createdAt)} · Printed: ${formatDate(new Date().toISOString())}</div>
    </div>
  </div>

  <div class="grid">
    <div class="panel">
      <h3>Payee / Vendor</h3>
      <table class="kv">
        ${row('Vendor', esc(order.vendorName || '—'))}
        ${row('Payment For', esc(order.approvalType || '—'))}
        ${row('Invoice No', esc(order.invoiceNumber || '—'))}
        ${row('Mode', esc(order.typeOfPayment || '—'))}
        ${order.previousAdvance ? row('Previous Advance', formatINR(order.previousAdvance)) : ''}
        ${order.gst ? row('GST', esc(order.gst)) : ''}
      </table>
    </div>
    <div class="panel">
      <h3>Requested By</h3>
      <table class="kv">
        ${row('Name', esc(order.name))}
        ${order.employeeId ? row('Employee ID', esc(order.employeeId)) : ''}
        ${row('Department', esc(order.department || '—'))}
        ${row('Location', esc(order.location || '—'))}
        ${row('Email', esc(order.email))}
      </table>
    </div>
    <div class="panel">
      <h3>Ledger</h3>
      <table class="kv">
        ${row('GL Code', esc(order.glCode || '—'))}
        ${row('GL Name', esc(order.glName || '—'))}
        ${row('Tally Group', esc(order.tallyGroup || '—'))}
      </table>
    </div>
  </div>

  <div class="amount-box">
    <div class="num">${formatINR(order.amount)}${paid ? '<span class="paid-stamp">PAID</span>' : ''}</div>
    <div class="words">${esc(words)}</div>
  </div>

  <table class="appr"><tr>
    ${approvalCell('VP', order.vpApproval)}
    ${approvalCell('Accounts', order.accountApproval)}
    ${approvalCell('HR', order.hrApproval)}
    ${approvalCell('EA', order.eaApproval)}
    ${approvalCell('Management', order.managementApproval)}
  </tr></table>

  ${paid ? `<div class="remarks"><strong>Payment:</strong> Completed ${formatDate(order.paymentCompletedAt)}${order.utrNumber ? ` · UTR ${esc(order.utrNumber)}` : ''}</div>` : ''}
  ${order.remarks ? `<div class="remarks"><strong>Remarks:</strong> ${esc(order.remarks)}</div>` : ''}
  ${order.managementRemarks ? `<div class="remarks"><strong>Management Remarks:</strong> ${esc(order.managementRemarks)}</div>` : ''}

  <div class="sig">
    <div>Prepared By</div>
    <div>Verified By (Accounts)</div>
    <div>Approved By</div>
    <div>Authorised Signatory</div>
  </div>
  <div class="foot">Computer-generated payment order · AM Group operations dashboard · Ref ${esc(order.id)}</div>
</body></html>`
}

/**
 * Open the system print dialog for one payment order. The user picks any printer their OS knows.
 * The iframe is removed after printing (afterprint), with a timeout fallback for browsers that
 * don't fire it reliably.
 */
export function printPaymentOrder(order: PrintablePaymentOrder): void {
  if (typeof document === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'

  const cleanup = () => { iframe.parentNode?.removeChild(iframe) }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) { cleanup(); return }
    win.addEventListener('afterprint', () => setTimeout(cleanup, 250))
    // Fallback: some browsers never fire afterprint inside iframes.
    setTimeout(cleanup, 60_000)
    win.focus()
    win.print()
  }

  iframe.srcdoc = buildPaymentOrderHtml(order)
  document.body.appendChild(iframe)
}
