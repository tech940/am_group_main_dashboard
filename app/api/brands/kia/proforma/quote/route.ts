import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { ensureKiaUserProfile, touchKiaUserProfile } from '@/lib/kia-proforma/server'
import { buildKiaQuotePdf, type KiaQuotePdfRow } from '@/lib/kia-proforma/invoice'
import { sendTrackedEmail } from '@/lib/email/email-log'
import { buildQuoteEmail } from '@/lib/email/templates'
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

function buildQuoteRow(body: Record<string, unknown>, location: string | null, consultant?: string | null): KiaQuotePdfRow {
  return {
    id: `KIA-QUOTE-${Date.now()}`,
    proformaDate: new Date(),
    quoteNumber: `KIA-QUOTE-${Date.now()}`,
    quoteDate: new Date(),
    customerName: readText(body, 'customerName'),
    customerPhone: readText(body, 'customerPhone'),
    mobileNumber: readText(body, 'customerPhone'),
    customerAddress: readText(body, 'customerAddress'),
    customerEmail: readText(body, 'customerEmail'),
    modelName: readText(body, 'modelName'),
    trimDescription: readText(body, 'trimDescription'),
    fuelType: readText(body, 'fuelType') || 'PETROL',
    vehicleColor: readText(body, 'vehicleColor'),
    bankName: readText(body, 'bankName'),
    bankBranch: readText(body, 'bankBranch') || null,
    insuranceCompany: readText(body, 'insuranceCompany') || null,
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
  }
}

function validateQuote(body: Record<string, unknown>) {
  const errors: Record<string, string> = {}
  ;['customerName', 'customerPhone', 'customerEmail', 'modelName', 'trimDescription'].forEach((key) => {
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
      vehicle: `${readText(body, 'modelName')} ${readText(body, 'trimDescription')}`.trim(),
      budget: readAmount(body, 'grandTotalCost'),
      price: readAmount(body, 'grandTotalCost'),
      createdBy: appUser.id,
    })

    const row = buildQuoteRow(body, profile.dealerLocation || appUser.brand || 'kia', profile.consultantName || appUser.fullName)
    const pdf = buildKiaQuotePdf(row)

    // Email the quote PDF via Google OAuth2. Never blocks the download response:
    // sendTrackedEmail logs the outcome and never throws.
    const quoteEmail = buildQuoteEmail({ customerName: row.customerName })
    const emailResult = await sendTrackedEmail({
      to: row.customerEmail.trim().toLowerCase(),
      subject: quoteEmail.subject,
      html: quoteEmail.html,
      text: quoteEmail.text,
      emailType: 'quote',
      attachments: [{
        filename: 'Quotation.pdf',
        content: pdf,
        contentType: 'application/pdf',
      }],
    })
    const emailSent = emailResult.ok

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
