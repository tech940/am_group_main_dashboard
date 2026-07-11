import KiaBusinessExcellencePage from '@/features/kia/business-excellence-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { getBrandDealers } from '@/lib/dealers/registry'
import { requirePermission } from '@/lib/permissions/service'
import { forbidden, notFound, redirect } from 'next/navigation'

const REPORT_TITLES: Record<string, string> = {
  'overview': 'Business Excellence Overview',
  'executive-dashboard': 'Executive Dashboard',
  'ro-billing-report': 'RO Billing Report',
  'workshop-performance': 'Workshop Performance',
  'workshop-summary': 'Workshop Summary',
  'open-ro': 'Open RO (Repair Orders)',
  'kia-complaints': 'Kia Complaints',
  'service-dashboard': 'Service Dashboard',
}

export async function generateStaticParams() {
  return Object.keys(REPORT_TITLES).map((report) => ({ report }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ report: string }>
}) {
  const { report } = await params
  const title = REPORT_TITLES[report] || 'Business Excellence'

  return {
    title: `${title} | AM Kia`,
    description: `${title} analytics dashboard`,
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ report: string }>
}) {
  const { report } = await params
  if (!REPORT_TITLES[report]) {
    notFound()
  }

  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'kia.business_excellence.view')
  if (!permission.allowed) {
    forbidden()
  }

  const dealerScope = getUserDealerScope(access.appUser, 'kia')
  const allowedDealers = dealerScope ? getBrandDealers('kia').filter((dealer) => dealerScope.includes(dealer.code)) : undefined

  return <KiaBusinessExcellencePage initialReport={report} currentUserRole={access.appUser.role} allowedDealers={allowedDealers} />
}
