import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { KiaFollowUpsPage } from '@/features/kia/kia-follow-ups-page'

export const metadata = {
  title: 'Booking Follow-ups | AM Kia',
  description: 'AM Kia lead follow-up pipeline — scheduled next-touch on every booking so no lead goes cold.',
}

export default async function KiaFollowUpsRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.lead_followups.view')
  if (!permission.allowed) forbidden()

  // The role decides whether the Call button shows. It's only a UI hint — the reveal endpoint
  // re-checks it server-side (canRevealKiaFollowupPhone), which is what actually protects the number.
  return <KiaFollowUpsPage currentUserRole={access.appUser.role} />
}
