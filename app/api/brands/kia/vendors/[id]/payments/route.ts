import { NextRequest } from 'next/server'
import { GET as dynamicGET } from '../../../../[brand]/vendors/[id]/payments/route'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  return dynamicGET(request, {
    params: Promise.resolve({ brand: 'kia', id: params.id })
  })
}
