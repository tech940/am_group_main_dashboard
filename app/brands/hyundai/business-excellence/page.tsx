import { getBrandAccess } from '@/lib/auth/brand-access'
import { forbidden, redirect } from 'next/navigation'

export const metadata = {
  title: 'Business Excellence | AM Hyundai',
  description: 'AM Hyundai Business Excellence performance analytics',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('hyundai')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const resolvedSearchParams = await searchParams
  const forwardedParams = new URLSearchParams()
  for (const key of ['startDate', 'endDate', 'compareStartDate', 'compareEndDate', 'comparisonStartDate', 'comparisonEndDate', 'periodPreset']) {
    const value = resolvedSearchParams[key]
    if (typeof value === 'string' && value) {
      forwardedParams.set(key, value)
    }
  }

  const query = forwardedParams.toString()
  redirect(`/brands/hyundai/business-excellence/overview${query ? `?${query}` : ''}`)
}
