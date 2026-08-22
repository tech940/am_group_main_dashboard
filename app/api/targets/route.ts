import { NextRequest, NextResponse } from 'next/server'
import { requireMdTargetsApiAccess } from '@/lib/targets/api-guard'
import { getTargetsPayload } from '@/lib/targets/reader'
import { TargetValidationError, upsertBrandTargets } from '@/lib/targets/store'
import { isTargetBrand, TARGET_BRANDS, type TargetBrand } from '@/lib/targets/constants'

export const dynamic = 'force-dynamic'
// The FY read fans out over the sales and service feeds for a whole year; the cockpit route uses
// the same allowance for the same shape of work.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const gate = await requireMdTargetsApiAccess()
    if (gate.response) return gate.response

    const params = request.nextUrl.searchParams
    const brandParam = String(params.get('brand') || '').trim().toLowerCase()
    const brand: TargetBrand = isTargetBrand(brandParam) ? brandParam : TARGET_BRANDS[0]

    // No period parameter: the page is always the CURRENT month, resolved server-side in IST so a
    // client clock cannot shift which month the MD is looking at.
    const payload = await getTargetsPayload({ brand })

    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/targets failed:', error)
    return NextResponse.json({ error: 'Failed to load targets' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Same predicate as the page and the sidebar. There is deliberately no explicit-grant escape
    // hatch — see lib/targets/api-guard.ts.
    const gate = await requireMdTargetsApiAccess()
    if (gate.response) return gate.response

    const body = await request.json()
    const brand = String(body?.brand || '').trim().toLowerCase()
    const result = await upsertBrandTargets(gate.appUser, brand, body?.entries || [])
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof TargetValidationError) {
      // A rejected target is loud on purpose: silently dropping one would leave the MD believing a
      // number is set that is not.
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('POST /api/targets failed:', error)
    return NextResponse.json({ error: 'Failed to save targets' }, { status: 500 })
  }
}
