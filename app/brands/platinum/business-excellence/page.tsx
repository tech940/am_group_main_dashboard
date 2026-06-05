import { getBrandAccess } from '@/lib/auth/brand-access'
import { forbidden, redirect } from 'next/navigation'

export const metadata = {
  title: 'Business Excellence | AM Platinum',
  description: 'AM Platinum Business Excellence performance analytics',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('platinum')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const resolvedSearchParams = await searchParams
  const dateParams = new URLSearchParams()
  for (const key of ['startDate', 'endDate', 'compareStartDate', 'compareEndDate', 'comparisonStartDate', 'comparisonEndDate', 'periodPreset']) {
    const value = resolvedSearchParams[key]
    if (typeof value === 'string' && value) {
      dateParams.set(key, value)
    }
  }

  const query = dateParams.toString()
  redirect(`/brands/platinum/business-excellence/overview${query ? `?${query}` : ''}`)
}
