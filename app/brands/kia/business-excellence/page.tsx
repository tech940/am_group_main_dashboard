import { getBrandAccess } from '@/lib/auth/brand-access'
import { forbidden, redirect } from 'next/navigation'

export const metadata = {
  title: 'Business Excellence | AM Kia',
  description: 'Business Excellence Index AM KIA (NEW)',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const resolvedSearchParams = await searchParams
  const dateParams = new URLSearchParams()
  for (const key of ['startDate', 'endDate', 'compareStartDate', 'compareEndDate', 'comparisonStartDate', 'comparisonEndDate', 'periodPreset', 'periodMode', 'year', 'dealer_code']) {
    const value = resolvedSearchParams[key]
    if (typeof value === 'string' && value) {
      dateParams.set(key, value)
    }
  }

  const query = dateParams.toString()
  const role = access.appUser?.role
  const canAccessExecutive = ['super_admin', 'ceo', 'md', 'ea', 'eba'].includes(String(role || '').trim().toLowerCase())
  const defaultReport = canAccessExecutive ? 'executive-dashboard' : 'overview'
  redirect(`/brands/kia/business-excellence/${defaultReport}${query ? `?${query}` : ''}`)
}
