import KiaBusinessExcellencePage from '@/features/kia/business-excellence-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { forbidden, notFound, redirect } from 'next/navigation'

const REPORT_TITLES: Record<string, string> = {
  'overview': 'Business Excellence Overview',
  'executive-dashboard': 'Executive Dashboard',
  'ro-billing-report': 'RO Billing Report',
  'workshop-performance': 'Workshop Performance',
  'open-ro': 'Open RO (Repair Orders)',
  'kia-complaints': 'Kia Complaints',
  'service-dashboard': 'Service Dashboard',
}

const EXECUTIVE_DASHBOARD_ALLOWED_ROLES = new Set(['super_admin', 'ceo', 'md', 'ea'])

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

  if (report === 'executive-dashboard' && !EXECUTIVE_DASHBOARD_ALLOWED_ROLES.has(String(access.appUser.role || '').toLowerCase())) {
    forbidden()
  }

  return <KiaBusinessExcellencePage initialReport={report} currentUserRole={access.appUser.role} />
}
