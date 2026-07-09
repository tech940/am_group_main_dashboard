import { forbidden, redirect } from 'next/navigation'
import { DemoJobCardsPage } from '@/features/kia/demo-job-cards-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Demo Job Cards | AM Kia',
  description: 'Demo vehicle job card aging and SLA analytics',
}

export default async function Page() {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'kia.demo_job_cards.view')
  if (!permission.allowed) {
    forbidden()
  }

  return <DemoJobCardsPage />
}
