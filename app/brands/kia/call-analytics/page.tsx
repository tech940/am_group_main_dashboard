import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { KiaCallAnalyticsPage } from '@/features/kia/kia-call-analytics-page'

export const metadata = {
  title: 'Call & Follow-up Analytics | AM Kia',
  description: 'AM Kia manager analytics — call volume, contact rate, dispositions, follow-up completion and leaderboards.',
}

export default async function KiaCallAnalyticsRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.call_analytics.view')
  if (!permission.allowed) forbidden()

  return <KiaCallAnalyticsPage />
}
