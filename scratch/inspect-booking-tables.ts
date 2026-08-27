import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

import { isApprovalVisibleTo, isKiaJammuServiceApproval } from '@/lib/kia/approval-scope'
import type { AppUser } from '@/lib/auth/app-user'

async function main() {
  const edUser: AppUser = {
    id: 'c084f93b-3fd7-44e7-9b82-88f9f8e95270',
    email: 'mohanamkia@gmail.com',
    fullName: 'Mohan',
    role: 'ed',
    brand: 'kia',
    dealers: 'JK402,JK501',
    department: 'ED DEPARTMENT',
    isActive: true,
  }

  const testCases = [
    { name: 'Kia Jammu Sales (JK402)', row: { brand: 'kia', dealerCode: 'JK402', location: 'JAMMU', department: 'SALES' }, expected: true },
    { name: 'Kia Jammu Service (JK402)', row: { brand: 'kia', dealerCode: 'JK402', location: 'JAMMU', department: 'SERVICE' }, expected: false },
    { name: 'Kia Jammu Service (KIA-JM)', row: { brand: 'kia', dealerCode: 'KIA-JM', location: 'Jammu', department: 'SERVICE' }, expected: false },
    { name: 'Kia Jammu Workshop (JK402)', row: { brand: 'kia', dealerCode: 'JK402', location: 'JAMMU', department: 'WORKSHOP' }, expected: false },
    { name: 'Kia Udhampur Sales (JK501)', row: { brand: 'kia', dealerCode: 'JK501', location: 'UDHAMPUR', department: 'SALES' }, expected: true },
    { name: 'Kia Udhampur Service (JK501)', row: { brand: 'kia', dealerCode: 'JK501', location: 'UDHAMPUR', department: 'SERVICE' }, expected: true },
    { name: 'Kia Banihal Sales (JK502)', row: { brand: 'kia', dealerCode: 'JK502', location: 'BANIHAL', department: 'SALES' }, expected: true },
    { name: 'Platinum Sales', row: { brand: 'platinum', dealerCode: 'JK301', location: 'JAMMU', department: 'SALES' }, expected: true },
    { name: 'Platinum Service', row: { brand: 'platinum', dealerCode: 'JK301', location: 'JAMMU', department: 'SERVICE' }, expected: true },
    { name: 'Hyundai Sales', row: { brand: 'hyundai', dealerCode: 'N5211', location: 'JAMMU', department: 'SALES' }, expected: true },
    { name: 'Hyundai Service', row: { brand: 'hyundai', dealerCode: 'N5211', location: 'JAMMU', department: 'SERVICE' }, expected: true },
  ]

  console.log('Testing ED Visibility Rules:')
  for (const tc of testCases) {
    const result = isApprovalVisibleTo(edUser, tc.row)
    const pass = result === tc.expected
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${tc.name}: visible=${result} (expected ${tc.expected})`)
  }
}

main().catch(console.error)
