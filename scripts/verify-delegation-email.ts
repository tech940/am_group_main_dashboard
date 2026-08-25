/**
 * Proves the delegator ends up on task emails — WITHOUT SENDING ANY.
 *
 *   npm run verify:delegation-email
 *
 * ⚠️ This tests buildTaskEmailRecipients, the pure seam. Do NOT "verify" by calling
 * sendTaskAssignedEmail with sample data: sendEmail is a real SMTP send and an ES module export
 * cannot be stubbed at runtime, so such a script mails real people.
 */
import { buildTaskEmailRecipients } from '../lib/delegation/emails'

let fail = 0
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

console.log('\n1) The delegator is put on the thread')
{
  const r = buildTaskEmailRecipients({ toEmail: 'ramesh@amkia.in', assignerEmail: 'aryan@jammuautomart.com' })
  ok('delegator is Cc’d', r.cc.includes('aryan@jammuautomart.com'), r.cc.join(', '))
  ok('delegator is the Reply-To', r.assignerEmail === 'aryan@jammuautomart.com')
}

console.log('\n2) Self-delegation does not double-send')
{
  const r = buildTaskEmailRecipients({ toEmail: 'aryan@jammuautomart.com', assignerEmail: 'aryan@jammuautomart.com' })
  ok('recipient is not Cc’d back to themselves', r.cc.length === 0, `cc=[${r.cc.join(', ')}]`)
  ok('Reply-To is still set', r.assignerEmail === 'aryan@jammuautomart.com')
}

console.log('\n3) Case and duplicates')
{
  const r = buildTaskEmailRecipients({ toEmail: 'Ramesh@AMKia.in', assignerEmail: 'Aryan@JammuAutoMart.com' })
  ok('self-check is case-insensitive', r.cc.length === 1)
  const d = buildTaskEmailRecipients({
    toEmail: 'ramesh@amkia.in',
    assignerEmail: 'aryan@jammuautomart.com',
    cc: ['aryan@jammuautomart.com', 'ARYAN@jammuautomart.com', 'ea@amkia.in'],
  })
  ok('duplicate Cc entries collapse', d.cc.length === 2, d.cc.join(', '))
  ok('an explicitly passed Cc survives', d.cc.includes('ea@amkia.in'))
}

console.log('\n4) A caller with no delegator address still works (old behaviour)')
{
  const r = buildTaskEmailRecipients({ toEmail: 'ramesh@amkia.in' })
  ok('no Cc', r.cc.length === 0)
  ok('no Reply-To, so the mail simply replies to the sender as before', r.assignerEmail === '')
}

console.log('\n5) Junk is dropped rather than mailed')
{
  const r = buildTaskEmailRecipients({ toEmail: 'ramesh@amkia.in', assignerEmail: '   ', cc: ['', '  '] })
  ok('blank assigner and blank Cc entries vanish', r.cc.length === 0 && r.assignerEmail === '')
}

console.log(fail === 0 ? '\n=== ALL CHECKS PASSED (no email sent) ===\n' : `\n=== ${fail} FAILURE(S) ===\n`)
process.exit(fail === 0 ? 0 : 1)
