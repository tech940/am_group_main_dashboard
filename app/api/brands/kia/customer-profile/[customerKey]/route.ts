import { NextResponse } from 'next/server'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getKiaCustomerProfile } from '@/lib/kia/customer-profile/reader'
import { parseCustomerKey } from '@/lib/kia/customer-profile/identity'
import { redactKiaCustomerProfile } from '@/lib/kia/customer-profile/redact'

export const maxDuration = 60

export async function GET(
  request: Request,
  context: { params: Promise<{ customerKey: string }> },
) {
  const denied = await requireBrandSectionApiAccess('kia', 'kia.customer_profile.view', request)
  if (denied) return denied

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { customerKey } = await context.params
  // parseCustomerKey validates the shape: a 17-character VIN (excluding I/O/Q per the VIN
  // standard) or a DMS party key. Anything else is rejected rather than reaching a query.
  const key = parseCustomerKey(decodeURIComponent(customerKey))
  if (!key) return NextResponse.json({ error: 'Invalid customer key' }, { status: 400 })

  const url = new URL(request.url)

  try {
    const profile = await getKiaCustomerProfile(key, {
      serviceGapMonths: Number(url.searchParams.get('service_gap_months')) || null,
    })
    if (!profile) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    return NextResponse.json(redactKiaCustomerProfile(profile, appUser.role))
  } catch (error) {
    console.error('[kia/customer-profile] profile failed', error)
    return NextResponse.json({ error: 'Failed to load customer profile' }, { status: 500 })
  }
}
