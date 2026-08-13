import fs from 'node:fs'

const files = [
  'app/api/brands/kia/business-excellence/overview/route.ts',
  'app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts',
  'app/api/brands/kia/business-excellence/workshop-performance/route.ts',
]

// Grab the contiguous run of ARRAY_AGG lines around each labour_amt hit, plus a little context,
// so we can see whether all 14 sites really share one shape.
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  console.log(`\n===== ${f}`)
  lines.forEach((line, i) => {
    if (!line.includes('ARRAY_AGG(labour_amt')) return
    let start = i
    while (start > 0 && (lines[start - 1].includes('ARRAY_AGG(') || /\bSELECT\b|\bbase AS\b|\w+ AS \(/.test(lines[start - 1]))) start--
    let end = i
    while (end < lines.length - 1 && (lines[end + 1].includes('ARRAY_AGG(') || /FROM ranked|GROUP BY/.test(lines[end + 1]))) end++
    console.log(`--- lines ${start + 1}-${end + 1}`)
    console.log(lines.slice(start, end + 1).map((l, k) => `${start + 1 + k}| ${l}`).join('\n'))
  })
}
