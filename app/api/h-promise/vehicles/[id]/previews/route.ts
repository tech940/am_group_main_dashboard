import { requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { getVehiclePreviews } from '@/lib/h-promise/queries'

export const dynamic = 'force-dynamic'

/**
 * `{ previews: { fileId: signedUrl } }` for a vehicle's image thumbnails. Asked for alongside the vehicle
 * itself, so the drawer opens on the record and the pictures follow. Personal documents are never included.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.anyView)
  if (access.denied) return access.denied
  try {
    const { id } = await params
    return hpJson({ previews: await getVehiclePreviews(access.caps, id) })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
