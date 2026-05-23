import { GET as getKiaBusinessExcellence } from '@/app/api/brands/kia/business-excellence/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  return getKiaBusinessExcellence(request)
}
