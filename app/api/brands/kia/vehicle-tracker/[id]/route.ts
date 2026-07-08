import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import {
  checkInVehicleTrackerEntry,
  uploadTrackerPhoto,
  verifyImageHasVehicle,
} from '@/lib/kia/vehicle-tracker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PERMISSION = 'kia.service_appointment.view'

// Mark a vehicle as returned. Accepts an optional in-photo (also AI-verified).
export async function PATCH(request: Request, context: RouteContext<'/api/brands/kia/vehicle-tracker/[id]'>) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, PERMISSION)
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const { id } = await context.params
    const form = await request.formData()
    const vehicleInRaw = String(form.get('vehicleIn') || '').trim()
    const vehicleInAt = vehicleInRaw ? new Date(vehicleInRaw) : new Date()
    if (Number.isNaN(vehicleInAt.getTime())) {
      return NextResponse.json({ error: 'Invalid vehicle-in time.' }, { status: 400 })
    }

    let inPhotoUrl: string | null = null
    let inPhotoPath: string | null = null
    const photo = form.get('photo')
    if (photo instanceof File && photo.size > 0) {
      const verdict = await verifyImageHasVehicle(photo)
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.reason, code: 'not_a_vehicle' }, { status: 422 })
      }
      const stored = await uploadTrackerPhoto(photo, 'in')
      inPhotoUrl = stored.url
      inPhotoPath = stored.path
    }

    const row = await checkInVehicleTrackerEntry({
      id,
      vehicleInAt,
      inPhotoUrl,
      inPhotoPath,
      updatedBy: appUser?.id || null,
    })
    if (!row) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })

    return NextResponse.json({ row })
  } catch (error) {
    console.error('PATCH /api/brands/kia/vehicle-tracker/[id] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to mark returned.' }, { status: 500 })
  }
}
