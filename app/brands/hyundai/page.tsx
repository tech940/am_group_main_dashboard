import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { HyundaiModulePlaceholder } from '@/features/hyundai/hyundai-module-placeholder'

export const metadata = {
  title: 'AM Hyundai',
  description: 'AM Hyundai module setup',
}

export default async function Page() {
  const access = await getBrandAccess('hyundai')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'hyundai.view')
  if (!permission.allowed) {
    forbidden()
  }

  return <HyundaiModulePlaceholder title="AM Hyundai" description="AM Hyundai has been added to the sidebar with the same Service, Sales, and H Promise structure as AM Kia." />
}
