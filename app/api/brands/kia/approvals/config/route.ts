import { NextRequest } from 'next/server'
import { GET as dynamicGET } from '../../../[brand]/approvals/config/route'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  _context?: { params?: Promise<{ brand?: string }> }
) {
  return dynamicGET(request, { params: Promise.resolve({ brand: 'kia' }) })
}
