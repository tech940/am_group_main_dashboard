// Unit-check the datasetHasNumbers guard's logic against the shapes it will actually see.
function datasetHasNumbers(value, depth = 0) {
  if (depth > 6 || value == null) return false
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value === 'string') {
    const n = Number(value.replace(/[,\s₹%]/g, ''))
    return Number.isFinite(n) && n !== 0
  }
  if (Array.isArray(value)) return value.some((item) => datasetHasNumbers(item, depth + 1))
  if (typeof value === 'object') return Object.values(value).some((item) => datasetHasNumbers(item, depth + 1))
  return false
}

const cases = [
  ['all-zero payload (failed reads)', { table: { rows: [{ labour: 0, parts: 0 }] }, trend: [] }, false],
  ['empty arrays', { rows: [], trend: [], charts: {} }, false],
  ['null/undefined soup', { a: null, b: undefined, c: { d: null } }, false],
  ['real data', { table: { rows: [{ labour: 245000, parts: 0 }] } }, true],
  ['currency strings', { rows: [{ revenue: '₹2,45,000' }] }, true],
  ['zero currency string', { rows: [{ revenue: '₹0' }] }, false],
  ['labels only, no numbers', { rows: [{ name: 'Jammu', status: 'open' }] }, false],
  ['nested real value', { a: { b: { c: { d: { e: 42 } } } } }, true],
  ['deep beyond limit', { a: { b: { c: { d: { e: { f: { g: { h: 42 } } } } } } } }, false],
]

let fail = 0
for (const [label, input, expected] of cases) {
  const got = datasetHasNumbers(input)
  const ok = got === expected
  if (!ok) fail++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(34)} → ${got} (want ${expected})`)
}
console.log(fail ? `\n${fail} FAILED` : '\nall cases pass')
process.exit(fail ? 1 : 0)
