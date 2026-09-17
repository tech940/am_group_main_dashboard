import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { refundBooking } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** Refund a live booking. The refund cheque is required. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.edit)
  if (access.denied) return access.denied
  try {
    const { bookingId } = await params
    const result = await refundBooking(actorOf(access.appUser), access.caps, bookingId, await readJsonBody(request))
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
