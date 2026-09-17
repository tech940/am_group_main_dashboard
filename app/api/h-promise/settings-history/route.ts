import { requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { listSettingsHistory } from '@/lib/h-promise/queries'

export const dynamic = 'force-dynamic'

/** Who changed the name lists and rates, and when. */
export async function GET() {
  const access = await requireHPromiseApi((caps) => caps.settings.view)
  if (access.denied) return access.denied
  try {
    return hpJson({ rows: await listSettingsHistory() })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
