import { NextRequest } from 'next/server'
import { PATCH as dynamicPATCH, DELETE as dynamicDELETE } from '../../../[brand]/vendors/[id]/route'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return dynamicPATCH(request, { params: Promise.resolve({ brand: 'kia', id }) })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return dynamicDELETE(request, { params: Promise.resolve({ brand: 'kia', id }) })
}
