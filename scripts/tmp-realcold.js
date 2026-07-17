// TEMP probe — loads the REAL BUILT route bundle (prebundled, no transpile) in a fresh Node
// process and times module load. This is the production cold-start module-eval cost.
const path = require('path')
const t0 = process.hrtime.bigint()
process.chdir(path.resolve(__dirname, '..'))

const target = process.argv[2]
let mod
try {
  mod = require(path.resolve(target))
} catch (e) {
  console.log('LOAD ERROR:', e && e.message ? e.message.split('\n')[0] : e)
}
const t1 = process.hrtime.bigint()
console.log(JSON.stringify({
  target,
  moduleEvalMs: +(Number(t1 - t0) / 1e6).toFixed(1),
  loaded: !!mod,
  heapMB: +(process.memoryUsage().heapUsed / 1e6).toFixed(1),
  cpuMs: +((process.cpuUsage().user + process.cpuUsage().system) / 1000).toFixed(1),
}))
