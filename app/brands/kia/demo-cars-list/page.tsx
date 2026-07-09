import { forbidden, redirect } from 'next/navigation'
import { DemoCarsListPage } from '@/features/kia/demo-cars-list-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Demo Cars List | AM Kia',
  description: 'Active AM Kia demo car stock list with remarks tracking',
}

export default async function Page() {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'kia.demo_cars_list.view')
  if (!permission.allowed) {
    forbidden()
  }

  return <DemoCarsListPage />
}
