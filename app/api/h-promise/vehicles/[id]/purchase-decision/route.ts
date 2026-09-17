import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { decidePurchase } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** Approve or reject a purchase — at the GSM / SM stage, or finally as the MD. Nobody decides an entry they made. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.approvals.approve || caps.approvals.final)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await decidePurchase(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
