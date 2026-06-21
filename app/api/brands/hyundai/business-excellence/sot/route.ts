import { NextResponse } from 'next/server'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-business-excellence-sot')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('hyundai'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const timing = timer.finish()
  return withServerTiming(NextResponse.json({
    sourceStatus: 'unavailable',
    unavailableReason: 'No verified Hyundai Trust Package or SOT-equivalent source is connected.',
    sourceWarnings: [
      'MCP is not used as an SOT substitute because the products have different business definitions.',
    ],
    dateRange: { startDate, endDate },
    kpis: null,
    charts: null,
    rows: [],
    metadata: {
      source: null,
      dealerScoped: false,
      calculationVersion: 'hyundai-sot-unavailable-v1',
    },
  }), timing.serverTiming)
}
