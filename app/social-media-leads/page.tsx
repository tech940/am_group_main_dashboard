import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { MainLayout } from '@/components/layout/main-layout'
import { SocialMediaLeadsDashboard } from '@/features/testing/social-media-leads-dashboard'

export const metadata = {
  title: 'Social Media Leads | AM Group',
  description: 'Manage incoming social media leads, Interakt WhatsApp transcripts, CRE/KEC remarks, and follow-up interest status.',
}

export default async function SocialMediaLeadsTestingPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const role = String(appUser.role || '').toLowerCase().trim()
  const isAuthorized = ['md', 'developer', 'admin'].includes(role)

  if (!isAuthorized) {
    forbidden()
  }

  return (
    <MainLayout
      title="Social Media Leads"
      subtitle="CRE WhatsApp social media leads management & Interakt conversation pipeline"
    >
      <SocialMediaLeadsDashboard currentUserRole={appUser.role} />
    </MainLayout>
  )
}
