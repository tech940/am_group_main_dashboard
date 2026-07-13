import { uploadFile } from '@/lib/supabase/storage'
import fs from 'fs'
import path from 'path'

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
  documentTitle?: string | null
  disclaimerLines?: string[] | null
}

function isJkBank(bankName: string) {
  const normalized = String(bankName || '').toUpperCase().replace(/\s+/g, '')
  return normalized.includes('J&KBANK') || normalized.includes('J&K') || normalized === 'JKBANK'
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
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

function addressBlock(_row: KiaProformaInvoiceRow) {
  return {
    name: 'AM KIA',
    details: `A Unit of Platinum Automobiles Pvt Ltd Unit II.<br>Showroom- Akhnoor road opp. Pillar no.52, Toph Sherkhania, Jammu- 180001.<br>PH. 9484211111 | Email: sales@amkia.in`,
    pdfLines: [
      'A Unit of Platinum Automobiles Pvt Ltd Unit II.',
      'Showroom- Akhnoor road opp. Pillar no.52, Toph Sherkhania, Jammu- 180001.',
      'PH. 9484211111 | Email: sales@amkia.in',
    ],
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
  const dealershipCode = isJkBank(bankName) ? 'JKB0993J003' : 'NOT APPLICABLE'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #000; margin: 20px; line-height: 1.4; }
  h2 { font-size: 20px; font-weight: bold; margin: 0 0 4px; text-align: center; }
  .header { text-align: center; margin-bottom: 12px; font-size: 12px; line-height: 1.6; }
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
  .dealership-code { display: block; margin: 8px 0 6px; font-size: 28px; line-height: 1.05; font-weight: bold; text-align: center; }
  .tc { font-size: 11px; line-height: 1.6; margin-bottom: 10px; text-align: center; }
  .tc-list { text-align: left; display: inline-block; margin: 0 auto; }
  .stamp { text-align: center; margin-bottom: 12px; }
  .stamp-box { display: inline-block; border: 2px solid #000; padding: 12px 20px; }
  .footer-docs { width: 100%; max-width: 500px; margin: 0 auto; border: none; }
  .footer-docs td { border: none; vertical-align: top; font-size: 11px; line-height: 1.6; }
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

</style>
</head>
<body>

<div class="watermark">
  <img class="watermark-logo" src="${AM_GROUP_WATERMARK_PATH}" alt="AM Group watermark">
</div>

<div class="page-border">
  <div style="text-align:center; margin-bottom: 12px;">
    <h2>${addressHTML.name}</h2>
    <div class="header">${addressHTML.details}</div>
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
  <span class="payment-account">AC. No. 43418019645 | BRANCH: SBI-SME-JAMMU | IFSC: SBIN0014501</span>
  <span class="dealership-code">DEALERSHIP CODE: ${dealershipCode}</span>
  <b>Sales:</b> 9484211111 | <b>Finance:</b> 9484111111<br>
  <i>Complete payment must be made 24 hours prior to delivery.</i>
</div>

<div class="tc">
  <b>Terms &amp; Conditions:</b><br>
  <div class="tc-list">
    1. The above prices are for Jammu until otherwise indicated.<br>
    2. Prices valid at the time of delivery will be applicable.<br>
    3. Any changes in taxes and/or levies shall be borne by the customer.<br>
    4. Prices and specifications are subject to change without notice.<br>
    5. Vehicle/model/color delivery subject to certain conditions.<br>
    6. Once the car is allotted &amp; in transit, payment to be made within 3 days or the car will be transferred to next booking.
  </div>
</div>

<div style="text-align:center;">
  <table class="footer-docs">
    <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
    <tr>
      <td>
        <b>For Exchange:</b><br>
        - RC<br>
        - Insurance (6 months old)<br>
        - Chassis traces
      </td>
      <td>
        <b>For Govt. Employee:</b><br>
        - Aadhar Card<br>
        - PAN Card<br>
        - Latest Salary Slip<br>
        - ID Card
      </td>
    </tr>
  </table>
</div>

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

export function buildKiaProformaPdf(row: KiaProformaInvoiceRow) {
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
    // Start continuation pages well below the page-border top line
    // (top border sits at height - borderY); otherwise flowed body text
    // (e.g. Terms & Conditions) collides with the border on page 2+.
    y = height - borderY - 30
  }
  const ensure = (space: number) => {
    if (y - space < margin) addPage()
  }
  const textAt = (x: number, yy: number, value: string, size = 10, bold = false) => {
    page.commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${pdfEscape(value)}) Tj ET`)
  }
  const getTextWidth = (text: string, size: number) => {
    let textWidth = 0
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (char >= 'A' && char <= 'Z') {
        textWidth += 0.62 * size
      } else if (char === 'f' || char === 'i' || char === 'j' || char === 'l' || char === 't' || char === 'I' || char === '.' || char === ',' || char === ':' || char === '!' || char === ';' || char === '-' || char === '|' || char === '/') {
        textWidth += 0.25 * size
      } else if (char === 'w' || char === 'm' || char === 'W' || char === 'M' || char === '@' || char === '&') {
        textWidth += 0.80 * size
      } else if (char === ' ') {
        textWidth += 0.28 * size
      } else {
        textWidth += 0.50 * size
      }
    }
    return textWidth
  }
  const center = (yy: number, value: string, size = 10, bold = false) => {
    const textWidth = getTextWidth(value, size)
    textAt((width / 2) - (textWidth / 2), yy, value, size, bold)
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
  const imageCommand = (asset: PdfImageAsset | null, x: number, yy: number, w: number, h: number, opacityName?: string, rotate = 0) => {
    if (!asset) return null
    const radians = (rotate * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const gs = opacityName ? `/${opacityName} gs ` : ''
    return `q ${gs}${(w * cos).toFixed(3)} ${(w * sin).toFixed(3)} ${(-h * sin).toFixed(3)} ${(h * cos).toFixed(3)} ${x.toFixed(3)} ${yy.toFixed(3)} cm /${asset.name} Do Q`
  }
  // Centre the rotated watermark on the page. Because the PDF transform rotates
  // the image around its bottom-left corner (x,y), we offset x,y so the image's
  // visual centre lands exactly at the page centre.
  const WM_W = 310
  const WM_H = 205
  const WM_ROT = 40
  const wmRad = (WM_ROT * Math.PI) / 180
  const wmX = width / 2 - ((WM_W / 2) * Math.cos(wmRad) - (WM_H / 2) * Math.sin(wmRad))
  const wmY = height / 2 - ((WM_W / 2) * Math.sin(wmRad) + (WM_H / 2) * Math.cos(wmRad))
  const pageBaseCommands = () => [
    ...(pdfWatermarkLogo ? [imageCommand(pdfWatermarkLogo, wmX, wmY, WM_W, WM_H, 'GSWatermark', WM_ROT) || ''] : []),
    '0 g',
    `1.1 w ${borderX} ${borderY} ${borderW} ${borderH} re S`,
    '0.5 w',
  ]

  const address = addressBlock(row)
  drawImage(pdfHeaderLogo, borderX + 32, y - 58, 74, 48)
  drawImage(pdfHeaderLogo, width - borderX - 106, y - 58, 74, 48)
  center(y - 10, address.name, 14, true)
  y -= 20
  address.pdfLines.forEach((line) => {
    center(y, line, 8)
    y -= 11
  })
  y -= 8
  center(y, text(row.documentTitle) || 'PROFORMA INVOICE', 12, true)
  y -= 28

  if (row.disclaimerLines?.length) {
    ensure(48)
    rect(margin, y - 40, width - margin * 2, 40)
    row.disclaimerLines.slice(0, 3).forEach((line, index) => {
      textAt(margin + 8, y - 13 - (index * 11), line, 8, index === 0)
    })
    y -= 52
  }

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
    const wrappedCells = cells.map((cell, index) => wrap(cell, index === 0 ? 34 : 28))
    const rowH = Math.max(...wrappedCells.map((lines) => lines.length)) * 11 + 10
    ensure(rowH)
    rect(tableX, y - rowH, half, rowH)
    rect(tableX + half, y - rowH, half, rowH)
    wrappedCells.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => textAt(tableX + (index * half) + 7, y - 14 - (lineIndex * 11), line, 8.5, lineIndex === 0 && line.includes(':')))
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
    const leftWidth = tableW * 0.6
    const rightWidth = tableW * 0.4
    const labelLines = wrap(item.label, 34)
    const valueLines = wrap(display, item.money ? 18 : 24)
    const rowHeight = Math.max(labelLines.length, valueLines.length) * 11 + 8
    ensure(rowHeight)
    rect(tableX, y - rowHeight, leftWidth, rowHeight)
    rect(tableX + leftWidth, y - rowHeight, rightWidth, rowHeight)
    labelLines.forEach((line, index) => textAt(tableX + 8, y - 13 - (index * 11), line, 8.5, bold))
    valueLines.forEach((line, index) => textAt(tableX + leftWidth + 8, y - 13 - (index * 11), line, 8.5, bold))
    y -= rowHeight
  })

  y -= 16
  ensure(56)
  rect(width / 2 - 70, y - 42, 140, 42)
  center(y - 16, 'Dealer Stamp', 10, true)
  center(y - 30, '(Signature/Seal)', 9)
  y -= 58

  const dealershipCode = isJkBank(text(row.bankName)) ? 'JKB0993J003' : 'NOT APPLICABLE'
  ensure(82)
  center(y, 'PAYMENT DETAILS: All Payments favoring M/S PLATINUM AUTOMOBILES PVT LTD. Payable at Jammu', 9, true)
  y -= 15
  center(y, 'AC. No. 43418019645 | BRANCH: SBI-SME-JAMMU | IFSC: SBIN0014501', 8, true)
  y -= 24
  center(y, `DEALERSHIP CODE: ${dealershipCode}`, 9, true)
  y -= 24
  center(y, 'Sales: 9484211111 | Finance: 9484111111', 9)
  y -= 13
  center(y, 'Complete payment must be made 24 hours prior to delivery.', 9)
  y -= 13

  y -= 8
  ensure(14)
  center(y, 'Terms & Conditions:', 9, true)
  y -= 14

  const terms = [
    '1. The above prices are for Jammu until otherwise indicated.',
    '2. Prices valid at the time of delivery will be applicable.',
    '3. Any changes in taxes and/or levies shall be borne by the customer.',
    '4. Prices and specifications are subject to change without notice.',
    '5. Vehicle/model/color delivery subject to certain conditions.',
    '6. Once the car is allotted & in transit, payment to be made within 3 days or the car will be transferred to next booking.',
  ]
  terms.forEach((line) => {
    wrap(line, 85).forEach((part) => {
      ensure(13)
      center(y, part, 8)
      y -= 12
    })
  })

  y -= 8
  ensure(56)
  textAt(width / 2 - 140, y, 'For Exchange:', 9, true)
  textAt(width / 2 - 140, y - 13, '- RC', 8)
  textAt(width / 2 - 140, y - 25, '- Insurance (6 months old)', 8)
  textAt(width / 2 - 140, y - 37, '- Chassis traces', 8)
  textAt(width / 2 + 20, y, 'For Govt. Employee:', 9, true)
  textAt(width / 2 + 20, y - 13, '- Aadhar Card', 8)
  textAt(width / 2 + 20, y - 25, '- PAN Card', 8)
  textAt(width / 2 + 20, y - 37, '- Latest Salary Slip', 8)
  textAt(width / 2 + 20, y - 49, '- ID Card', 8)

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

export type KiaQuotePdfRow = KiaProformaInvoiceRow & {
  quoteNumber: string
  quoteDate: Date | string
  customerPhone: string
}

export function buildKiaQuotePdf(row: KiaQuotePdfRow) {
  const quoteRow: KiaProformaInvoiceRow = {
    ...row,
    id: row.quoteNumber,
    proformaDate: row.quoteDate,
    documentTitle: 'PRICE QUOTATION',
    disclaimerLines: [
      'THIS IS JUST A QUOTATION AND CANNOT BE USED FOR BANK PURPOSE.',
      'This is only an indicative quote and is valid for 1 day only.',
      'Prices, schemes, and availability may change.'
    ]
  }
  return buildKiaProformaPdf(quoteRow)
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
