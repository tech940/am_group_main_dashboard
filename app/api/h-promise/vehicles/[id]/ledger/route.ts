import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { uploadLedger } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** Payment verification: the accounts ledger for a sold vehicle, uploaded once. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.payments.edit)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await uploadLedger(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
