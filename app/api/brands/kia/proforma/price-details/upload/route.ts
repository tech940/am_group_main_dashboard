import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { importKiaPriceDetailsFromWorkbook } from '@/lib/kia-proforma/price-details-import'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['edp', 'developer'].includes(appUser.role)) return NextResponse.json({ error: 'Only EDP and Developer users can upload/replace price details.' }, { status: 403 })
    const profile = await ensureKiaUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Upload an Excel file under the field name "file".' }, { status: 400 })
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      return NextResponse.json({ error: 'Only Excel workbooks are supported.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const summary = await importKiaPriceDetailsFromWorkbook(buffer)
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    console.error('Error in POST /api/brands/kia/proforma/price-details/upload:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to import Kia price details.' }, { status: 400 })
  }
}
