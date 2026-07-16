import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { redirect } from 'next/navigation'
import { KiaApprovalsClient } from '@/features/kia/kia-approvals-page'

export default async function KiaApprovalsPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  return (
    <KiaApprovalsClient
      currentUser={{
        id: appUser.id,
        role: appUser.role,
        fullName: appUser.fullName,
        email: appUser.email,
      }}
    />
  )
}
