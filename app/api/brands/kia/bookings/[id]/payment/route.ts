import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import {
  confirmKiaBookingPayment,
  getKiaBookingPayments,
  recordKiaBookingPartialPayment,
  reverseKiaBookingPayment,
} from '@/lib/kia/bookings'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorize() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  // ⚠️ This permission check gates NOBODY and is not the real guard. applyBrandDefault() grants
  // every non-restricted kia.* key to every KIA user, so `kia.bookings.edit` excludes no one — see
  // the warning in lib/kia/workflow-access.ts. The actual restriction to Accounts/admin lives inside
  // each lib function (canConfirmKiaPayment). Do not "harden" this by adding another kia.* key.
  const permission = await requirePermission(appUser, 'kia.bookings.edit')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
  return { response: null, appUser }
}

/**
 * Reads the body whether it arrives as JSON or as multipart/form-data.
 *
 * ⚠️ This function exists because of a live bug. The Stock dashboard posts FormData (it can carry an
 * invoice PDF) while this route did `await request.json().catch(() => ({}))`. A multipart body fails
 * that parse, the catch swallowed it into an empty object, and so the mandatory payment reference was
 * written as NULL and the uploaded invoice was discarded — silently, on every payment confirmed from
 * the Stock tab. The Bookings CRM posts real JSON, which is why it always worked there and the bug
 * went unnoticed.
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData()
    const out: Record<string, unknown> = {}
    for (const [key, value] of form.entries()) out[key] = value
    return out
  }
  return (await request.json().catch(() => ({}))) as Record<string, unknown>
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() || null : null)

/**
 * Accounts recording money against a booking. Three modes on one endpoint:
 *
 *   full     — the balance is in: advance the vehicle to Paid · To Deliver (the original behaviour)
 *   partial  — record ONE instalment and leave the vehicle with Accounts
 *   reverse  — undo a recorded instalment by appending a mirrored negative row
 *
 * An absent `mode` means 'full', so the existing Bookings-CRM caller keeps working untouched.
 */
export async function POST(request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/payment'>) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    const body = await readBody(request)
    const mode = String(body.mode || 'full').trim().toLowerCase()

    if (mode === 'partial') {
      const result = await recordKiaBookingPartialPayment(id, {
        amount: body.amount,
        paymentMode: text(body.paymentMode),
        reference: text(body.reference),
        receivedOn: text(body.receivedOn),
        notes: text(body.notes),
      }, auth.appUser!)
      return NextResponse.json({ ok: true, ...result })
    }

    if (mode === 'reverse') {
      const paymentId = text(body.paymentId)
      if (!paymentId) return NextResponse.json({ error: 'paymentId is required to reverse a payment' }, { status: 400 })
      const result = await reverseKiaBookingPayment(id, { paymentId, reason: text(body.reason) }, auth.appUser!)
      return NextResponse.json({ ok: true, ...result })
    }

    if (mode !== 'full') {
      return NextResponse.json({ error: `Unknown payment mode '${mode}'` }, { status: 400 })
    }

    const booking = await confirmKiaBookingPayment(id, { reference: text(body.reference) }, auth.appUser!)
    return NextResponse.json({ ok: true, booking })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to confirm payment' }, { status: 400 })
  }
}

/** The payment ledger for this booking — what the Stock row's history popover reads. */
export async function GET(_request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/payment'>) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    return NextResponse.json({ ok: true, payments: await getKiaBookingPayments(id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load payments' }, { status: 400 })
  }
}
