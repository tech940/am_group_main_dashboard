import { forbidden, redirect } from 'next/navigation'
import { DemoJobCardsPage } from '@/features/kia/demo-job-cards-page'
import { getBrandAccess } from '@/lib/auth/brand-access'

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

  return <DemoJobCardsPage />
}
