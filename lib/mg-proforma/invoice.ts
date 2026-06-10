import { uploadFile } from '@/lib/supabase/storage'
import fs from 'fs'
import path from 'path'

export type MgProformaInvoiceRow = {
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
  importMetadata?: Record<string, unknown> | null
}

type PdfPage = {
  commands: string[]
}

type PdfImageAsset = {
  name: string
  width: number
  height: number
  bytes: Buffer
}

type PdfObjectBody = string | Buffer

const FIELD_MAP: { label: string; key: keyof MgProformaInvoiceRow; money: boolean }[] = [
  { label: 'Vehicle Model', key: 'modelName', money: false },
  { label: 'Variant', key: 'trimDescription', money: false },
  { label: 'Fuel Type', key: 'fuelType', money: false },
  { label: 'Colour', key: 'vehicleColor', money: false },
  { label: 'EX SHOWROOM', key: 'exShowroom', money: true },
  { label: 'T.C.S. @1%', key: 'tcsValue', money: true },
  { label: 'R.T.O @9%', key: 'registrationCharges', money: true },
  { label: 'Insurance (Approx)', key: 'insuranceValue', money: true },
  { label: 'ACCESSORIES COMBO', key: 'accessoriesKit', money: true },
  { label: 'Warranty', key: 'extWarranty', money: true },
  { label: 'Total (To Be Borne By Customer)', key: 'totalCustomerCost', money: true },
  { label: 'Cash Discount', key: 'cashDiscount', money: true },
  { label: 'Exchange', key: 'exchangeValue', money: true },
  { label: 'Govt. Employee (After Complete Documents)*', key: 'govtEmployeeDiscount', money: true },
  { label: 'Additional Discount', key: 'additionalDiscount', money: true },
  { label: 'Booking Amount', key: 'bookingAmount', money: true },
  { label: 'Grand Total', key: 'grandTotalCost', money: true },
]

const AM_GROUP_LOGO_PATH = '/assets/am-group-logo-pdf.jpg'
const AM_GROUP_WATERMARK_PATH = '/assets/am-group-logo-watermark.jpg'

function readJpegDimensions(bytes: Buffer) {
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + length
  }
  return { width: 169, height: 112 }
}

function readPdfLogoAsset(fileName: string, name: string): PdfImageAsset | null {
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), 'public', 'assets', fileName))
    const dimensions = readJpegDimensions(bytes)
    return { name, width: dimensions.width, height: dimensions.height, bytes }
  } catch {
    return null
  }
}

const pdfHeaderLogo = readPdfLogoAsset('am-group-logo-pdf.jpg', 'Logo')
const pdfWatermarkLogo = readPdfLogoAsset('am-group-logo-watermark.jpg', 'WatermarkLogo')

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
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

function invoiceNumber(row: MgProformaInvoiceRow) {
  const sourceRow = row.importMetadata && typeof row.importMetadata === 'object' ? row.importMetadata.sourceRow : null
  return text(sourceRow) || row.id.slice(0, 8).toUpperCase()
}

function dealershipCode(row: MgProformaInvoiceRow) {
  const bankName = text(row.bankName).toUpperCase()
  return bankName.includes('J&K') || bankName.includes('J AND K') || bankName.includes('JAMMU') ? 'DSA -JKB0993J009' : 'DSA - NOT APPLICABLE'
}

function addressBlock() {
  return {
    name: 'AM MG',
    details: 'A Unit of AMG AUTOCRAFT PVT. LTD.<br>JS Complex, Narwal Bye Pass Road, Opp. AM Business Park, Jammu (J&amp;K) - 180015<br>Contact: 9541902733, 9541902744, 9541902747<br>Email: jammu.gm@mgdealer.co.in',
    pdfLines: [
      'A Unit of AMG AUTOCRAFT PVT. LTD.',
      'JS Complex, Narwal Bye Pass Road, Opp. AM Business Park, Jammu (J&K) - 180015',
      'Contact: 9541902733, 9541902744, 9541902747',
      'Email: jammu.gm@mgdealer.co.in',
    ],
  }
}

export function generateApprovedInvoiceTable(row: MgProformaInvoiceRow) {
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

export function buildMgProformaInvoiceHtml(row: MgProformaInvoiceRow) {
  const addressHTML = addressBlock()
  const dsaCode = dealershipCode(row)

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
  .payment { text-align: center; font-size: 11px; padding-top: 8px; margin-bottom: 10px; line-height: 1.7; }
  .payment-account { display: block; margin-top: 4px; font-size: 10px; line-height: 1.45; }
  .dealership-code { display: block; margin: 8px 0 6px; font-size: 28px; line-height: 1.05; font-weight: bold; }
  .tc { font-size: 11px; line-height: 1.6; margin-bottom: 10px; }
  .stamp { text-align: center; margin-bottom: 12px; }
  .stamp-box { display: inline-block; border: 2px solid #000; padding: 12px 20px; }
  .watermark {
    position: fixed;
    inset: 0;
    z-index: -1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    overflow: hidden;
  }
  .watermark-logo {
    transform: rotate(-28deg);
    width: 68%;
    max-width: 620px;
    opacity: 0.08;
  }
  .page-border {
    border: 1px solid #000;
    padding: 10px 8px 8px;
    min-height: calc(100vh - 60px);
  }
  .brand-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .brand-mark {
    width: 90px;
    min-height: 48px;
    object-fit: contain;
  }
</style>
</head>
<body>

<div class="watermark">
  <img class="watermark-logo" src="${AM_GROUP_WATERMARK_PATH}" alt="AM Group watermark">
</div>

<div class="page-border">
  <div class="brand-line">
    <img class="brand-mark" src="${AM_GROUP_LOGO_PATH}" alt="AM Group">
    <div class="header">
      <h2>${addressHTML.name}</h2>
      ${addressHTML.details}
    </div>
    <img class="brand-mark" src="${AM_GROUP_LOGO_PATH}" alt="AM Group">
  </div>

<div class="section-title">PROFORMA INVOICE</div>

<table>
  <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
  <tr>
    <td class="info-lbl"><b>PROFORMA INVOICE NO.</b> ${htmlEscape(invoiceNumber(row))}</td>
    <td class="info-val"><b>DATE:</b> ${dateLabel(row.proformaDate)}</td>
  </tr>
  <tr>
    <td class="info-lbl"><b>CUSTOMER NAME:</b> ${htmlEscape(row.customerName)}</td>
    <td class="info-val" style="font-size: 24px;"><b>Bank/Financer Name:</b> ${htmlEscape(row.bankName)}</td>
  </tr>
  <tr>
    <td class="info-lbl"><b>ADDRESS:</b> ${htmlEscape(row.customerAddress)}</td>
    <td class="info-val"><b>Branch:</b> ${htmlEscape(row.bankBranch || '')}</td>
  </tr>
  <tr>
    <td class="info-lbl"><b>MOBILE NO.:</b> ${htmlEscape(row.mobileNumber)}</td>
    <td class="info-val"><b>Email id:</b> ${htmlEscape(row.customerEmail)}</td>
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
  <b>PAYMENT DETAILS:</b> All Payments to be made favoring AMG AUTOCRAFT Pvt. Ltd. Payable at Jammu<br>
  <span class="payment-account">AC. No. 42772487810, BRANCH: SBI-SME-JAMMU, IFSC Code: SBIN0014501</span>
  <b>PLEASE ENSURE TO LOGIN FINANCE IN DEALERSHIP CODE</b>
  <span class="dealership-code">DEALERSHIP / DSA CODE: ${dsaCode}</span>
  <b>Sales:</b> 9541902733 | <b>Finance:</b> 9086822243<br>
  <i>For timely delivery of vehicle, customer to ensure that complete payment is transferred to dealer account 24 hours prior to delivery.</i>
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

</div>
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

export function buildMgProformaPdf(row: MgProformaInvoiceRow) {
  const width = 595
  const height = 842
  const margin = 32
  const borderX = 28
  const borderY = 28
  const borderW = width - borderX * 2
  const borderH = height - borderY * 2
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
    const estimate = value.length * size * 0.24
    textAt((width / 2) - estimate, yy, value, size, bold)
  }
  const rect = (x: number, yy: number, w: number, h: number, fill = false) => {
    page.commands.push(fill ? `0.91 g ${x} ${yy} ${w} ${h} re f 0 g` : `${x} ${yy} ${w} ${h} re S`)
  }
  const drawImage = (asset: PdfImageAsset | null, x: number, yy: number, w: number, h: number, opacityName?: string, rotate = 0) => {
    if (!asset) return
    const radians = (rotate * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const gs = opacityName ? `/${opacityName} gs ` : ''
    page.commands.push(`q ${gs}${(w * cos).toFixed(3)} ${(w * sin).toFixed(3)} ${(-h * sin).toFixed(3)} ${(h * cos).toFixed(3)} ${x.toFixed(3)} ${yy.toFixed(3)} cm /${asset.name} Do Q`)
  }
  const pageBaseCommands = () => [
    ...(pdfWatermarkLogo
      ? [
          'q /GSWatermark gs',
          '0.88 0.93 0.98 rg',
          `355.619 -189.619 131.351 246.182 64 310 cm /${pdfWatermarkLogo.name} Do`,
          'Q',
        ]
      : []),
    '0 g',
    `1.1 w ${borderX} ${borderY} ${borderW} ${borderH} re S`,
    '0.5 w',
  ]

  const address = addressBlock()
  drawImage(pdfHeaderLogo, borderX + 28, y - 50, 76, 50)
  drawImage(pdfHeaderLogo, width - borderX - 104, y - 50, 76, 50)
  center(y - 6, address.name, 15, true)
  y -= 16
  address.pdfLines.forEach((line) => {
    center(y, line, 10)
    y -= 13
  })
  y -= 8
  center(y, 'PROFORMA INVOICE', 9, true)
  y -= 22

  const infoRows = [
    [`PROFORMA INVOICE NO. ${invoiceNumber(row)}`, `DATE: ${dateLabel(row.proformaDate)}`],
    [`CUSTOMER NAME: ${text(row.customerName)}`, `Bank/Financer Name: ${text(row.bankName)}`],
    [`ADDRESS: ${text(row.customerAddress)}`, `Branch: ${text(row.bankBranch || '')}`],
    [`MOBILE NO.: ${text(row.mobileNumber)}`, `Email id: ${text(row.customerEmail)}`],
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
  y -= 14

  ensure(24)
  rect(tableX, y - 22, tableW * 0.6, 22, true)
  rect(tableX + tableW * 0.6, y - 22, tableW * 0.4, 22, true)
  rect(tableX, y - 22, tableW * 0.6, 22)
  rect(tableX + tableW * 0.6, y - 22, tableW * 0.4, 22)
  textAt(tableX + tableW * 0.3 - 34, y - 14, 'PARTICULARS', 10, true)
  textAt(tableX + tableW * 0.8 - 34, y - 14, 'AMOUNT (INR)', 10, true)
  y -= 22
  FIELD_MAP.forEach((item) => {
    const raw = row[item.key]
    const display = item.money ? amount(raw) : text(raw) || '-'
    const bold = item.key === 'totalCustomerCost' || item.key === 'grandTotalCost'
    const h = 18
    ensure(h)
    rect(tableX, y - h, tableW * 0.6, h)
    rect(tableX + tableW * 0.6, y - h, tableW * 0.4, h)
    const labelX = tableX + ((tableW * 0.6) / 2) - Math.min(140, item.label.length * 2.1)
    textAt(labelX, y - 12, item.label, 9, bold)
    textAt(tableX + tableW * 0.6 + 8, y - 12, display, 9, bold)
    y -= h
  })

  y -= 16
  ensure(56)
  rect(width / 2 - 70, y - 42, 140, 42)
  center(y - 16, 'Dealer Stamp', 10, true)
  center(y - 30, '(Signature/Seal)', 9)
  y -= 58

  const dsaCode = dealershipCode(row)
  ensure(82)
  center(y, 'PAYMENT DETAILS: All Payments to be made favoring AMG AUTOCRAFT Pvt. Ltd. Payable at Jammu', 9, true)
  y -= 15
  center(y, 'AC. No. 42772487810, BRANCH: SBI-SME-JAMMU, IFSC Code: SBIN0014501', 8, true)
  y -= 16
  center(y, 'PLEASE ENSURE TO LOGIN FINANCE IN DEALERSHIP CODE', 8, true)
  y -= 22
  center(y, `DEALERSHIP / DSA CODE: ${dsaCode}`, 18, true)
  y -= 24
  center(y, 'Sales: 9541902733 | Finance: 9086822243', 9)
  y -= 13
  center(y, 'For timely delivery of vehicle, customer to ensure that complete payment is transferred to dealer account 24 hours prior to delivery.', 8)
  y -= 13

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

  const objects: Buffer[] = []
  const addObject = (body: PdfObjectBody) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'))
    return objects.length
  }

  const font1 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const font2 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const imageObjectIds = new Map<string, number>()
  const addImageObject = (asset: PdfImageAsset | null) => {
    if (!asset) return null
    const imageId = addObject(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${asset.bytes.length} >>\nstream\n`, 'utf8'),
      asset.bytes,
      Buffer.from('\nendstream', 'utf8'),
    ]))
    imageObjectIds.set(asset.name, imageId)
    return imageId
  }
  addImageObject(pdfHeaderLogo)
  addImageObject(pdfWatermarkLogo)
  const xObjectResources = imageObjectIds.size > 0
    ? `/XObject << ${Array.from(imageObjectIds.entries()).map(([name, id]) => `/${name} ${id} 0 R`).join(' ')} >>`
    : ''
  const graphicsStateResources = '/ExtGState << /GSWatermark << /Type /ExtGState /CA 0.10 /ca 0.10 >> >>'
  const pageObjectIds: number[] = []
  pages.forEach((pdfPage) => {
    const content = [...pageBaseCommands(), ...pdfPage.commands].join('\n')
    const streamId = addObject(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> ${xObjectResources} ${graphicsStateResources} >> /Contents ${streamId} 0 R >>`)
    pageObjectIds.push(pageId)
  })
  const pagesId = addObject(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`)
  pageObjectIds.forEach((id) => {
    objects[id - 1] = Buffer.from(objects[id - 1].toString('utf8').replace('/Parent 0 0 R', `/Parent ${pagesId} 0 R`), 'utf8')
  })
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'utf8')]
  const offsets: number[] = [0]
  let byteOffset = chunks[0].length
  objects.forEach((body, index) => {
    offsets.push(byteOffset)
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, 'utf8')
    const suffix = Buffer.from('\nendobj\n', 'utf8')
    chunks.push(prefix, body, suffix)
    byteOffset += prefix.length + body.length + suffix.length
  })
  const xref = byteOffset
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => {
    trailer += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`
  chunks.push(Buffer.from(trailer, 'utf8'))
  return Buffer.concat(chunks)
}

export async function saveMgProformaPdf(row: MgProformaInvoiceRow) {
  const pdf = buildMgProformaPdf(row)
  const base64 = `data:application/pdf;base64,${pdf.toString('base64')}`
  const result = await uploadFile(base64, 'mg-proforma', row.id)
  if (result.error || !result.url) {
    console.error('Unable to save MG Proforma PDF:', result.error)
    return null
  }
  return result.url
}
