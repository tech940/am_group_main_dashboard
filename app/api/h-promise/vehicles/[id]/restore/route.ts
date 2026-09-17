import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { restoreVehicle } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** Bring a deleted vehicle back onto the register. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.delete)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await restoreVehicle(actorOf(access.appUser), access.caps, id)
    return hpJson({ ok: true, result: result ?? null })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
