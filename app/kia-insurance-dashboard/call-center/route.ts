import { serveHtml } from '@/lib/kia-insurance/html'

export const dynamic = 'force-dynamic'

export async function GET() {
  return serveHtml('kia-insurance-dashboard/call-center.html')
}
