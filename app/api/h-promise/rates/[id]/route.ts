import { getIndiaYmd } from '@/lib/date-time'
import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { removeFutureRate } from '@/lib/h-promise/options'

export const dynamic = 'force-dynamic'

/** Remove a rate that has not started yet. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.settings.edit)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    await removeFutureRate(actorOf(access.appUser), id, getIndiaYmd())
    return hpJson({ ok: true })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
