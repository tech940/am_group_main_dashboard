import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { redirect } from 'next/navigation'
import { KiaVendorsClient } from '@/features/kia/kia-vendors-page'

export const metadata = {
  title: 'Vendor Registry | AM KIA',
  description: 'Manage vendors for KIA vendor payment requests',
}

export default async function KiaVendorsPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  return <KiaVendorsClient />
}
