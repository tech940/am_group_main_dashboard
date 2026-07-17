import { GET } from '../app/api/brands/kia/approvals/list/route'
import { NextRequest } from 'next/server'

// Mock getAuthenticatedAppUser
jest.mock('../../lib/auth/app-user', () => ({
  getAuthenticatedAppUser: jest.fn().mockResolvedValue({ id: 'test', role: 'developer' })
}))

async function run() {
  try {
    const req = new NextRequest('http://localhost:3000/api/brands/kia/approvals/list')
    const res = await GET(req)
    console.log('STATUS:', res.status)
    console.log('JSON:', await res.json())
  } catch (err) {
    console.error('ERROR:', err)
  }
}
run()
