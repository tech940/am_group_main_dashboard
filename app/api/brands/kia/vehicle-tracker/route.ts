import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { normalizeKiaDealerCode, DEFAULT_KIA_DEALER_CODE } from '@/lib/kia/dealer-branch'
import { canFillVehicleTracker, canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import {
  createVehicleTrackerEntry,
  listVehicleTrackerEntries,
  uploadTrackerPhoto,
  verifyImageHasVehicle,
} from '@/lib/kia/vehicle-tracker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorize(mode: 'view' | 'fill') {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  const ok = mode === 'fill' ? canFillVehicleTracker(appUser?.role) : canViewVehicleTracker(appUser?.role)
  if (!ok) return { response: NextResponse.json({ error: 'You do not have access to the Vehicle Tracker.' }, { status: 403 }), appUser }
  return { response: null, appUser }
}

export async function GET(request: Request) {
  const auth = await authorize('view')
  if (auth.response) return auth.response
  try {
    const { searchParams } = new URL(request.url)
    const status = (searchParams.get('status') || 'all') as 'out' | 'returned' | 'all'
    const date = searchParams.get('date')
    const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code'))
    const rows = await listVehicleTrackerEntries({ status, date, dealerCode })
    return NextResponse.json({ rows })
  } catch (error) {
    console.error('GET /api/brands/kia/vehicle-tracker failed:', error)
    return NextResponse.json({ error: 'Failed to load vehicle tracker entries.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await authorize('fill')
  if (auth.response) return auth.response
  try {
    const form = await request.formData()
    const name = String(form.get('name') || '').trim()
    const entryDate = String(form.get('entryDate') || '').trim()
    const vehicleOutRaw = String(form.get('vehicleOut') || '').trim()
    const vehicleInRaw = String(form.get('vehicleIn') || '').trim()
    const notes = String(form.get('notes') || '').trim() || null
    const dealerCode = normalizeKiaDealerCode(String(form.get('dealerCode') || '')) || DEFAULT_KIA_DEALER_CODE
    const photo = form.get('photo')

    if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
    if (!entryDate) return NextResponse.json({ error: 'Date is required.' }, { status: 400 })
    if (!vehicleOutRaw) return NextResponse.json({ error: 'Vehicle-out time is required.' }, { status: 400 })
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: 'A camera photo of the vehicle is required.' }, { status: 400 })
    }

    const vehicleOutAt = new Date(vehicleOutRaw)
    if (Number.isNaN(vehicleOutAt.getTime())) return NextResponse.json({ error: 'Invalid vehicle-out time.' }, { status: 400 })

    let vehicleInAt: Date | null = null
    if (vehicleInRaw) {
      vehicleInAt = new Date(vehicleInRaw)
      if (Number.isNaN(vehicleInAt.getTime())) return NextResponse.json({ error: 'Invalid vehicle-in time.' }, { status: 400 })
      if (vehicleInAt.getTime() < vehicleOutAt.getTime()) {
        return NextResponse.json({ error: 'Vehicle-in time cannot be before vehicle-out time.' }, { status: 400 })
      }
    }

    // AI gate: the photo must clearly show a vehicle.
    const verdict = await verifyImageHasVehicle(photo)
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.reason, code: 'not_a_vehicle' }, { status: 422 })
    }

    const stored = await uploadTrackerPhoto(photo, 'out')
    const row = await createVehicleTrackerEntry({
      name,
      entryDate,
      vehicleOutAt,
      vehicleInAt,
      outPhotoUrl: stored.url,
      outPhotoPath: stored.path,
      dealerCode,
      notes,
      createdBy: auth.appUser?.id || null,
    })

    return NextResponse.json({ row })
  } catch (error) {
    console.error('POST /api/brands/kia/vehicle-tracker failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to log the vehicle.' }, { status: 500 })
  }
}
