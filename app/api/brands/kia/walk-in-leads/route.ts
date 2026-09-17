import { requireWalkInApi } from '@/lib/kia/walk-in-leads/access'
import { walkInErrorResponse, walkInJson } from '@/lib/kia/walk-in-leads/api'
import { listWalkInLeads, parseWalkInFilters } from '@/lib/kia/walk-in-leads/server'

export const dynamic = 'force-dynamic'

/** The section's list: one page of leads plus every summary figure for the same filters. */
export async function GET(request: Request) {
  const access = await requireWalkInApi('view')
  if ('denied' in access) return access.denied
  try {
    const filters = parseWalkInFilters(new URL(request.url).searchParams)
    return walkInJson(await listWalkInLeads(access.viewer, filters))
  } catch (error) {
    return walkInErrorResponse(error)
  }
}
