import { NextRequest } from 'next/server'
import { GET as dynamicGET, POST as dynamicPOST } from '../../[brand]/vendors/route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return dynamicGET(request, { params: Promise.resolve({ brand: 'kia' }) })
}

export async function POST(request: NextRequest) {
  return dynamicPOST(request, { params: Promise.resolve({ brand: 'kia' }) })
}
