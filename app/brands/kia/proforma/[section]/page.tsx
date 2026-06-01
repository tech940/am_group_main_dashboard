import { forbidden, redirect } from 'next/navigation'
import { KiaProformaPage, type KiaProformaSection } from '@/features/kia/kia-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'

export const metadata = {
  title: 'Kia Proforma | AM Kia',
  description: 'Kia proforma generation, approval, finance remarks, and analytics',
}

const SECTION_MAP: Record<string, KiaProformaSection> = {
  generate: 'generate',
  'all-proforma-details': 'all',
  'finance-remarks': 'finance-remarks',
  'pending-approval': 'pending-approval',
  'user-database': 'user-database',
  'hyp-ins-analytics': 'analytics',
  'business-insights': 'insights',
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const { section } = await params
  const resolved = SECTION_MAP[section]
  if (!resolved) redirect('/brands/kia/proforma/generate')
  return <KiaProformaPage section={resolved} />
}
