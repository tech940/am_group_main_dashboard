import assert from 'node:assert/strict'
import {
  HYUNDAI_BRANCH_DEALERS,
  getHyundaiDealerCodes,
  getHyundaiDealerLabel,
  normalizeHyundaiDealerCode,
} from '../lib/hyundai/dealer-branch'

const expected = [
  ['JAMMU', ['N5203', 'N5216']],
  ['AKHNOOR', ['N5701', 'N6844']],
  ['KATHUA', ['N5804', 'N6845']],
  ['RS_PURA', ['N6815', 'N6846']],
  ['VIJAYPUR', ['N6819', 'N6847']],
  ['BILLAWAR', ['N6826', 'N6828', 'N6848']],
] as const

assert.equal(HYUNDAI_BRANCH_DEALERS.length, expected.length)

for (const [dealerCode, sourceCodes] of expected) {
  assert.equal(normalizeHyundaiDealerCode(dealerCode), dealerCode)
  assert.deepEqual(getHyundaiDealerCodes(dealerCode), [...sourceCodes])
  for (const sourceCode of sourceCodes) {
    assert.equal(normalizeHyundaiDealerCode(sourceCode), dealerCode)
  }
}

assert.equal(normalizeHyundaiDealerCode('UDHAMPUR'), 'BILLAWAR')
assert.equal(normalizeHyundaiDealerCode('HYUNDAI_UDHAMPUR'), 'BILLAWAR')
assert.equal(getHyundaiDealerLabel('UDHAMPUR'), 'Hyundai Billawar')
assert.equal(normalizeHyundaiDealerCode('N5217'), null)
assert.equal(normalizeHyundaiDealerCode('N6849'), null)

console.log(JSON.stringify({
  locations: HYUNDAI_BRANCH_DEALERS,
  legacyUrlAlias: { UDHAMPUR: normalizeHyundaiDealerCode('UDHAMPUR') },
  deliberatelyUnmapped: ['N5217', 'N6849'],
}, null, 2))
