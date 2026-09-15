import { BrandInsurancePage } from '@/features/insurance/brand-insurance-page'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Insurance | AM Hyundai',
  description: 'AM Hyundai insurance policy book — renewals, retention and the calling desk',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <BrandInsurancePage brand="hyundai" searchParams={searchParams} />
}
