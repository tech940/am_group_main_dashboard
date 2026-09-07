import 'dotenv/config'
import { NextRequest } from 'next/server'
import { GET as getKiaConfig } from '../app/api/brands/kia/approvals/config/route'
import { GET as getBrandConfig } from '../app/api/brands/[brand]/approvals/config/route'
import { GET as getKiaVendors, POST as postKiaVendors } from '../app/api/brands/kia/vendors/route'
import { GET as getBrandVendors } from '../app/api/brands/[brand]/vendors/route'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

async function run() {
  console.log('1) GET /api/brands/kia/approvals/config')
  const reqConfig = new NextRequest('https://app.amautomotivegroup.com/api/brands/kia/approvals/config')
  const resKiaConfig = await getKiaConfig(reqConfig)
  check(resKiaConfig.status === 200, `KIA config returns 200 OK (got ${resKiaConfig.status})`)
  const dataKiaConfig = await resKiaConfig.json()
  check(dataKiaConfig.success === true, 'KIA config returns success: true')
  check(dataKiaConfig.brand === 'kia', 'KIA config returns brand: kia')
  check(Array.isArray(dataKiaConfig.locations) && dataKiaConfig.locations.length > 0, `KIA locations found: ${dataKiaConfig.locations?.length}`)
  check(Array.isArray(dataKiaConfig.approvalTypes) && dataKiaConfig.approvalTypes.length > 0, `KIA approvalTypes found: ${dataKiaConfig.approvalTypes?.length}`)

  console.log('\n2) GET /api/brands/hyundai/approvals/config (via [brand] dynamic route)')
  const resHyuConfig = await getBrandConfig(reqConfig, { params: Promise.resolve({ brand: 'hyundai' }) })
  check(resHyuConfig.status === 200, `Hyundai config returns 200 OK (got ${resHyuConfig.status})`)
  const dataHyuConfig = await resHyuConfig.json()
  check(dataHyuConfig.success === true, 'Hyundai config returns success: true')

  console.log('\n3) GET /api/brands/kia/vendors (Unauthenticated public call)')
  const reqVendors = new NextRequest('https://app.amautomotivegroup.com/api/brands/kia/vendors')
  const resKiaVendors = await getKiaVendors(reqVendors)
  check(resKiaVendors.status === 200, `KIA vendors returns 200 OK (got ${resKiaVendors.status})`)
  const dataKiaVendors = await resKiaVendors.json()
  check(Array.isArray(dataKiaVendors.vendors), 'data.vendors is an array')
  check(dataKiaVendors.vendors.length > 0, `Vendors count: ${dataKiaVendors.vendors.length}`)
  if (dataKiaVendors.vendors.length > 0) {
    const v = dataKiaVendors.vendors[0]
    check(Boolean(v.name), `Sample vendor name: "${v.name}"`)
    check(v.bankAccountNumber === undefined, 'Bank account is omitted for unauthenticated callers')
  }

  console.log(failures === 0 ? '\n=== ALL ROUTE CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
