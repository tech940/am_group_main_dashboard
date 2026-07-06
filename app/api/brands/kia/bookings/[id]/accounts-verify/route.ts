import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { verifyKiaAccountsPayment } from '@/lib/kia/bookings'
import { requirePermission } from '@/lib/permissions/service'
import { uploadFile } from '@/lib/supabase/storage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorize() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, 'kia.bookings.edit')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
  return { response: null, appUser }
}

// Accounts stage: enter invoice number, upload invoice PDF, verify documentation.
// The lib function additionally re-checks that the caller is Accounts / admin and
// that the booking is at the payment_confirmed stage.
export async function POST(request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/accounts-verify'>) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    const contentType = request.headers.get('content-type') || ''

    let invoiceNumber: string | null = null
    let reference: string | null = null
    let notes: string | null = null
    let invoiceDocumentUrl: string | null = null
    let invoiceDocumentPath: string | null = null
    let invoiceDocumentName: string | null = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      invoiceNumber = String(formData.get('invoiceNumber') || '').trim() || null
      reference = String(formData.get('reference') || '').trim() || null
      notes = String(formData.get('notes') || '').trim() || null
      const invoice = formData.get('invoice')
      if (invoice instanceof File && invoice.size > 0) {
        const uploaded = await uploadFile(invoice, 'kia-bookings/accounts-invoices', id)
        if (uploaded.error) return NextResponse.json({ error: uploaded.error }, { status: 400 })
        invoiceDocumentUrl = uploaded.url || null
        invoiceDocumentPath = uploaded.path || null
        invoiceDocumentName = invoice.name || null
      }
    } else {
      const body = await request.json().catch(() => ({}))
      invoiceNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() || null : null
      reference = typeof body.reference === 'string' ? body.reference.trim() || null : null
      notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    }

    const booking = await verifyKiaAccountsPayment(id, {
      invoiceNumber,
      reference,
      notes,
      invoiceDocumentUrl,
      invoiceDocumentPath,
      invoiceDocumentName,
    }, auth.appUser!)
    return NextResponse.json({ ok: true, booking })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to verify accounts' }, { status: 400 })
  }
}
