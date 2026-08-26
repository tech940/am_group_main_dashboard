/**
 * Every timestamp in KIA Booking Follow-ups renders in IST, for every viewer.
 *
 * Two halves, because the section had two different kinds of defect:
 *
 *   A. BEHAVIOUR — the shared primitives must return the same answer no matter what the process
 *      timezone is. This test re-runs itself under four zones (see scripts/verify-followups-ist.sh
 *      equivalent below: it spawns itself with TZ set) and compares the results.
 *
 *   B. STATIC — no file in the section may format a date, or decide a calendar day, without an
 *      explicit IST anchor. This is what stops the next edit quietly reintroducing
 *      `toLocaleString('en-IN')`, which looks India-specific and is not: 'en-IN' is a LANGUAGE,
 *      and with no timeZone the value renders in the viewer's zone (and in UTC during SSR).
 *
 * Read-only. Run: npm run verify:followups-ist
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { getIndiaYmd, getIndiaCivilDate, indiaDayBounds, indiaDayDiff, formatIstDateTime } from '../lib/date-time'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

/** The instant that breaks local-clock code: 19:00Z on the 26th is already 00:30 IST on the 27th. */
const PIVOT = '2026-08-26T19:00:00Z'

/** Everything the primitives claim, as one comparable string. */
function fingerprint(): string {
  const bounds = indiaDayBounds('2026-08-26')
  return [
    getIndiaYmd(PIVOT),
    getIndiaCivilDate(PIVOT).toISOString(),
    bounds.start?.toISOString(),
    bounds.end?.toISOString(),
    indiaDayDiff('2026-08-26T10:00:00Z', PIVOT),
    formatIstDateTime(PIVOT),
  ].join(' | ')
}

const SECTION_FILES = [
  'features/kia/kia-follow-ups-page.tsx',
  'lib/kia/lead-followups.ts',
  'lib/kia/followup-reminders.ts',
  'app/api/brands/kia/follow-ups/route.ts',
  'app/api/brands/kia/follow-ups/[id]/route.ts',
  'app/api/brands/kia/follow-ups/bookings/route.ts',
  'app/api/brands/kia/follow-ups/export/route.ts',
  'app/api/brands/kia/follow-ups/run-reminders/route.ts',
]

/** Strips comments so prose ABOUT the banned calls is not mistaken for the calls themselves. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function main() {
  // ── A. The primitives are timezone-independent ──────────────────────────────────────────────
  if (process.env.IST_CHILD === '1') {
    process.stdout.write(fingerprint())
    return
  }

  console.log('1) The IST primitives return the same answer under any process timezone')
  const zones = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Kiritimati']
  const seen = new Map<string, string[]>()
  for (const zone of zones) {
    const out = execFileSync(
      process.execPath,
      [...process.execArgv, process.argv[1]],
      { env: { ...process.env, TZ: zone, IST_CHILD: '1' }, encoding: 'utf8' },
    ).trim()
    const list = seen.get(out) || []
    list.push(zone)
    seen.set(out, list)
  }
  for (const [value, zoneList] of seen) console.log(`   ${zoneList.join(', ')}\n     -> ${value}`)
  check(seen.size === 1, `all ${zones.length} timezones agree (${seen.size} distinct result${seen.size === 1 ? '' : 's'})`)

  console.log('\n2) The primitives are actually right, not merely consistent')
  check(getIndiaYmd(PIVOT) === '2026-08-27',
    `19:00Z on the 26th is the IST 27th (got ${getIndiaYmd(PIVOT)})`)
  const bounds = indiaDayBounds('2026-08-26')
  // 26 Aug 00:00:00 IST = 25 Aug 18:30 UTC; 26 Aug 23:59:59.999 IST = 26 Aug 18:29:59.999 UTC.
  check(bounds.start?.toISOString() === '2026-08-25T18:30:00.000Z',
    `day starts at 00:00 IST (got ${bounds.start?.toISOString()})`)
  check(bounds.end?.toISOString() === '2026-08-26T18:29:59.999Z',
    `day ends at 23:59:59.999 IST (got ${bounds.end?.toISOString()})`)
  check(indiaDayBounds('').start === null, 'an empty date yields no predicate rather than epoch')
  check(indiaDayBounds('not-a-date').start === null, 'an unparseable date yields no predicate')

  // ── B. No unanchored date handling survives in the section ─────────────────────────────────
  console.log('\n3) No file in the section formats a date without an explicit IST anchor')
  const BANNED: { pattern: RegExp; label: string }[] = [
    { pattern: /toLocaleDateString\s*\(/g, label: 'toLocaleDateString' },
    { pattern: /toLocaleTimeString\s*\(/g, label: 'toLocaleTimeString' },
    { pattern: /toDateString\s*\(/g, label: 'toDateString' },
  ]

  for (const file of SECTION_FILES) {
    let source: string
    try {
      source = stripComments(readFileSync(file, 'utf8'))
    } catch {
      fail(`${file} could not be read — the guard cannot pass vacuously`)
      continue
    }

    const offences: string[] = []
    for (const line of source.split('\n')) {
      for (const { pattern, label } of BANNED) {
        pattern.lastIndex = 0
        if (!pattern.test(line)) continue
        // An explicit zone on the same line (directly, or spread from an `options` object that
        // carries it) is the whole point — those are correct and stay.
        if (/timeZone/.test(line) || /\.\.\.options/.test(line)) continue
        offences.push(`${label}: ${line.trim().slice(0, 90)}`)
      }
    }
    // toLocaleString is separate: it is also the idiom for CURRENCY, which is not our business.
    for (const line of source.split('\n')) {
      if (!/toLocaleString\s*\(/.test(line)) continue
      if (/timeZone/.test(line) || /\.\.\.options/.test(line)) continue
      if (/Number\(|amount|Amount|price|Price|₹|Rs/.test(line)) continue // currency, not a date
      offences.push(`toLocaleString: ${line.trim().slice(0, 90)}`)
    }

    if (offences.length) {
      fail(`${file} has ${offences.length} unanchored date call(s)`)
      for (const o of offences) console.log(`         ${o}`)
    } else {
      ok(`${file}`)
    }
  }

  console.log('\n4) The server never puts a raw UTC ISO string into human-readable prose')
  const leadFollowups = stripComments(readFileSync('lib/kia/lead-followups.ts', 'utf8'))
  const prose = leadFollowups.split('\n').filter((line) =>
    /toISOString\(\)/.test(line) && /(description:|activityBits\.push|notes:)/.test(line))
  check(prose.length === 0,
    `no ISO timestamps in activity/notes prose (${prose.length} found)`)
  for (const line of prose) console.log(`         ${line.trim().slice(0, 100)}`)

  console.log('\n5) The date filter uses IST day boundaries, not the server clock')
  check(!/setHours\(\s*23,\s*59,\s*59/.test(leadFollowups),
    'no setHours(23,59,59) day-end — that applies the SERVER zone, which is UTC in production')
  check(!/setHours\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(leadFollowups),
    'no setHours(0,0,0,0) day-start')
  check(/indiaDayBounds/.test(leadFollowups), 'indiaDayBounds is what builds the range')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
