import assert from 'node:assert/strict'
import {
  HYUNDAI_ALL_IDENTIFIER_CODES,
  HYUNDAI_VAS_CODES,
  HYUNDAI_WHEEL_ALIGNMENT_CODES,
  HYUNDAI_WHEEL_BALANCING_CODES,
  classifyHyundaiOperationCode,
} from '../lib/hyundai/vas-identifiers'

const vas = new Set<string>(HYUNDAI_VAS_CODES)
const wa = new Set<string>(HYUNDAI_WHEEL_ALIGNMENT_CODES)
const wb = new Set<string>(HYUNDAI_WHEEL_BALANCING_CODES)

// 1. No duplicates inside any list.
assert.equal(vas.size, HYUNDAI_VAS_CODES.length, 'duplicate code in HYUNDAI_VAS_CODES')
assert.equal(wa.size, HYUNDAI_WHEEL_ALIGNMENT_CODES.length, 'duplicate wheel alignment code')
assert.equal(wb.size, HYUNDAI_WHEEL_BALANCING_CODES.length, 'duplicate wheel balancing code')
assert.equal(new Set(HYUNDAI_ALL_IDENTIFIER_CODES).size, HYUNDAI_ALL_IDENTIFIER_CODES.length)

// 2. THE RULE: wheel alignment and wheel balancing are never VAS revenue.
for (const code of [...wa, ...wb]) {
  assert.ok(!vas.has(code), `${code} is wheel work and must not be in HYUNDAI_VAS_CODES`)
}
for (const code of vas) {
  assert.ok(
    !code.startsWith('A10AAGM06WHAL') && !code.startsWith('A10AAGM07WHBL'),
    `${code} looks like wheel work but sits in HYUNDAI_VAS_CODES`,
  )
}

// 3. Every wheel variant is covered — the AA and HW suffixes were previously missing,
//    which silently understated the Actual WA / WB counts.
for (const suffix of ['', 'AA', 'HW']) {
  assert.ok(wa.has(`A10AAGM06WHAL${suffix}`), `missing wheel alignment code A10AAGM06WHAL${suffix}`)
  assert.ok(wb.has(`A10AAGM07WHBL${suffix}`), `missing wheel balancing code A10AAGM07WHBL${suffix}`)
}

// 4. Codes the dealer branches supplied must all classify as VAS.
//    Spot-check across every branch list (N5216, N6844, N6845, N6846, N6847, N6848),
//    including the families the previous 15-code list dropped entirely.
const DEALER_SUPPLIED_VAS = [
  'A10AAACDVASHR', 'A10AAATLVASHR', 'A10AATBC000HR', 'A10AAECMVASHR', 'A10AASPMVASHR',
  'A10AAEGRVASHR', 'A10AAUBCAL0HR', 'A10AAUBCAS0HR', 'A10AASCLVASHR', 'A10AASCMVASHR',
  'A10AASCSVASHR', 'A10AALUB03LNA', 'A10AARUB19LNA', 'A10AAPPLVASHR', 'A10AAPPMVASHR',
  'A10AAPPSVASHR', 'A10AAIELVASHR', 'A10AAIEMVASHR', 'A10AAIESVASHR', 'A10AAAWPVASHR',
  'A10AAISSVASHR', 'A10AAISSVALHR', 'A10AAISSVAMHR', 'A10AAHLRVASHR', 'A10AARRLVASHR',
  'A10AARRSVASHR', 'A10AAPILVASHR', 'A10AAPIMVASHR', 'A10AASA68CROS', 'A10AAEBLVASHR',
  'A10AAEBMVASHR', 'A10AATBC000WT', 'A10AAACDVASWT', 'A10AASCSVASWT', 'A10AAUBCAL0EBAA',
]
for (const code of DEALER_SUPPLIED_VAS) {
  assert.equal(classifyHyundaiOperationCode(code), 'vas', `${code} should classify as vas`)
}

// 5. Classification is normalized and total.
assert.equal(classifyHyundaiOperationCode(' a10aaacdvashr '), 'vas')
assert.equal(classifyHyundaiOperationCode('A10AAGM06WHALAA'), 'wheel_alignment')
assert.equal(classifyHyundaiOperationCode('A10AAGM07WHBLHW'), 'wheel_balancing')
assert.equal(classifyHyundaiOperationCode('263202A501'), 'unknown')
assert.equal(classifyHyundaiOperationCode(''), 'unknown')
assert.equal(classifyHyundaiOperationCode(null), 'unknown')

// 6. Guard against silent shrinkage. The list grew from 15 to 184 codes when the dealer
//    op-code lists were reconciled against the loaded snapshots; that recovered ~21% of
//    VAS revenue. A regression below this floor means codes were dropped again.
assert.ok(vas.size >= 184, `HYUNDAI_VAS_CODES shrank to ${vas.size}; expected at least 184`)

console.log(
  `OK  vas=${vas.size}  wheel_alignment=${wa.size}  wheel_balancing=${wb.size}  ` +
  `total=${HYUNDAI_ALL_IDENTIFIER_CODES.length}`,
)
