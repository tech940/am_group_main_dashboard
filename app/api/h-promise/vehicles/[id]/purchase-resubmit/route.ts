import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { resubmitPurchase } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** Send a rejected purchase back to the approvers. The desk may resubmit its own entry. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.edit || caps.register.create)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await resubmitPurchase(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
