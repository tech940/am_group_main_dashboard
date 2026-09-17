import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { deleteExchangeBonus, updateExchangeBonus } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.edit)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const row = await updateExchangeBonus(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, row })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.delete)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    await deleteExchangeBonus(actorOf(access.appUser), access.caps, id)
    return hpJson({ ok: true })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
