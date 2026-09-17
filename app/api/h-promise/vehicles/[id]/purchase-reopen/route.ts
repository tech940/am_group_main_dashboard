import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { reopenPurchase } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** MD only: reopen an approved purchase (approved → pending, back to the GSM / SM), with a reason, so its price can be corrected. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.approvals.final)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await reopenPurchase(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
