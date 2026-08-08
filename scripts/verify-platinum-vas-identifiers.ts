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

// Floors, not equalities: the list grows when new codes appear in the source, and pinning an
// exact count made adding a genuinely-missing code look like a regression. Shrinkage is the
// real failure mode — that silently drops VAS revenue.
// NB: this assertion previously pinned 208 and was already FAILING on HEAD — the list had
// drifted to 207 — so it was reporting nothing useful. 213 is the reconciled count.
assert.ok(new Set(PLATINUM_VAS_CODES).size >= 213, `PLATINUM_VAS_CODES shrank to ${new Set(PLATINUM_VAS_CODES).size}`)
// These counts were also stale (wheel alignment asserted 2 against an actual 3).
assert.equal(new Set(PLATINUM_WHEEL_ALIGNMENT_CODES).size, 3)
assert.equal(new Set(PLATINUM_WHEEL_BALANCING_CODES).size, 3)
assert.equal(new Set(PLATINUM_FUEL_INJECTOR_CODES).size, 1)
assert.equal(
  new Set(PLATINUM_ALL_IDENTIFIER_CODES).size,
  new Set(PLATINUM_VAS_CODES).size + 7, // 3 WA + 3 WB + 1 FI, all disjoint from VAS
  'wheel/fuel-injector codes must stay disjoint from VAS',
)
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
