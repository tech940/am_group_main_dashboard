import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { ensureKiaUserProfile, touchKiaUserProfile } from '@/lib/kia-proforma/server'
import { buildKiaQuotePdf, type KiaQuotePdfRow } from '@/lib/kia-proforma/invoice'
import { db } from '@/lib/db'
import { kiaQuotes } from '@/lib/db/schema'

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

function buildQuoteRow(body: Record<string, unknown>, location: string | null, consultant?: string | null): KiaQuotePdfRow {
  const price = readAmount(body, 'price')
  const customerName = readText(body, 'customerName')
  const customerPhone = readText(body, 'customerPhone')
  const customerEmail = readText(body, 'customerEmail')
  const model = readText(body, 'model') || readText(body, 'vehicle')
  const variant = readText(body, 'variant')

  return {
    quoteNumber: `KIA-QUOTE-${Date.now()}`,
    quoteDate: new Date(),
    customerName,
    customerPhone,
    customerEmail,
    modelName: model,
    trimDescription: variant,
    vehiclePrice: price,
    location,
    consultant,
  }
}

function validateQuote(body: Record<string, unknown>) {
  const errors: Record<string, string> = {}
  ;['customerName', 'customerPhone', 'customerEmail', 'model', 'variant', 'price'].forEach((key) => {
    if (!readText(body, key)) errors[key] = 'Required'
  })
  if (!/^\d{10}$/.test(readText(body, 'customerPhone'))) errors.customerPhone = 'Mobile number must be 10 digits'
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

    // Save quote to PostgreSQL database using drizzle
    await db.insert(kiaQuotes).values({
      customerName: readText(body, 'customerName'),
      customerPhone: readText(body, 'customerPhone'),
      customerEmail: readText(body, 'customerEmail'),
      vehicle: `${readText(body, 'model')} ${readText(body, 'variant')}`.trim(),
      budget: readAmount(body, 'price'),
      price: readAmount(body, 'price'),
      createdBy: appUser.id,
    })

    const row = buildQuoteRow(body, profile.dealerLocation || appUser.brand || 'kia', profile.consultantName || appUser.fullName)
    const pdf = buildKiaQuotePdf(row)

    let emailSent = false
    try {
      const transport = getMailerTransport()
      const fromName = process.env.REPORT_MAIL_FROM_NAME || 'AM KIA'
      const mailUser = process.env.REPORT_MAIL_GMAIL_USER || ''
      const to = row.customerEmail.trim().toLowerCase()

      await transport.sendMail({
        from: `"${fromName}" <${mailUser}>`,
        to,
        subject: `AM KIA Price Quotation - ${row.modelName}`,
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
      emailSent = true
    } catch (e) {
      console.warn('Failed to email quote PDF, will download only:', e)
    }

    await touchKiaUserProfile(appUser.email)
    
    return NextResponse.json({ 
      ok: true, 
      emailSent,
      pdf: pdf.toString('base64'),
      filename: `AM-KIA-Quote-${row.modelName.replace(/\s+/g, '-')}-${Date.now()}.pdf`
    })
  } catch (error) {
    console.error('Error in POST /api/brands/kia/proforma/quote:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save and download quote' }, { status: 500 })
  }
}
