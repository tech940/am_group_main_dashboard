import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { withdrawSale } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** The sale fell through before approval: the car goes back to stock. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.edit)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await withdrawSale(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
