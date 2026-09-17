import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { updateBooking } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** Correct a live booking. Changing the amount also needs the approve right and a reason. */
export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.edit)
  if (access.denied) return access.denied
  try {
    const { bookingId } = await params
    await updateBooking(actorOf(access.appUser), access.caps, bookingId, await readJsonBody(request))
    return hpJson({ ok: true })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
