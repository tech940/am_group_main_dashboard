// TEMP probe — REAL BUILT bundle cold-start module-eval cost, env loaded, baseline-subtracted.
const path = require('path')
process.chdir(path.resolve(__dirname, '..'))
require('dotenv').config({ quiet: true })

const baseCpu = process.cpuUsage()
const t0 = process.hrtime.bigint()

const target = process.argv[2]
let ok = true
let err = ''
if (target !== 'BASELINE') {
  try { require(path.resolve(target)) } catch (e) { ok = false; err = (e && e.message ? e.message : String(e)).split('\n')[0] }
}

const t1 = process.hrtime.bigint()
const c = process.cpuUsage(baseCpu)
console.log(JSON.stringify({
  target: target.replace('.next/server/app/', ''),
  wallMs: +(Number(t1 - t0) / 1e6).toFixed(1),
  cpuMs: +((c.user + c.system) / 1000).toFixed(1),
  heapMB: +(process.memoryUsage().heapUsed / 1e6).toFixed(1),
  ok, err,
}))
