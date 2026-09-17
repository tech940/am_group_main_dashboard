import { requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { checkRegistration } from '@/lib/h-promise/queries'

export const dynamic = 'force-dynamic'

/** Live duplicate check while the purchase form is being filled in. */
export async function GET(request: Request) {
  const access = await requireHPromiseApi((caps) => caps.register.create || caps.register.edit)
  if (access.denied) return access.denied
  try {
    const params = new URL(request.url).searchParams
    const regNo = (params.get('regNo') ?? '').slice(0, 30)
    return hpJson(await checkRegistration(regNo, params.get('excludeId')))
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
