import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { listVehicles } from '@/lib/h-promise/queries'
import { createPurchase } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/**
 * Every live vehicle (or, with `?view=deleted`, every deleted one) — no personal values in a row.
 * Each area filters this one list on the client, so the register, the approval queues, payment verification
 * and the MIS can never disagree about what a vehicle's state is.
 */
export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get('view') === 'deleted' ? 'deleted' : 'live'
  const access = await requireHPromiseApi((caps) => (view === 'deleted' ? caps.register.view : caps.anyView))
  if (access.denied) return access.denied
  try {
    return hpJson(await listVehicles(view))
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}

/** Record a purchase. It starts as "awaiting approval". */
export async function POST(request: Request) {
  const access = await requireHPromiseApi((caps) => caps.register.create)
  if (access.denied) return access.denied
  try {
    const result = await createPurchase(actorOf(access.appUser), access.caps, await readJsonBody(request))
    return hpJson({ ok: true, result }, { status: 201 })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
