import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { ensureKiaUserProfile, touchKiaUserProfile } from '@/lib/kia-proforma/server'
import { buildKiaProformaPdf, type KiaProformaInvoiceRow } from '@/lib/kia-proforma/invoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readText(body: Record<string, unknown>, key: string) {
  return String(body[key] ?? '').trim()
}

function readAmount(body: Record<string, unknown>, key: string) {
  const parsed = Number(String(body[key] ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00'
}

function readDate(body: Record<string, unknown>, key: string) {
  const value = readText(body, key)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date()
  const date = new Date(`${value}T00:00:00+05:30`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function getMailerTransport() {
  const user = process.env.REPORT_MAIL_GMAIL_USER
  const pass = process.env.REPORT_MAIL_GMAIL_APP_PASSWORD

  if (!user || !pass) {
    throw new Error('Quote email is not configured. Set REPORT_MAIL_GMAIL_USER and REPORT_MAIL_GMAIL_APP_PASSWORD.')
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

function buildQuoteRow(body: Record<string, unknown>, location: string | null): KiaProformaInvoiceRow {
  return {
    id: `KIA-QUOTE-${Date.now()}`,
    proformaDate: readDate(body, 'proformaDate'),
    customerName: readText(body, 'customerName'),
    mobileNumber: readText(body, 'mobileNumber'),
    customerAddress: readText(body, 'customerAddress'),
    customerEmail: readText(body, 'customerEmail'),
    modelName: readText(body, 'modelName'),
    trimDescription: readText(body, 'trimDescription'),
    fuelType: readText(body, 'fuelType'),
    vehicleColor: readText(body, 'vehicleColor'),
    bankName: readText(body, 'bankName') || 'Not selected',
    bankBranch: readText(body, 'bankBranch'),
    insuranceCompany: readText(body, 'insuranceCompany'),
    exShowroom: readAmount(body, 'exShowroom'),
    tcsValue: readAmount(body, 'tcsValue'),
    registrationCharges: readAmount(body, 'registrationCharges'),
    insuranceValue: readAmount(body, 'insuranceValue'),
    fastagValue: readAmount(body, 'fastagValue'),
    accessoriesKit: readAmount(body, 'accessoriesKit'),
    extWarranty: readAmount(body, 'extWarranty'),
    cashDiscount: readAmount(body, 'cashDiscount'),
    exchangeValue: readAmount(body, 'exchangeValue'),
    bookingAmount: readAmount(body, 'bookingAmount'),
    govtEmployeeDiscount: readAmount(body, 'govtEmployeeDiscount'),
    additionalDiscount: readAmount(body, 'additionalDiscount'),
    totalCustomerCost: readAmount(body, 'totalCustomerCost'),
    grandTotalCost: readAmount(body, 'grandTotalCost'),
    location,
    documentTitle: 'PRICE QUOTATION',
    disclaimerLines: [
      'THIS IS ONLY A PRICE QUOTATION. THIS IS NOT A BOOKING CONFIRMATION, TAX INVOICE, OR FINAL ALLOCATION DOCUMENT.',
      'Vehicle prices, schemes, availability, and taxes are subject to change at the time of booking/invoicing.',
      'Please contact AM KIA for final booking, payment, and delivery confirmation.',
    ],
  }
}

function validateQuote(body: Record<string, unknown>) {
  const errors: Record<string, string> = {}
  ;['customerName', 'mobileNumber', 'customerEmail', 'modelName', 'trimDescription', 'vehicleColor'].forEach((key) => {
    if (!readText(body, key)) errors[key] = 'Required'
  })
  if (!/^\d{10}$/.test(readText(body, 'mobileNumber'))) errors.mobileNumber = 'Mobile number must be 10 digits'
  if (!EMAIL_PATTERN.test(readText(body, 'customerEmail'))) errors.customerEmail = 'Enter a valid email'
  return errors
}

export async function POST(request: NextRequest) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'kia.proforma.create')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await ensureKiaUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const errors = validateQuote(body)
    if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 400 })

    const row = buildQuoteRow(body, profile.dealerLocation || appUser.brand || 'kia')
    const pdf = buildKiaProformaPdf(row)
    const transport = getMailerTransport()
    const fromName = process.env.REPORT_MAIL_FROM_NAME || 'AM KIA'
    const mailUser = process.env.REPORT_MAIL_GMAIL_USER || ''
    const to = row.customerEmail.trim().toLowerCase()

    const info = await transport.sendMail({
      from: `"${fromName}" <${mailUser}>`,
      to,
      subject: `AM KIA Price Quotation - ${row.modelName} ${row.trimDescription}`,
      text: [
        `Dear ${row.customerName},`,
        '',
        'Please find attached your AM KIA price quotation.',
        '',
        'This is only a price quotation and not a booking confirmation, tax invoice, or final allocation document.',
        'Vehicle prices, schemes, availability, and taxes are subject to change at the time of booking/invoicing.',
      ].join('\n'),
      html: `
        <p>Dear <strong>${row.customerName}</strong>,</p>
        <p>Please find attached your AM KIA price quotation.</p>
        <p><strong>Important:</strong> This is only a price quotation and not a booking confirmation, tax invoice, or final allocation document. Vehicle prices, schemes, availability, and taxes are subject to change at the time of booking/invoicing.</p>
      `,
      attachments: [{
        filename: `AM-KIA-Quote-${row.modelName.replace(/\s+/g, '-')}-${Date.now()}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
    })

    await touchKiaUserProfile(appUser.email)
    return NextResponse.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected })
  } catch (error) {
    console.error('Error in POST /api/brands/kia/proforma/quote:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to send quote' }, { status: 500 })
  }
}
