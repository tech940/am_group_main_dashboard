import { NextResponse } from 'next/server'
import { HPromiseError, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse } from '@/lib/h-promise/api'
import { buildExport, isExportKind } from '@/lib/h-promise/export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/h-promise/export?kind=register|stock|sold|monthly|bonuses&<MIS filters>
 * The register and the exchange-bonus list belong to the register; the MIS files to MIS & Insights.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const kind = params.get('kind')
  const access = await requireHPromiseApi((caps) =>
    kind === 'register' || kind === 'bonuses' ? caps.register.view || caps.insights.view : caps.insights.view,
  )
  if (access.denied) return access.denied
  try {
    if (!isExportKind(kind)) throw new HPromiseError('That report does not exist.', 400)
    if (kind === 'bonuses' && !access.caps.register.view) throw new HPromiseError('You cannot export the exchange bonus register.', 403)
    const { buffer, filename } = await buildExport(kind, access.caps, params)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
