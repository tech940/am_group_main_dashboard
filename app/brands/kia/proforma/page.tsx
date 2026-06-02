import { forbidden, redirect } from 'next/navigation'
import { KiaProformaPage } from '@/features/kia/kia-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'

export const metadata = {
  title: 'Kia Proforma | AM Kia',
  description: 'Kia proforma generation, approval, finance remarks, and analytics',
}

export default async function Page() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  return <KiaProformaPage section="generate" />
}
