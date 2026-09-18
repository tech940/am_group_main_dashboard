/**
 * Checks for the public /sell-used-car lead form (npm run verify:sell-used-car).
 *
 * The database part runs inside ONE transaction that is always rolled back (tsconfig.hp-flow.json maps @/lib/db to
 * the rollback shim), so no lead survives. No mail is sent: the alert is exercised with a stub `send`, and the
 * route is only driven down paths that return before the alert is queued.
 */
import { readFileSync, existsSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import { EvaluationSubmitSchema } from '../lib/evaluation/types'
import { addDays, currentIndiaYear, indiaToday, normaliseMobile, modelsForBrand, PRIMARY_BRANDS } from '../lib/evaluation/catalog'
import {
  EVALUATION_SOURCE,
  EvaluationError,
  createVehicleEvaluation,
  evaluationAlertRecipients,
  evaluationReference,
  sendEvaluationAlert,
} from '../lib/evaluation/server'
import { vehicleEvaluationAlertTemplate } from '../lib/email/templates/vehicle-evaluation-alert'
import { POST } from '../app/api/evaluations/submit/route'
import { GRANT_ONLY_SECTIONS, PERMISSIONS, SECTION_ROUTES } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot, resolveEffectiveSnapshotV2 } from '../lib/permissions/service'
import { periodWindow, parseLeadFilters } from '../lib/evaluation/read'

class Rollback extends Error {}
let failures = 0
let passes = 0
function assert(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passes += 1
    console.log(`  [PASS] ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}

const today = indiaToday()
// A number no real customer will have used in the last ten minutes.
const TEST_MOBILE = '6000000417'
const sample = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Verify Lead',
  mobile: TEST_MOBILE,
  brand: 'Hyundai',
  model: 'Creta',
  manufacturingYear: 2019,
  kilometres: 45000,
  evaluationDate: addDays(today, 2),
  interestedInNewCar: true,
  utmSource: 'verify',
  utmCampaign: 'sell-used-car-check',
  ...overrides,
})
const parses = (overrides: Record<string, unknown>) => EvaluationSubmitSchema.safeParse(sample(overrides)).success

async function main() {
  console.log('\n1. Validation (the whole contract of a public route)')
  assert('a complete lead passes', parses({}))
  for (const [raw, expected] of [
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['098765 43210', '9876543210'],
    ['91-98765-43210', '9876543210'],
  ] as const) {
    assert(`mobile "${raw}" normalises to ${expected}`, normaliseMobile(raw) === expected)
  }
  assert('mobile 12345 is refused', !parses({ mobile: '12345' }))
  assert('mobile starting 5 is refused', !parses({ mobile: '5876543210' }))
  assert('next year is refused', !parses({ manufacturingYear: currentIndiaYear() + 1 }))
  assert('this year is accepted', parses({ manufacturingYear: currentIndiaYear() }))
  assert('before 1995 is refused', !parses({ manufacturingYear: 1990 }))
  assert('yesterday is refused', !parses({ evaluationDate: addDays(today, -1) }))
  assert('today is accepted', parses({ evaluationDate: today }))
  assert('60 days out is accepted', parses({ evaluationDate: addDays(today, 60) }))
  assert('61 days out is refused', !parses({ evaluationDate: addDays(today, 61) }))
  assert('a malformed date is refused', !parses({ evaluationDate: '20-09-2026' }))
  assert('negative kilometres refused', !parses({ kilometres: -1 }))
  assert('10 lakh kilometres refused', !parses({ kilometres: 1_000_000 }))
  assert('missing kilometres refused', !parses({ kilometres: undefined }))
  assert('missing new-car answer refused', !parses({ interestedInNewCar: undefined }))
  assert('a 41-character brand refused', !parses({ brand: 'x'.repeat(41) }))
  assert('a name of digits only refused', !parses({ customerName: '12345' }))
  const emojiName = EvaluationSubmitSchema.safeParse(sample({ customerName: '🚗🚗' }))
  assert('an emoji-only name is asked for in letters', !emojiName.success && emojiName.error.issues[0]?.message === 'Use letters for your name.')
  assert('a correction must name a real id', !parses({ correctionOf: 'not-an-id' }))
  assert('a correction id is accepted', parses({ correctionOf: '3f9a1c2b-0000-4000-8000-000000000000' }))
  assert('no correction becomes null', EvaluationSubmitSchema.parse(sample({ correctionOf: '' })).correctionOf === null)
  const tidied = EvaluationSubmitSchema.parse(sample({ customerName: 'Rahul\r\nBcc: x@y.z', model: '  Grand   i10 ' }))
  assert('line breaks are stripped from the name', tidied.customerName === 'Rahul Bcc: x@y.z', tidied.customerName)
  assert('whitespace is collapsed', tidied.model === 'Grand i10', tidied.model)
  const tag = EvaluationSubmitSchema.parse(sample({ utmCampaign: 'c'.repeat(300) }))
  assert('campaign tags are capped at 100 characters', tag.utmCampaign?.length === 100)
  assert('missing campaign tags become null', EvaluationSubmitSchema.parse(sample({ utmSource: undefined })).utmSource === null)

  console.log('\n2. Catalogue')
  assert('Hyundai leads the brand tiles', PRIMARY_BRANDS[0]?.name === 'Hyundai')
  assert('Hyundai has Creta and the older Santro', modelsForBrand('Hyundai').includes('Creta') && modelsForBrand('Hyundai').includes('Santro'))
  const dupes = PRIMARY_BRANDS.flatMap((b) => b.models.filter((m, i) => b.models.indexOf(m) !== i).map((m) => `${b.name} ${m}`))
  assert('no brand lists a model twice', dupes.length === 0, dupes.join(', '))

  console.log('\n3. Staff alert (stub mailer — nothing leaves the machine)')
  const hostile = EvaluationSubmitSchema.parse(sample({ customerName: '<img src=x onerror=alert(1)> "Raj"', model: '<a href="http://evil">Creta</a>' }))
  const mail = vehicleEvaluationAlertTemplate({
    customerName: hostile.customerName,
    mobile: hostile.mobile,
    brand: hostile.brand,
    model: hostile.model,
    manufacturingYear: hostile.manufacturingYear,
    kilometres: '45,000',
    evaluationDate: 'Sunday, 20 September',
    interestedInNewCar: true,
    submittedAt: '18 Sept, 5:30 pm',
    reference: 'ABC123',
    correctsReference: '<b>X</b>',
  })
  assert('the reference is in the subject and body', mail.subject.includes('ABC123') && mail.html.includes('ABC123') && mail.text.includes('ABC123'))
  assert('the corrected reference is escaped too', mail.html.includes('&lt;b&gt;X&lt;/b&gt;'))
  assert('customer markup is escaped in the mail body', !mail.html.includes('<img src=x') && mail.html.includes('&lt;img src=x'))
  assert('customer links are escaped in the mail body', !mail.html.includes('<a href="http://evil">'))
  assert('no price appears in the alert', !/estimated|lakh|₹/i.test(mail.html + mail.text))
  assert('the subject is one line', !/[\r\n]/.test(mail.subject))

  const sent: Array<{ to: unknown; subject: string }> = []
  const savedEnv = process.env.EVALUATION_ALERT_RECIPIENTS
  delete process.env.EVALUATION_ALERT_RECIPIENTS
  await sendEvaluationAlert(EvaluationSubmitSchema.parse(sample()), '3f9a1c2b-0000-4000-8000-000000000000', async (options) => {
    sent.push({ to: options.to, subject: options.subject })
  })
  assert('the stubbed alert carries the reference', sent[0]?.subject.includes('3F9A1C') === true, sent[0]?.subject)
  assert('the alert goes to the desk by default', JSON.stringify(sent[0]?.to) === JSON.stringify(['tech@amgroupind.com', 'aryan@amgroupind.com']))
  process.env.EVALUATION_ALERT_RECIPIENTS = 'desk@amgroupind.com, not-an-address , md@amgroupind.com'
  assert('EVALUATION_ALERT_RECIPIENTS overrides it, dropping junk', JSON.stringify(evaluationAlertRecipients()) === JSON.stringify(['desk@amgroupind.com', 'md@amgroupind.com']))
  if (savedEnv === undefined) delete process.env.EVALUATION_ALERT_RECIPIENTS
  else process.env.EVALUATION_ALERT_RECIPIENTS = savedEnv

  console.log('\n4. Route guards (paths that return before any insert or mail)')
  const post = (body: string, headers: Record<string, string> = {}) =>
    POST(new Request('http://localhost/api/evaluations/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }))
  const [before] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM public.vehicle_evaluations`)) as unknown as Array<{ n: number }>
  const bot = await post(JSON.stringify({ ...sample(), website: 'http://spam.example' }))
  assert('a filled honeypot gets a normal-looking 201', bot.status === 201 && (await bot.json()).ok === true)
  const big = await post(JSON.stringify({ ...sample(), customerName: 'x'.repeat(9000) }))
  assert('a body over 8 KB is refused unread (413)', big.status === 413)
  const junk = await post('{not json')
  assert('unreadable JSON is a 400', junk.status === 400)
  const invalid = await post(JSON.stringify(sample({ mobile: '123' })))
  const invalidBody = await invalid.json()
  assert('an invalid lead is a 400 naming the field', invalid.status === 400 && Boolean(invalidBody.fieldErrors?.mobile), JSON.stringify(invalidBody))
  const [afterRoute] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM public.vehicle_evaluations`)) as unknown as Array<{ n: number }>
  assert('none of those stored a row', afterRoute.n === before.n)

  console.log('\n5. Storage, double-submit and flood (rolled back)')
  try {
    await realDb.transaction(async (tx) => {
      useOuterTransaction(tx as unknown as typeof realDb)
      const input = EvaluationSubmitSchema.parse(sample())
      const first = await createVehicleEvaluation(input)
      assert('a lead is stored', Boolean(first.id) && first.duplicate === false)
      const [row] = (await tx.execute(sql`
        SELECT customer_name, mobile, brand, model, manufacturing_year, mileage_exact, evaluation_date,
               interested_in_new_car, source, utm_source, utm_campaign, status, estimated_price_min, uploaded_photos
        FROM public.vehicle_evaluations WHERE id = ${first.id}`)) as unknown as Array<Record<string, unknown>>
      assert('it keeps every answer', row?.mobile === TEST_MOBILE && row?.brand === 'Hyundai' && row?.model === 'Creta'
        && row?.manufacturing_year === 2019 && row?.mileage_exact === 45000 && row?.evaluation_date === input.evaluationDate
        && row?.interested_in_new_car === true, JSON.stringify(row))
      assert('source and campaign are recorded', row?.source === EVALUATION_SOURCE && row?.utm_source === 'verify' && row?.utm_campaign === 'sell-used-car-check')
      assert('status starts at new, with no invented price', row?.status === 'new' && row?.estimated_price_min === null)

      const again = await createVehicleEvaluation(input)
      assert('the same car and number again returns the first lead', again.duplicate && again.id === first.id)
      const other = await createVehicleEvaluation(EvaluationSubmitSchema.parse(sample({ model: 'Venue' })))
      assert('a second car from the same number is its own lead', !other.duplicate && other.id !== first.id)

      const fixed = await createVehicleEvaluation(EvaluationSubmitSchema.parse(sample({ mobile: '6000000420', correctionOf: first.id })))
      const [fixedRow] = (await tx.execute(sql`SELECT notes FROM public.vehicle_evaluations WHERE id = ${fixed.id}`)) as unknown as Array<{ notes: string | null }>
      const [firstAfter] = (await tx.execute(sql`SELECT notes, status, mobile FROM public.vehicle_evaluations WHERE id = ${first.id}`)) as unknown as Array<{ notes: string | null; status: string; mobile: string }>
      assert('a corrected number is a new lead noting the one it replaces', !fixed.duplicate && fixedRow?.notes?.includes(evaluationReference(first.id)) === true, fixedRow?.notes ?? 'null')
      assert('the public route never touches the lead it corrects', firstAfter?.notes === null && firstAfter?.status === 'new' && firstAfter?.mobile === TEST_MOBILE)

      await tx.execute(sql`
        INSERT INTO public.vehicle_evaluations (customer_name, mobile, brand, model, manufacturing_year, source)
        SELECT 'Flood', '6000000418', 'Hyundai', 'i20', 2020, ${EVALUATION_SOURCE}
        FROM generate_series(1, 300)`)
      let flooded: unknown = null
      try {
        await createVehicleEvaluation(EvaluationSubmitSchema.parse(sample({ mobile: '6000000419' })))
      } catch (error) {
        flooded = error
      }
      assert('past 300 leads in ten minutes the form answers 429', flooded instanceof EvaluationError && flooded.status === 429)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  } finally {
    useOuterTransaction(null)
  }
  const [afterAll] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM public.vehicle_evaluations`)) as unknown as Array<{ n: number }>
  assert('nothing survived the rollback', afterAll.n === before.n, `${before.n} → ${afterAll.n}`)

  console.log('\n6. One URL, no photo upload')
  assert('/sell-used-car exists', existsSync('app/sell-used-car/page.tsx'))
  assert('/evaluation copy is gone', !existsSync('app/evaluation/page.tsx'))
  assert('/sell-car copy is gone', !existsSync('app/sell-car/page.tsx'))
  assert('the unauthenticated photo-upload route is gone', !existsSync('app/api/evaluations/upload-photos/route.ts'))
  const middleware = readFileSync('lib/supabase/middleware.ts', 'utf8')
  const protectedLine = middleware.match(/const protectedPaths = \[([^\]]*)\]/)?.[1] ?? ''
  assert('/sell-used-car is not behind the login', protectedLine.length > 0 && !/sell-used-car|'\/sell/.test(protectedLine))
  const form = readFileSync('app/sell-used-car/sell-car-form.tsx', 'utf8')
  assert('the form posts to the hardened route', form.includes("'/api/evaluations/submit'"))
  const page = readFileSync('app/sell-used-car/page.tsx', 'utf8')
  assert('the showroom photo is served from our own domain', page.includes('/assets/am-group-showroom.webp') && !page.includes('amgroupind.com/wp-content') && existsSync('public/assets/am-group-showroom.webp'))
  assert('the photo carries no caption', !page.includes('<figcaption'))
  assert('the form never shows a computed price', !/calculateEstimatedValuation|lakh/i.test(form))

  console.log('\n7. Car Evaluation Leads — who can open the dashboard page')
  const KEY = 'car_evaluations.view'
  const ALL_FALSE = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>
  assert('the section is registered with a route', SECTION_ROUTES.car_evaluations?.href === '/car-evaluations')
  assert('it is grant-only', GRANT_ONLY_SECTIONS.has('car_evaluations'))
  for (const role of ['md', 'developer'] as const) {
    assert(`${role} sees it`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, role, 'all').effective[KEY] === true)
  }
  // admin and hr are family 'super' (every key in their tier bundle); ceo/ea/eba are global-access roles.
  for (const role of ['admin', 'hr', 'ceo', 'ea', 'eba', 'general_manager', 'sales_manager', 'accounts'] as const) {
    assert(`${role} does NOT see it by default (tiered resolver)`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, role, 'all').effective[KEY] !== true)
    assert(`${role} does NOT see it by default (v1 resolver)`, resolveEffectiveSnapshot(ALL_FALSE, {}, role, 'all').effective[KEY] !== true)
  }
  assert('an Access-Map tick opens it (admin)', resolveEffectiveSnapshotV2(ALL_FALSE, { [KEY]: true }, 'admin', 'all').effective[KEY] === true)
  assert('an Access-Map tick opens it (sales_manager)', resolveEffectiveSnapshotV2(ALL_FALSE, { [KEY]: true }, 'sales_manager', 'kia').effective[KEY] === true)
  const pageSrc = readFileSync('app/car-evaluations/page.tsx', 'utf8')
  const apiSrc = readFileSync('app/api/car-evaluations/route.ts', 'utf8')
  assert('the page and the API check the same key', pageSrc.includes(`'${KEY}'`) && apiSrc.includes(`'${KEY}'`))

  console.log('\n8. Car Evaluation Leads — filters')
  assert('this month runs from the 1st to tomorrow', JSON.stringify(periodWindow('month', '2026-09-18')) === JSON.stringify({ from: '2026-09-01', to: '2026-09-19' }))
  assert('last month is the whole of August', JSON.stringify(periodWindow('last_month', '2026-09-18')) === JSON.stringify({ from: '2026-08-01', to: '2026-09-01' }))
  assert('last month from January is December', JSON.stringify(periodWindow('last_month', '2026-01-05')) === JSON.stringify({ from: '2025-12-01', to: '2026-01-01' }))
  assert('7 days includes today', JSON.stringify(periodWindow('7d', '2026-09-18')) === JSON.stringify({ from: '2026-09-12', to: '2026-09-19' }))
  const parsed = parseLeadFilters(new URLSearchParams('period=bogus&page=-4&q=%0Aab'))
  assert('junk filters fall back safely', parsed.period === 'month' && parsed.page === 1 && parsed.q === 'ab', JSON.stringify(parsed))

  console.log(`\n${passes} passed, ${failures} failed`)
  await testClient.end()
  process.exit(failures ? 1 : 0)
}

main().catch(async (error) => {
  console.error(error)
  await testClient.end().catch(() => {})
  process.exit(1)
})
