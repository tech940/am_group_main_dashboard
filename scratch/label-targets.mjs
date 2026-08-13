import fs from 'node:fs'

const p = 'features/kia/business-excellence-page.tsx'
let s = fs.readFileSync(p, 'utf8')

// Only labels of figures DERIVED from LY_GROWTH_TARGET_MULTIPLIER get the basis suffix.
// 'MTD Achieved' and 'Projected Closing' are real measurements — deliberately untouched.
const targets = ['Month Target', 'MTD Target', 'Shortfall T.D', 'Monthly Shortfall', 'Asking Rate']

let n = 0
for (const t of targets) {
  const needle = `label: '${t}'`
  const replacement = `label: \`${t} (\${TARGET_BASIS_LABEL})\``
  let idx = 0
  while ((idx = s.indexOf(needle, idx)) !== -1) {
    s = s.slice(0, idx) + replacement + s.slice(idx + needle.length)
    idx += replacement.length
    n++
  }
}

fs.writeFileSync(p, s)
console.log('labels updated:', n)
