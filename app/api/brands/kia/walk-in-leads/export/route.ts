import { NextResponse } from 'next/server'
import { requireWalkInApi } from '@/lib/kia/walk-in-leads/access'
import { walkInErrorResponse } from '@/lib/kia/walk-in-leads/api'
import { exportWalkInLeads, parseWalkInFilters } from '@/lib/kia/walk-in-leads/server'

export const dynamic = 'force-dynamic'

/** Excel of the filtered leads. Phone, e-mail and address stay masked for anyone who cannot see them. */
export async function GET(request: Request) {
  const access = await requireWalkInApi('view')
  if ('denied' in access) return access.denied
  try {
    const filters = parseWalkInFilters(new URL(request.url).searchParams)
    const file = await exportWalkInLeads(access.viewer, filters)
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="kia-walk-in-leads-${filters.from}-to-${filters.to}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return walkInErrorResponse(error)
  }
}
