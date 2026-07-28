import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { CallAnalysisPage } from '@/features/call-analysis/call-analysis-page'

export const metadata = {
  title: 'Call Analysis | AM Group',
  description: 'Call volume, agent performance, timing patterns, customer matching and recordings.',
}

export default async function CallAnalysisRoute() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Hardcoded allowlist — MD and Developer only. See lib/callyzer/access.ts for why this is a role
  // gate rather than a permission.
  if (!canViewCallAnalysis(appUser.role)) forbidden()

  return <CallAnalysisPage />
}
