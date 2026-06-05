import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { PlatinumModulePlaceholder } from '@/features/platinum/platinum-module-placeholder'

export const metadata = {
  title: 'AM Platinum',
  description: 'AM Platinum module setup',
}

export default async function Page() {
  const access = await getBrandAccess('platinum')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'platinum.view')
  if (!permission.allowed) {
    forbidden()
  }

  return (
    <PlatinumModulePlaceholder
      title="AM Platinum"
      description="AM Platinum has been added to the sidebar with the same Service, Sales, and H Promise structure as AM Kia and AM Hyundai."
    />
  )
}
