import { requireWalkInApi } from '@/lib/kia/walk-in-leads/access'
import { readWalkInBody, walkInErrorResponse, walkInJson } from '@/lib/kia/walk-in-leads/api'
import { deleteWalkInLead, updateWalkInLead } from '@/lib/kia/walk-in-leads/server'

export const dynamic = 'force-dynamic'

/** Follow-up: remarks, expected booking date, booked, consultant. Needs kia.walk_in_leads.edit. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWalkInApi('edit')
  if ('denied' in access) return access.denied
  try {
    const { id } = await params
    const lead = await updateWalkInLead(access.viewer, id, await readWalkInBody(request))
    return walkInJson({ ok: true, lead })
  } catch (error) {
    return walkInErrorResponse(error)
  }
}

/** Remove a spam or duplicate entry, with a reason (kept on the row). Needs kia.walk_in_leads.delete. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWalkInApi('delete')
  if ('denied' in access) return access.denied
  try {
    const { id } = await params
    await deleteWalkInLead(access.viewer, id, await readWalkInBody(request))
    return walkInJson({ ok: true })
  } catch (error) {
    return walkInErrorResponse(error)
  }
}
