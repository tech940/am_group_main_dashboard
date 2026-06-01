import { uploadFile } from '@/lib/supabase/storage'

export type KiaProformaInvoiceRow = {
  id: string
  proformaDate: Date | string
  customerName: string
  mobileNumber: string
  customerAddress: string
  customerEmail: string
  modelName: string
  trimDescription: string
  fuelType: string
  vehicleColor: string
  bankName: string
  bankBranch?: string | null
  insuranceCompany?: string | null
  exShowroom: string | number
  tcsValue: string | number
  registrationCharges: string | number
  insuranceValue: string | number
  fastagValue: string | number
  accessoriesKit: string | number
  extWarranty: string | number
  cashDiscount: string | number
  exchangeValue: string | number
  bookingAmount: string | number
  govtEmployeeDiscount: string | number
  additionalDiscount: string | number
  totalCustomerCost: string | number
  grandTotalCost: string | number
  location?: string | null
}

type PdfPage = {
  commands: string[]
}

const FIELD_MAP: { label: string; key: keyof KiaProformaInvoiceRow; money: boolean }[] = [
  { label: 'Vehicle Model', key: 'modelName', money: false },
  { label: 'Trim / Variant', key: 'trimDescription', money: false },
  { label: 'Fuel Type', key: 'fuelType', money: false },
  { label: 'Colour', key: 'vehicleColor', money: false },
  { label: 'Insurance Company', key: 'insuranceCompany', money: false },
  { label: 'EX SHOWROOM', key: 'exShowroom', money: true },
  { label: 'T.C.S. @1%', key: 'tcsValue', money: true },
  { label: 'R.T.O / Registration', key: 'registrationCharges', money: true },
  { label: 'Insurance (Approx)', key: 'insuranceValue', money: true },
  { label: 'Fastag / Number Plate', key: 'fastagValue', money: true },
  { label: 'Accessories Kit', key: 'accessoriesKit', money: true },
  { label: 'Extended Warranty', key: 'extWarranty', money: true },
  { label: 'Total (To Be Borne By Customer)', key: 'totalCustomerCost', money: true },
  { label: 'Cash Discount', key: 'cashDiscount', money: true },
  { label: 'Exchange', key: 'exchangeValue', money: true },
  { label: 'Booking Amount', key: 'bookingAmount', money: true },
  { label: 'Govt. Employee Discount', key: 'govtEmployeeDiscount', money: true },
  { label: 'Additional Discount', key: 'additionalDiscount', money: true },
  { label: 'Grand Total', key: 'grandTotalCost', money: true },
]

function text(value: unknown) {
  return String(value ?? '').trim()
}

function htmlEscape(value: unknown) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function pdfEscape(value: unknown) {
  return text(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ')
}

function amount(value: unknown) {
  const raw = text(value).replace(/,/g, '')
  if (!raw || raw === '0') return '0'
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-IN') : text(value)
}

function dateLabel(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return text(value)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

function addressBlock(row: KiaProformaInvoiceRow) {
  const location = text(row.location) || 'Jammu'
  return {
    name: 'PLATINUM AUTOMOBILES PVT LTD',
    details: `AM Kia, ${htmlEscape(location)}<br>Authorized Kia Dealer`,
    pdfLines: [`AM Kia, ${location}`, 'Authorized Kia Dealer'],
  }
}

export function generateApprovedInvoiceTable(row: KiaProformaInvoiceRow) {
  return FIELD_MAP.map((item) => {
    const raw = row[item.key]
    const display = item.money ? amount(raw) : htmlEscape(raw) || '-'
    const bold = item.key === 'totalCustomerCost' || item.key === 'grandTotalCost'
    const style = bold ? 'font-weight:bold;' : ''

    return `<tr>
      <td class="lbl" style="${style}">${item.label}</td>
      <td class="amt" style="${style}">${display}</td>
    </tr>`
  }).join('')
}

export function buildKiaProformaInvoiceHtml(row: KiaProformaInvoiceRow) {
  const addressHTML = addressBlock(row)
  const bankName = text(row.bankName)
  const dealershipCode = bankName.toUpperCase() === 'J&K BANK' ? 'JKB0993J003' : 'NOT APPLICABLE'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #000; margin: 20px; line-height: 1.4; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .header { text-align: center; margin-bottom: 12px; }
  .section-title { text-align: center; font-size: 14px; font-weight: bold; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; table-layout: fixed; }
  td, th { border: 1px solid #000; padding: 5px 7px; word-wrap: break-word; overflow-wrap: break-word; }
  th { background: #e8e8e8; font-weight: bold; text-align: center; }
  .lbl { width: 55%; }
  .amt { width: 45%; text-align: right; }
  .info-lbl { width: 50%; }
  .info-val { width: 50%; text-align: right; }
  .payment { text-align: center; font-size: 11px; border-top: 1px solid #ccc; padding-top: 8px; margin-bottom: 10px; line-height: 1.6; }
  .dealership-code { font-size: 35px; font-weight: bold; }
  .tc { font-size: 11px; line-height: 1.6; margin-bottom: 10px; }
  .stamp { text-align: center; margin-bottom: 12px; }
  .stamp-box { display: inline-block; border: 2px solid #000; padding: 12px 20px; }
</style>
</head>
<body>

<div class="header">
  <h2>${addressHTML.name}</h2>
  ${addressHTML.details}
</div>

<div class="section-title">Proforma Invoice</div>

<table>
  <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
  <tr>
    <td class="info-lbl"><b>PROFORMA INVOICE NO.</b> ${htmlEscape(row.id.slice(0, 8).toUpperCase())}</td>
    <td class="info-val"><b>DATE:</b> ${dateLabel(row.proformaDate)}</td>
  </tr>
  <tr>
    <td class="info-lbl"><b>CUSTOMER NAME:</b> ${htmlEscape(row.customerName)}</td>
    <td class="info-val" style="font-size: 24px;"><b>Bank/Financer:</b> ${htmlEscape(row.bankName)}</td>
  </tr>
  <tr>
    <td class="info-lbl"><b>ADDRESS:</b> ${htmlEscape(row.customerAddress)}</td>
    <td class="info-val"><b>Branch:</b> ${htmlEscape(row.bankBranch || '')}</td>
  </tr>
  <tr>
    <td class="info-lbl"><b>MOBILE NO.:</b> ${htmlEscape(row.mobileNumber)}</td>
    <td class="info-val"><b>Email:</b> ${htmlEscape(row.customerEmail)}</td>
  </tr>
</table>

<table>
  <colgroup><col style="width:60%"><col style="width:40%"></colgroup>
  <tr>
    <th>PARTICULARS</th>
    <th>AMOUNT (INR)</th>
  </tr>
  ${generateApprovedInvoiceTable(row)}
</table>

<div class="stamp">
  <div class="stamp-box">
    <b>Dealer Stamp</b><br>(Signature/Seal)
  </div>
</div>

<div class="payment">
  <b>PAYMENT DETAILS:</b> All Payments favoring M/S PLATINUM AUTOMOBILES PVT LTD. Payable at Jammu<br>
  AC. No. 43418019645 | BRANCH: SBI-SME-JAMMU | IFSC: SBIN0014501<br>
  <div class="dealership-code">DEALERSHIP CODE: ${dealershipCode}</div>
  <b>Sales:</b> 9484211111 | <b>Finance:</b> 9086222430<br>
  <i>Complete payment must be made 24 hours prior to delivery.</i>
</div>

<div class="tc">
  <b>Terms &amp; Conditions:</b><br>
  1. The above prices are for Jammu until otherwise indicated.<br>
  2. Prices valid at the time of delivery will be applicable.<br>
  3. Any changes in taxes and/or levies shall be borne by the customer.<br>
  4. Prices and specifications are subject to change without notice.<br>
  5. Vehicle/model/color delivery subject to certain conditions.<br>
  6. Once the car is allotted &amp; in transit, payment to be made within 3 days or the car will be transferred to next booking.
</div>

<table style="border:none;">
  <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
  <tr>
    <td style="border:none;vertical-align:top;font-size:11px;line-height:1.6;">
      <b>For Exchange:</b><br>
      - RC<br>
      - Insurance (6 months old)<br>
      - Chassis traces
    </td>
    <td style="border:none;vertical-align:top;font-size:11px;line-height:1.6;">
      <b>For Govt. Employee:</b><br>
      - Aadhar Card<br>
      - PAN Card<br>
      - Latest Salary Slip<br>
      - ID Card
    </td>
  </tr>
</table>

</body>
</html>`
}

function wrap(value: string, maxChars: number) {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  words.forEach((word) => {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  })
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

export function buildKiaProformaPdf(row: KiaProformaInvoiceRow) {
  const width = 595
  const height = 842
  const margin = 20
  const pages: PdfPage[] = [{ commands: [] }]
  let page = pages[0]
  let y = height - margin

  const addPage = () => {
    page = { commands: [] }
    pages.push(page)
    y = height - margin
  }
  const ensure = (space: number) => {
    if (y - space < margin) addPage()
  }
  const textAt = (x: number, yy: number, value: string, size = 10, bold = false) => {
    page.commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${pdfEscape(value)}) Tj ET`)
  }
  const center = (yy: number, value: string, size = 10, bold = false) => {
    const estimate = value.length * size * 0.25
    textAt((width / 2) - estimate, yy, value, size, bold)
  }
  const rect = (x: number, yy: number, w: number, h: number, fill = false) => {
    page.commands.push(fill ? `0.91 g ${x} ${yy} ${w} ${h} re f 0 g` : `${x} ${yy} ${w} ${h} re S`)
  }

  const address = addressBlock(row)
  center(y, address.name, 15, true)
  y -= 16
  address.pdfLines.forEach((line) => {
    center(y, line, 10)
    y -= 13
  })
  y -= 8
  center(y, 'Proforma Invoice', 14, true)
  y -= 22

  const infoRows = [
    [`PROFORMA INVOICE NO. ${row.id.slice(0, 8).toUpperCase()}`, `DATE: ${dateLabel(row.proformaDate)}`],
    [`CUSTOMER NAME: ${text(row.customerName)}`, `Bank/Financer: ${text(row.bankName)}`],
    [`ADDRESS: ${text(row.customerAddress)}`, `Branch: ${text(row.bankBranch || '')}`],
    [`MOBILE NO.: ${text(row.mobileNumber)}`, `Email: ${text(row.customerEmail)}`],
  ]
  const tableX = margin
  const tableW = width - margin * 2
  const half = tableW / 2
  infoRows.forEach((cells) => {
    const rowH = Math.max(...cells.map((cell) => wrap(cell, 45).length)) * 12 + 8
    ensure(rowH)
    rect(tableX, y - rowH, half, rowH)
    rect(tableX + half, y - rowH, half, rowH)
    cells.forEach((cell, index) => {
      wrap(cell, 45).forEach((line, lineIndex) => textAt(tableX + (index * half) + 7, y - 15 - (lineIndex * 12), line, index === 1 && cell.startsWith('Bank') ? 14 : 9, cell.includes(':')))
    })
    y -= rowH
  })
  y -= 12

  ensure(24)
  rect(tableX, y - 22, tableW * 0.6, 22, true)
  rect(tableX + tableW * 0.6, y - 22, tableW * 0.4, 22, true)
  rect(tableX, y - 22, tableW * 0.6, 22)
  rect(tableX + tableW * 0.6, y - 22, tableW * 0.4, 22)
  textAt(tableX + 8, y - 14, 'PARTICULARS', 10, true)
  textAt(tableX + tableW * 0.6 + 8, y - 14, 'AMOUNT (INR)', 10, true)
  y -= 22
  FIELD_MAP.forEach((item) => {
    const raw = row[item.key]
    const display = item.money ? amount(raw) : text(raw) || '-'
    const bold = item.key === 'totalCustomerCost' || item.key === 'grandTotalCost'
    const h = 18
    ensure(h)
    rect(tableX, y - h, tableW * 0.6, h)
    rect(tableX + tableW * 0.6, y - h, tableW * 0.4, h)
    textAt(tableX + 8, y - 12, item.label, 9, bold)
    textAt(tableX + tableW * 0.6 + 8, y - 12, display, 9, bold)
    y -= h
  })

  y -= 16
  ensure(56)
  rect(width / 2 - 70, y - 42, 140, 42)
  center(y - 16, 'Dealer Stamp', 10, true)
  center(y - 30, '(Signature/Seal)', 9)
  y -= 58

  const dealershipCode = text(row.bankName).toUpperCase() === 'J&K BANK' ? 'JKB0993J003' : 'NOT APPLICABLE'
  const paymentLines = [
    'PAYMENT DETAILS: All Payments favoring M/S PLATINUM AUTOMOBILES PVT LTD. Payable at Jammu',
    'AC. No. 43418019645 | BRANCH: SBI-SME-JAMMU | IFSC: SBIN0014501',
    `DEALERSHIP CODE: ${dealershipCode}`,
    'Sales: 9484211111 | Finance: 9086222430',
    'Complete payment must be made 24 hours prior to delivery.',
  ]
  paymentLines.forEach((line, index) => {
    ensure(16)
    center(y, line, index === 2 ? 20 : 9, index <= 2)
    y -= index === 2 ? 24 : 13
  })

  y -= 8
  const terms = [
    'Terms & Conditions:',
    '1. The above prices are for Jammu until otherwise indicated.',
    '2. Prices valid at the time of delivery will be applicable.',
    '3. Any changes in taxes and/or levies shall be borne by the customer.',
    '4. Prices and specifications are subject to change without notice.',
    '5. Vehicle/model/color delivery subject to certain conditions.',
    '6. Once the car is allotted & in transit, payment to be made within 3 days or the car will be transferred to next booking.',
  ]
  terms.forEach((line, index) => {
    wrap(line, 100).forEach((part, lineIndex) => {
      ensure(13)
      textAt(margin, y, part, 8, index === 0 && lineIndex === 0)
      y -= 12
    })
  })

  y -= 8
  ensure(56)
  textAt(margin, y, 'For Exchange:', 9, true)
  textAt(margin, y - 13, '- RC', 8)
  textAt(margin, y - 25, '- Insurance (6 months old)', 8)
  textAt(margin, y - 37, '- Chassis traces', 8)
  textAt(width / 2, y, 'For Govt. Employee:', 9, true)
  textAt(width / 2, y - 13, '- Aadhar Card', 8)
  textAt(width / 2, y - 25, '- PAN Card', 8)
  textAt(width / 2, y - 37, '- Latest Salary Slip', 8)
  textAt(width / 2, y - 49, '- ID Card', 8)

  const objects: string[] = []
  const addObject = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const font1 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const font2 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const pageObjectIds: number[] = []
  pages.forEach((pdfPage) => {
    const content = pdfPage.commands.join('\n')
    const streamId = addObject(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${streamId} 0 R >>`)
    pageObjectIds.push(pageId)
  })
  const pagesId = addObject(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`)
  pageObjectIds.forEach((id) => {
    objects[id - 1] = objects[id - 1].replace('/Parent 0 0 R', `/Parent ${pagesId} 0 R`)
  })
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

export async function saveKiaProformaPdf(row: KiaProformaInvoiceRow) {
  const pdf = buildKiaProformaPdf(row)
  const base64 = `data:application/pdf;base64,${pdf.toString('base64')}`
  const result = await uploadFile(base64, 'kia-proforma', row.id)
  if (result.error || !result.url) {
    console.error('Unable to save Kia Proforma PDF:', result.error)
    return null
  }
  return result.url
}
