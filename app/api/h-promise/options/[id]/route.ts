import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { updateOption } from '@/lib/h-promise/options'

export const dynamic = 'force-dynamic'

/** Rename, reorder, hide or bring back a list entry. The stored value never changes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.settings.edit)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const option = await updateOption(actorOf(access.appUser), id, await readJsonBody(request))
    return hpJson({ ok: true, option })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
