import { GET as getKiaROBillingAnalysis } from '@/app/api/brands/kia/business-excellence/ro-billing-analysis/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  return getKiaROBillingAnalysis(request)
}
