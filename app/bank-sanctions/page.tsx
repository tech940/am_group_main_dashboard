import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewBankSanctions } from '@/lib/auth/bank-sanctions-access'
import { MainLayout } from '@/components/layout/main-layout'
import { BankSanctionsWorkspace } from '@/features/bank-sanctions/bank-sanctions-page'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Bank Sanctions | AM Group Dashboard',
  description: 'Bank credit facility register: sanction limits, outstandings and expiry alerts.',
}

/**
 * EA / MD / Accounts / Developer only, via the hardcoded role constant — NOT a permission key,
 * because `admin` and `hr` are family:'super' in the tier model and a key would reach them through
 * the super tier bundle. The sidebar, the search guard and every /api/bank-sanctions route call
 * this same predicate, so none of them can drift from this page.
 */
export default async function BankSanctionsPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  if (!canViewBankSanctions(appUser.role)) {
    forbidden()
  }

  return (
    <MainLayout title="Bank Sanctions" subtitle="Credit facilities, limits, outstandings & expiry">
      <BankSanctionsWorkspace />
    </MainLayout>
  )
}
