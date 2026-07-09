/**
 * Unit-verifies dealer/branch scoping (no DB). Run: npm run verify:dealers
 */
import 'dotenv/config'
import { getUserDealerScope, canAccessDealer, enforceDealerScope } from '../lib/auth/dealer-scope'
import type { AppUser } from '../lib/auth/app-user'

let failures = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

function user(partial: Partial<AppUser>): AppUser {
  return { id: 'u', supabaseId: 's', email: 'e', fullName: 'n', role: 'viewer', brand: 'kia', dealers: null, department: null, isActive: true, ...partial } as AppUser
}
const req = (dealer?: string) => new Request(`http://x/api${dealer ? `?dealer_code=${dealer}` : ''}`)

console.log('\n=== Dealer/branch scoping ===\n')

const jammu = user({ role: 'viewer', brand: 'kia', dealers: 'JK402' })
assert('KIA JK402 user scope = [JK402]', JSON.stringify(getUserDealerScope(jammu, 'kia')) === '["JK402"]')
assert('can access own branch JK402', canAccessDealer(jammu, 'kia', 'JK402') === true)
assert('cannot access other branch JK501', canAccessDealer(jammu, 'kia', 'JK501') === false)
assert('request for JK501 is 403', enforceDealerScope(jammu, 'kia', req('JK501'))?.status === 403)
assert('request for JK402 is allowed', enforceDealerScope(jammu, 'kia', req('JK402')) === null)
assert('request for "all" (no dealer) is 403', enforceDealerScope(jammu, 'kia', req())?.status === 403)

const unpinned = user({ role: 'viewer', brand: 'kia', dealers: null })
assert('unpinned KIA user = unrestricted (null scope)', getUserDealerScope(unpinned, 'kia') === null)
assert('unpinned user request for "all" allowed', enforceDealerScope(unpinned, 'kia', req()) === null)

const md = user({ role: 'md', brand: 'kia', dealers: 'JK402' })
assert('MD (super) ignores dealer pin', getUserDealerScope(md, 'kia') === null)

const multi = user({ role: 'manager', brand: 'hyundai', dealers: 'JAMMU,KATHUA' })
assert('Hyundai multi-branch scope parsed', JSON.stringify(getUserDealerScope(multi, 'hyundai')) === '["JAMMU","KATHUA"]')
assert('Hyundai user can access KATHUA', canAccessDealer(multi, 'hyundai', 'KATHUA') === true)
assert('Hyundai user cannot access AKHNOOR', enforceDealerScope(multi, 'hyundai', req('AKHNOOR'))?.status === 403)

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
