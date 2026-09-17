import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { createOption } from '@/lib/h-promise/options'

export const dynamic = 'force-dynamic'

/** Add a name to the staff, WhatsApp approver or location list. */
export async function POST(request: Request) {
  const access = await requireHPromiseApi((caps) => caps.settings.edit)
  if (access.denied) return access.denied
  try {
    const option = await createOption(actorOf(access.appUser), await readJsonBody(request))
    return hpJson({ ok: true, option }, { status: 201 })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
