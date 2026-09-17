import { requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { getMeta } from '@/lib/h-promise/queries'

export const dynamic = 'force-dynamic'

/** What the forms offer: the name lists, the interest rates and typing suggestions. */
export async function GET() {
  const access = await requireHPromiseApi((caps) => caps.anyView || caps.register.create)
  if (access.denied) return access.denied
  try {
    return hpJson(await getMeta())
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
