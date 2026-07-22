import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { redirect } from 'next/navigation'
import { KiaApprovalsClient } from '@/features/kia/kia-approvals-page'

// Gated by 'kia.approvals.view' permission
export default async function KiaPaymentApprovalsPage() {
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
