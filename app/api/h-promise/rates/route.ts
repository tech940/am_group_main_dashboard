import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { addRate } from '@/lib/h-promise/options'

export const dynamic = 'force-dynamic'

/** A new yearly interest rate, from a date. Earlier days keep the rate they had. */
export async function POST(request: Request) {
  const access = await requireHPromiseApi((caps) => caps.settings.edit)
  if (access.denied) return access.denied
  try {
    const rate = await addRate(actorOf(access.appUser), await readJsonBody(request))
    return hpJson({ ok: true, rate }, { status: 201 })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
