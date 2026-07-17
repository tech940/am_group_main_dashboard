const fs = require('fs')
const path = require('path')

const files = [
  ['bookings LIST', '.next/server/app/api/brands/kia/bookings/route.js.nft.json'],
  ['bookings [id]', '.next/server/app/api/brands/kia/bookings/[id]/route.js.nft.json'],
  ['auth/user', '.next/server/app/api/auth/user/route.js.nft.json'],
  ['user-preferences', '.next/server/app/api/user-preferences/route.js.nft.json'],
  ['proforma/options', '.next/server/app/api/brands/kia/proforma/options/route.js.nft.json'],
  ['PAGE /brands/kia/proforma', '.next/server/app/brands/kia/proforma/page.js.nft.json'],
]

const HEAVY = ['googleapis', 'exceljs', 'xlsx', '@google-cloud', 'recharts', 'framer-motion', 'nodemailer', 'zod', 'drizzle-orm', 'postgres', '@supabase', '@upstash', 'react-dom', 'next', 'date-fns', 'motion']

for (const [label, f] of files) {
  if (!fs.existsSync(f)) { console.log(label, '-> MISSING'); continue }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  const base = path.dirname(f)
  const counts = {}
  const bytes = {}
  let totalBytes = 0
  for (const p of j.files) {
    const norm = p.split(path.sep).join('/')
    const m = norm.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    const key = m ? m[1] : '(app code)'
    counts[key] = (counts[key] || 0) + 1
    let sz = 0
    try { sz = fs.statSync(path.resolve(base, p)).size } catch {}
    bytes[key] = (bytes[key] || 0) + sz
    totalBytes += sz
  }
  const top = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log('=== ' + label + ' === traced files: ' + j.files.length + '  total ' + (totalBytes / 1e6).toFixed(1) + ' MB')
  for (const [k, v] of top) console.log('    ' + String(k).padEnd(28) + (v / 1e6).toFixed(2) + ' MB  (' + counts[k] + ' files)')
  const found = HEAVY.filter((h) => counts[h])
  console.log('    HEAVY PRESENT: ' + found.join(', '))
  console.log()
}
