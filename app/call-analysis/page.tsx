import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
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
  /*
   * ⚠️ This page carries customer names and contact numbers for thousands of vehicles. It is
   * grantable now, but one person at a time and never by a role default — see GRANT_ONLY_SECTIONS.
   */
  if (!canViewCallAnalysis(appUser.role)
    && !(await isPermissionExplicitlyAllowed(appUser, 'call_analysis.view'))) forbidden()

  return <CallAnalysisPage />
}
