import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { getVehicleDetail } from '@/lib/h-promise/queries'
import { deleteVehicle, updatePurchase } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'
/** Signing the preview images is a storage round trip. */
export const maxDuration = 30

/**
 * One vehicle in full: the record, its bookings, files and history. Personal values are already redacted for
 * people who do not work the deal (lib/h-promise/serialize.ts). Personal documents are never pre-signed here;
 * they open one at a time through /api/h-promise/files/[fileId], which records who looked.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.anyView)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    return hpJson(await getVehicleDetail(access.caps, id))
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}

/** Edit the purchase details. The create right is enough for the desk's own pending or rejected entry. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.edit || caps.register.create)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    const result = await updatePurchase(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true, result })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}

/** Soft delete, with a reason. An approved purchase or sale also needs the approve right. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.register.delete)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    await deleteVehicle(actorOf(access.appUser), access.caps, id, await readJsonBody(request))
    return hpJson({ ok: true })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
