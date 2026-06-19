import assert from 'node:assert/strict'
import {
  PLATINUM_ADVISOR_DEPARTMENTS,
  PLATINUM_ALL_IDENTIFIER_CODES,
  PLATINUM_FUEL_INJECTOR_CODES,
  PLATINUM_VAS_CODES,
  PLATINUM_WHEEL_ALIGNMENT_CODES,
  PLATINUM_WHEEL_BALANCING_CODES,
  classifyPlatinumOperationCode,
} from '../lib/platinum/vas-identifiers'

assert.equal(new Set(PLATINUM_VAS_CODES).size, 208)
assert.equal(new Set(PLATINUM_WHEEL_ALIGNMENT_CODES).size, 2)
assert.equal(new Set(PLATINUM_WHEEL_BALANCING_CODES).size, 3)
assert.equal(new Set(PLATINUM_FUEL_INJECTOR_CODES).size, 1)
assert.equal(new Set(PLATINUM_ALL_IDENTIFIER_CODES).size, 214)
assert.equal(Object.keys(PLATINUM_ADVISOR_DEPARTMENTS).length, 50)

assert.equal(classifyPlatinumOperationCode(' a10aaacdvashr '), 'vas')
assert.equal(classifyPlatinumOperationCode('A10AAGM06WHAL'), 'wheel_alignment')
assert.equal(classifyPlatinumOperationCode('A10AAGM07WHBLHW'), 'wheel_balancing')
assert.equal(classifyPlatinumOperationCode('A10AAGM04FICL'), 'fuel_injector')
assert.equal(classifyPlatinumOperationCode('A10AAWBBPF13F'), 'unknown')

const fixtureRows = [
  { code: 'A10AAACDVASHR', amount: 1_699_425 },
  { code: 'A10AAGM04FICL', amount: 1_435 },
  { code: 'A10AAGM06WHAL', amount: 294_854.68 },
  { code: 'A10AAGM07WHBL', amount: 176_091.04 },
  { code: 'A10AAWBBPF13F', amount: 88_126 },
]
const vasRevenue = fixtureRows
  .filter((row) => classifyPlatinumOperationCode(row.code) === 'vas')
  .reduce((sum, row) => sum + row.amount, 0)

assert.equal(vasRevenue, 1_699_425)
console.log('Platinum identifier registry verification passed.')
