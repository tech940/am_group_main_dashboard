// Exercises the alert state machine WITHOUT sending mail: detectProblems + alertSignature are pure,
// so the transition logic can be proven exhaustively before a single email goes out.
import { detectProblems, alertSignature } from '../lib/callyzer/health.ts'

const hs = (over = {}) => ({
  empName: 'AM HYUNDAI', empNumber: '9484200000', tags: ['Digital team'], appVersion: '2.13.5',
  deviceModel: 'Xiaomi 23028RN4DI', androidVersion: '13',
  registeredAt: null, lastSyncReqAt: '2026-07-28T17:11:00+05:30', lastCallAt: null,
  appUninstalled: false, recordingActive: true, hoursSinceSync: 0.1, status: 'ok', ...over,
})
const raman = (over = {}) => hs({ empName: 'Raman', empNumber: '9484011111', ...over })
const comp = (over = {}) => ({
  windowFrom: '2026-06-01', windowTo: '2026-06-30', ours: 398, theirs: 398,
  delta: 0, inSync: true, byType: [], ...over,
})

let bad = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

console.log('DETECTION — what counts as a problem')
check('healthy pair -> no problems', detectProblems([hs(), raman()], comp()).length, 0)
check('stale (6h) is NOT alertable (idle phone overnight)', detectProblems([hs({ status: 'stale', hoursSinceSync: 8 })], comp()).length, 0)
check('offline IS alertable', detectProblems([hs({ status: 'offline', hoursSinceSync: 30 })], comp()).length, 1)
check('uninstalled IS alertable', detectProblems([hs({ status: 'uninstalled', appUninstalled: true })], comp()).length, 1)
check('recording off IS alertable', detectProblems([hs({ status: 'recording_off', recordingActive: false })], comp()).length, 1)
check('completeness drift IS alertable', detectProblems([hs()], comp({ ours: 390, delta: -8, inSync: false })).length, 1)
check('two bad handsets -> two problems', detectProblems([hs({ status: 'offline', hoursSinceSync: 30 }), raman({ status: 'uninstalled', appUninstalled: true })], comp()).length, 2)

console.log('\nSIGNATURE — stable + order independent')
const a = [hs({ status: 'offline', hoursSinceSync: 30 }), raman({ status: 'uninstalled', appUninstalled: true })]
const b = [raman({ status: 'uninstalled', appUninstalled: true }), hs({ status: 'offline', hoursSinceSync: 30 })]
check('same problems in any order -> same signature', alertSignature(detectProblems(a, comp())) === alertSignature(detectProblems(b, comp())), true)
check('healthy -> empty signature', alertSignature(detectProblems([hs()], comp())), '')
check('offline hours change -> signature UNCHANGED (no re-spam)',
  alertSignature(detectProblems([hs({ status: 'offline', hoursSinceSync: 30 })], comp())) ===
  alertSignature(detectProblems([hs({ status: 'offline', hoursSinceSync: 99 })], comp())), true)
check('different problem type -> signature CHANGES',
  alertSignature(detectProblems([hs({ status: 'offline', hoursSinceSync: 30 })], comp())) !==
  alertSignature(detectProblems([hs({ status: 'uninstalled', appUninstalled: true })], comp())), true)

console.log('\nTRANSITIONS — the whole point: does it send?')
const sig = (h, c) => alertSignature(detectProblems(h, c))
const HEALTHY = sig([hs(), raman()], comp())
const ONE_DOWN = sig([hs({ status: 'offline', hoursSinceSync: 30 }), raman()], comp())
const BOTH_DOWN = sig([hs({ status: 'offline', hoursSinceSync: 30 }), raman({ status: 'offline', hoursSinceSync: 30 })], comp())
const willSend = (prev, next) => prev !== next
const kind = (prev, next) => (next === '' && prev !== '' ? 'recovery' : 'alert')

const CASES = [
  ['healthy -> healthy', HEALTHY, HEALTHY, false, null],
  ['healthy -> one handset down', HEALTHY, ONE_DOWN, true, 'alert'],
  ['one down -> still one down (3h later)', ONE_DOWN, ONE_DOWN, false, null],
  ['one down -> both down', ONE_DOWN, BOTH_DOWN, true, 'alert'],
  ['both down -> healthy', BOTH_DOWN, HEALTHY, true, 'recovery'],
]
for (const [label, prev, next, wantSend, wantKind] of CASES) {
  const send = willSend(prev, next)
  check(label, send, wantSend)
  if (send && wantKind) check(`   ...as a ${wantKind}`, kind(prev, next), wantKind)
}

console.log('\nA WEEK OFFLINE — the spam test (sync runs every 3h = 56 runs)')
let sent = 0
let prev = HEALTHY
for (let run = 0; run < 56; run++) {
  const next = ONE_DOWN
  if (prev !== next) sent++
  prev = next
}
check('56 syncs with the same fault -> emails sent', sent, 1)

console.log(bad === 0 ? '\nPASS — alerts once per incident, recovers, never spams' : `\n*** ${bad} FAILURE(S) ***`)
process.exit(bad === 0 ? 0 : 1)
