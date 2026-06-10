import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { MgModulePlaceholder } from '@/features/mg/mg-module-placeholder'

export const metadata = {
  title: 'AM MG',
  description: 'AM MG module setup',
}

export default async function Page() {
  const access = await getBrandAccess('mg')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'mg.view')
  if (!permission.allowed) {
    forbidden()
  }

  return (
    <MgModulePlaceholder
      title="AM MG"
      description="AM MG has been added to the sidebar with the same Service, Sales, and H Promise structure as AM Kia and AM Hyundai."
    />
  )
}
