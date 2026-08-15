import { execSync } from 'node:child_process'

/**
 * Rigorous proof that the a11y pass changed PRESENTATION ONLY.
 *
 * Method: pair each removed line with its added counterpart inside a hunk, then STRIP the edits we
 * authorised (aria-*, role, scope, sr-only captions, motion-reduce, Tailwind text-colour tokens).
 * If the two lines are then IDENTICAL, the only difference was an authorised a11y edit. Anything
 * that still differs is a real code change and gets printed in full for review.
 */

const diff = execSync('git diff -U0 -- features/kia/', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** Strip `attr={...}` with BALANCED braces (aria-labels routinely contain `${...}` templates). */
function stripBracedAttrs(s, names) {
  for (const name of names) {
    let i
    while ((i = s.search(new RegExp(`\\s${name}=\\{`))) !== -1) {
      const open = s.indexOf('{', i)
      let depth = 0, j = open
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++
        else if (s[j] === '}') { depth--; if (depth === 0) break }
      }
      if (depth !== 0) break // unbalanced (hunk truncated) — stop rather than mangle
      s = s.slice(0, i) + s.slice(j + 1)
    }
  }
  return s
}

const normalise = (raw) => stripBracedAttrs(raw, ['aria-[a-zA-Z-]+', 'role', 'scope'])
  .replace(/\s+aria-[a-zA-Z-]+=("[^"]*"|'[^']*')/g, '')
  .replace(/\s+role=("[^"]*"|'[^']*')/g, '')
  .replace(/\s+scope=("[^"]*"|'[^']*')/g, '')
  .replace(/text-slate-\d{2,3}/g, 'TEXTCOLOR')
  .replace(/placeholder-slate-\d{2,3}/g, 'TEXTCOLOR')
  .replace(/\s*motion-reduce:[a-z-]+/g, '')
  .replace(/\s+/g, ' ')
  .trim()

// Lines that are pure additions of a11y scaffolding are inherently safe.
const PURE_ADDITION_OK = /^\s*(<caption\b|<\/caption>|aria-[a-zA-Z-]+=|role=|scope=)/

const lines = diff.split('\n')
let file = ''
const hunks = []
let cur = null

for (const line of lines) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue }
  if (line.startsWith('@@')) { if (cur) hunks.push(cur); cur = { file, minus: [], plus: [] }; continue }
  if (!cur) continue
  if (line.startsWith('-') && !line.startsWith('---')) cur.minus.push(line.slice(1))
  else if (line.startsWith('+') && !line.startsWith('+++')) cur.plus.push(line.slice(1))
}
if (cur) hunks.push(cur)

const violations = []
let safeHunks = 0, addedOnly = 0

for (const h of hunks) {
  // Pure additions (no removals) — safe if every added line is a11y scaffolding or JSX structure.
  if (h.minus.length === 0) {
    const risky = h.plus.filter((l) => l.trim() && !PURE_ADDITION_OK.test(l) && !/^\s*(\/\/|\{\/\*|\*|--)/.test(l.trim()))
    if (risky.length === 0) { addedOnly++; continue }
    // an addition that isn't obviously a11y — compare as a block below
  }
  // Join the hunk into ONE string before normalising: adding an attribute often reformats a
  // single-line JSX element across several lines, which is not a code change.
  const before = normalise(h.minus.join(' '))
  const after = normalise(h.plus.join(' '))
  if (before === after) { safeHunks++; continue }

  // Allow the case where `after` is `before` plus whole new a11y-only lines.
  const beforeSet = new Set(h.minus.map(normalise).filter(Boolean))
  const extra = h.plus.map(normalise).filter(Boolean).filter((l) => !beforeSet.has(l))
  const missing = h.minus.map(normalise).filter(Boolean).filter((l) => !new Set(h.plus.map(normalise)).has(l))
  if (missing.length === 0 && extra.every((l) => PURE_ADDITION_OK.test(l) || /^<caption/.test(l))) { safeHunks++; continue }

  violations.push({ file: h.file, before: h.minus, after: h.plus })
}

console.log(`hunks: ${hunks.length} · a11y-only additions: ${addedOnly} · identical-after-normalising: ${safeHunks} · REAL CODE CHANGES: ${violations.length}\n`)
if (!violations.length) {
  console.log('✅ PROVEN: every hunk is either a pure a11y addition or identical once aria/role/scope/')
  console.log('   caption/motion-reduce/text-colour edits are normalised away. No calculation touched.')
} else {
  console.log('⚠ hunks that changed something beyond a11y — review each:\n')
  for (const v of violations.slice(0, 25)) {
    console.log(`--- ${v.file}`)
    v.before.forEach((l) => console.log('  - ' + l.trim().slice(0, 160)))
    v.after.forEach((l) => console.log('  + ' + l.trim().slice(0, 160)))
    console.log()
  }
  if (violations.length > 25) console.log(`… +${violations.length - 25} more`)
}
