// TEMP probe — measures V8 parse+compile CPU for the chunks each route's entry actually loads
// (the R.c(...) list in the built route.js). This is the floor of cold-start Active CPU:
// real cold start = this + module EXECUTION + JIT warmup.
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const SERVER = path.resolve('.next')

function chunksFor(entry) {
  const src = fs.readFileSync(entry, 'utf8')
  const out = []
  const re = /R\.c\("([^"]+)"\)/g
  let m
  while ((m = re.exec(src))) out.push(m[1])
  const rt = src.match(/require\("([^"]*\[turbopack\]_runtime\.js)"\)/)
  if (rt) out.unshift(path.relative(SERVER, path.resolve(path.dirname(entry), rt[1])).split(path.sep).join('/'))
  return out
}

function measure(label, entry) {
  if (!fs.existsSync(entry)) { console.log(label, '-> MISSING'); return }
  const chunks = chunksFor(entry)
  let bytes = 0
  const sources = []
  for (const c of chunks) {
    const p = path.join(SERVER, c)
    if (!fs.existsSync(p)) continue
    const s = fs.readFileSync(p, 'utf8')
    bytes += Buffer.byteLength(s)
    sources.push([c, s])
  }
  // Compile each chunk fresh (no code cache) — this is what a cold instance pays.
  const t0 = process.hrtime.bigint()
  for (const [name, s] of sources) {
    try { new vm.Script(s, { filename: name, produceCachedData: false }) } catch (e) { /* wrapper-dependent */ }
  }
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  console.log(
    label.padEnd(30) +
    String(sources.length).padStart(3) + ' chunks  ' +
    (bytes / 1024).toFixed(0).padStart(6) + ' KB  ' +
    'parse+compile ' + ms.toFixed(1).padStart(7) + ' ms'
  )
  return { bytes, ms }
}

console.log('=== V8 parse+compile of route entry chunks (cold-start FLOOR, excludes execution) ===')
const routes = [
  ['api/brands/kia/bookings', '.next/server/app/api/brands/kia/bookings/route.js'],
  ['api/brands/kia/bookings/[id]', '.next/server/app/api/brands/kia/bookings/[id]/route.js'],
  ['api/auth/user', '.next/server/app/api/auth/user/route.js'],
  ['api/user-preferences', '.next/server/app/api/user-preferences/route.js'],
  ['api/brands/kia/proforma/options', '.next/server/app/api/brands/kia/proforma/options/route.js'],
  ['PAGE /brands/kia/proforma', '.next/server/app/brands/kia/proforma/page.js'],
  ['PAGE /brands/kia/proforma/[s]', '.next/server/app/brands/kia/proforma/[section]/page.js'],
]
for (const [l, e] of routes) measure(l, path.resolve(e))

console.log()
console.log('=== per-chunk detail for the bookings LIST route ===')
const entry = path.resolve('.next/server/app/api/brands/kia/bookings/route.js')
for (const c of chunksFor(entry)) {
  const p = path.join(SERVER, c)
  if (!fs.existsSync(p)) { console.log('   MISSING ' + c); continue }
  const s = fs.readFileSync(p, 'utf8')
  const t0 = process.hrtime.bigint()
  try { new vm.Script(s, { filename: c }) } catch {}
  const t1 = process.hrtime.bigint()
  console.log('   ' + (Buffer.byteLength(s) / 1024).toFixed(0).padStart(6) + ' KB  ' +
    (Number(t1 - t0) / 1e6).toFixed(1).padStart(6) + ' ms  ' + c)
}
