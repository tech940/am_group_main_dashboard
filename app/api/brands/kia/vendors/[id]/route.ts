import { NextRequest } from 'next/server'
import { PATCH as dynamicPATCH, DELETE as dynamicDELETE } from '../../../[brand]/vendors/[id]/route'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  return dynamicPATCH(request, {
    params: Promise.resolve({ brand: 'kia', id: params.id })
  })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  return dynamicDELETE(request, {
    params: Promise.resolve({ brand: 'kia', id: params.id })
  })
}
