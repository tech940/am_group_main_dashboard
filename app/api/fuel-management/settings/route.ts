import { NextResponse, type NextRequest } from 'next/server'
import { guardFuelManagement, NO_STORE, refuse } from '@/lib/fuel-management/api'
import {
  deleteFuelBenchmark,
  FuelSettingsError,
  getFuelSettings,
  saveFuelBenchmark,
  saveFuelSettings,
  type BenchmarkInput,
} from '@/lib/fuel-management/settings'
import type { FuelSettingsResponse } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/fuel-management/settings — thresholds, benchmarks and the change log. Anyone who can open the section.
 * PUT  /api/fuel-management/settings — { settings?: {key: number|null}, benchmark?: {...}, deleteBenchmarkId? }.
 *      Needs canEditFuelManagement (owner decision 2026-09-11: MD, GM and admin, or an explicit tick).
 */
export async function GET() {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json<FuelSettingsResponse>(await getFuelSettings(guard.canEdit), { headers: NO_STORE })
  } catch (error) {
    console.error('[fuel-management] settings read failed:', error)
    return refuse(500, 'Fuel settings could not be loaded just now. Please try again.')
  }
}

export async function PUT(request: NextRequest) {
  const guard = await guardFuelManagement({ needEdit: true })
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null) as {
    settings?: Record<string, unknown>
    benchmark?: BenchmarkInput
    deleteBenchmarkId?: unknown
  } | null
  if (!body || typeof body !== 'object') return refuse(400, 'The change could not be read. Please try again.')

  try {
    if (body.settings && typeof body.settings === 'object') await saveFuelSettings(guard.appUser, body.settings)
    if (body.benchmark && typeof body.benchmark === 'object') await saveFuelBenchmark(guard.appUser, body.benchmark)
    if (typeof body.deleteBenchmarkId === 'string' && /^[0-9a-f-]{36}$/i.test(body.deleteBenchmarkId)) {
      await deleteFuelBenchmark(guard.appUser, body.deleteBenchmarkId)
    }
    return NextResponse.json<FuelSettingsResponse>(await getFuelSettings(guard.canEdit), { headers: NO_STORE })
  } catch (error) {
    if (error instanceof FuelSettingsError) return refuse(error.status, error.message)
    console.error('[fuel-management] settings write failed:', error)
    return refuse(500, 'The change could not be saved just now. Please try again.')
  }
}
