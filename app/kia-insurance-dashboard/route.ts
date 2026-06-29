import { serveLandingHtml } from '@/lib/kia-insurance/html'

export const dynamic = 'force-dynamic'

export async function GET() {
  return serveLandingHtml()
}
