/**
 * AM Hyundai / AM Platinum discount approvals (discount_approvals) — the access and injection fixes of
 * 2026-09-19, held against live data. Run: npm run verify:discount-approvals
 *
 * Every write runs inside ONE outer transaction that is always rolled back (scripts/_shims/hp-test-db.ts),
 * and the logged-in user is set per check (scripts/_shims/test-app-user.ts) using REAL accounts, so the
 * real permission resolver decides. Nothing is left behind; no email is involved.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import { setTestAppUser, type AppUser } from './_shims/test-app-user'

// Permission lookups must not write test users' snapshots into the shared Redis.
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

let failures = 0
function assert(name: string, ok: boolean, detail?: string) {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}
class Rollback extends Error {}

type Row = Record<string, unknown>
const rows = async (q: ReturnType<typeof sql>) => (await realDb.execute(q)) as unknown as Row[]

async function userWhere(where: ReturnType<typeof sql>): Promise<AppUser | null> {
  const [u] = await rows(sql`SELECT * FROM users WHERE is_active AND ${where} ORDER BY created_at LIMIT 1`)
  if (!u) return null
  return {
    id: String(u.id), supabaseId: String(u.supabase_id ?? ''), email: String(u.email ?? ''), fullName: String(u.full_name ?? ''),
    role: u.role as AppUser['role'], brand: (u.brand as string | null) ?? null, dealers: (u.dealers as string | null) ?? null,
    department: (u.department as string | null) ?? null, isActive: true,
  }
}

async function main() {
  const { GET: list, POST: submit, PATCH: act } = await import('../app/api/discount-approvals/route')
  const { GET: lookup } = await import('../app/api/discount-approvals/lookup/route')
  const { canAccessDiscountBranch, discountBranchesFor } = await import('../lib/discount-approvals/access')
  const json = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => null)) as unknown })

  const md = await userWhere(sql`role = 'md' AND brand = 'all'`)
  const hyundaiGsm = await userWhere(sql`role = 'general_manager' AND lower(brand) = 'hyundai'`)
  const platinumGsm = await userWhere(sql`role = 'general_manager' AND lower(brand) = 'platinum'`)
  const kiaGm = await userWhere(sql`role = 'general_manager' AND lower(brand) = 'kia'`)
  const kiaCre = await userWhere(sql`role = 'cre' AND lower(brand) = 'kia'`)
  if (!md || !hyundaiGsm || !platinumGsm || !kiaGm) throw new Error('expected MD, Hyundai GSM, Platinum GSM and KIA GM accounts to exist')
  // Access-Map brand grants are honoured (an owner decision, not a default): a GSM ticked for the other
  // brand may see it. So "only Hyundai" is tested on a Hyundai GM who holds NO Platinum grant, if one exists.
  let hyundaiOnly: AppUser | null = null
  for (const u of (await rows(sql`SELECT id FROM users WHERE is_active AND role = 'general_manager' AND lower(brand) = 'hyundai' ORDER BY created_at`))) {
    const cand = await userWhere(sql`id = ${u.id}`)
    if (cand && !(await canAccessDiscountBranch(cand, 'platinum'))) { hyundaiOnly = cand; break }
  }

  console.log('\n1. Customer lookup — public tier vs approver tier')
  const [cust] = await rows(sql`
    SELECT b.customer_id, b.contact_number
    FROM hyundai_booking_report b
    WHERE COALESCE(b.customer_id, '') <> '' AND COALESCE(b.contact_number, '') <> '' AND COALESCE(b.pan_number, '') <> ''
    LIMIT 1`)
  assert('a Hyundai customer with a PAN on file exists to test with', Boolean(cust))
  if (cust) {
    const url = (vin: string, branch = 'hyundai') => new Request(`http://x/api/discount-approvals/lookup?branch=${encodeURIComponent(branch)}&vin=${encodeURIComponent(vin)}`)
    setTestAppUser(null)
    const anon = await json(await lookup(url(String(cust.customer_id))))
    const anonText = JSON.stringify(anon.body)
    assert('anonymous lookup by Customer ID still prefills the form', anon.status === 200 && typeof (anon.body as Row)?.customerName === 'string', anonText.slice(0, 200))
    assert('anonymous lookup returns no raw DMS rows', !anonText.includes('rawData'))
    assert('anonymous lookup returns no PAN, phone or address', !/pan|contact|address|pin_no|gst/i.test(anonText) && !anonText.includes(String(cust.contact_number)))
    const byPhone = await json(await lookup(url(String(cust.contact_number))))
    assert('anonymous lookup cannot search by phone number', byPhone.status === 404, String(byPhone.status))
    const injected = await json(await lookup(url(String(cust.customer_id), "hyundai' OR '1'='1")))
    assert('an injected branch is refused', injected.status === 400)

    setTestAppUser(hyundaiGsm)
    const full = await json(await lookup(url(String(cust.customer_id))))
    const raw = (full.body as Row)?.rawData as Row | undefined
    assert('the Hyundai GSM gets the full rows for the drawer', full.status === 200 && Boolean(raw && Object.keys(raw).length > 5))
    assert('…but never the PAN or GST number', Boolean(raw) && !('pan_number' in raw!) && !('pan_no' in raw!) && !('customer_gst_no' in raw!) && !JSON.stringify(full.body).toLowerCase().includes('pan_'))
    const approverPhone = await json(await lookup(url(String(cust.contact_number))))
    assert('an approver may still search by phone', approverPhone.status === 200)
    setTestAppUser(kiaCre)
    const cre = await json(await lookup(url(String(cust.customer_id))))
    assert('a logged-in user without the section gets only the public tier', cre.status === 200 && !JSON.stringify(cre.body).includes('rawData'))
  }

  console.log('\n2. Public submit — no SQL built from input (rolled back)')
  const [{ n: before }] = await rows(sql`SELECT count(*)::int AS n FROM discount_approvals`) as Array<{ n: number }>
  const [{ n: empBefore }] = await rows(sql`SELECT count(*)::int AS n FROM am_group_discount_approvals_employees`) as Array<{ n: number }>
  const body = (over: Row = {}) => new NextRequest('http://x/api/discount-approvals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requesterName: 'Verify Script Exec', branch: 'hyundai', customerId: 'C-VERIFY-0001', customerName: 'Verify',
      model: 'Creta', variant: 'SX', color: 'White', discountAmount: 5000, accessoriesAmount: 0, tlManager: 'Verify Script TL',
      teleDate: '2026-09-19', insuranceType: 'In House', reference: 'verify-discount-approvals', ...over,
    }),
  })
  setTestAppUser(null)
  const inj = await json(await submit(body({ branch: "hyundai'); DELETE FROM am_group_discount_approvals_employees; --" })))
  assert('the injection payload in branch is a 400', inj.status === 400)
  const bad = await json(await submit(body({ discountAmount: 'abc' })))
  assert('a non-numeric amount is a 400', bad.status === 400)
  try {
    await realDb.transaction(async (tx) => {
      useOuterTransaction(tx as unknown as typeof realDb)
      const ok = await json(await submit(body()))
      assert('a valid public request is stored at PENDING_GSM', ok.status === 200 && ((ok.body as Row)?.data as Row)?.status === 'PENDING_GSM', JSON.stringify(ok.body).slice(0, 200))
      const learned = (await tx.execute(sql`SELECT role FROM am_group_discount_approvals_employees WHERE name IN ('Verify Script Exec', 'Verify Script TL') ORDER BY role`)) as unknown as Row[]
      assert('the executive and team leader are learned for the pickers', learned.length === 2)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  } finally {
    useOuterTransaction(null)
  }
  const [{ n: after }] = await rows(sql`SELECT count(*)::int AS n FROM discount_approvals`) as Array<{ n: number }>
  const [{ n: empAfter }] = await rows(sql`SELECT count(*)::int AS n FROM am_group_discount_approvals_employees`) as Array<{ n: number }>
  assert('nothing survived the rollback', after === before && empAfter === empBefore, `${before}->${after}, ${empBefore}->${empAfter}`)

  console.log('\n3. Who can read the list')
  const counts = Object.fromEntries((await rows(sql`SELECT lower(branch) AS b, count(*)::int AS n FROM discount_approvals GROUP BY 1`)).map((r) => [r.b, r.n]))
  const listAs = async (u: AppUser | null) => { setTestAppUser(u); return json(await list(new NextRequest('http://x/api/discount-approvals'))) }
  const brandsOf = (b: unknown) => Array.isArray(b) ? [...new Set(b.map((r) => String((r as Row).branch).toLowerCase()))].sort().join(',') : 'n/a'
  const anonList = await listAs(null)
  assert('anonymous: 401', anonList.status === 401)
  if (kiaCre) assert('a KIA CRE: 403', (await listAs(kiaCre)).status === 403)
  const mdList = await listAs(md)
  assert('MD sees both brands, every row', mdList.status === 200 && (mdList.body as Row[]).length === (counts.hyundai ?? 0) + (counts.platinum ?? 0), `${(mdList.body as Row[])?.length}`)
  for (const [label, u] of [['the Hyundai GSM', hyundaiGsm], ['the Platinum GSM', platinumGsm]] as const) {
    const expected = (await discountBranchesFor(u)).slice().sort()
    const got = await listAs(u)
    const rowsExpected = expected.reduce((n, b) => n + (counts[b] ?? 0), 0)
    assert(`${label} (${u.fullName.split(/\s/)[0]}) sees exactly the brands he may (${expected.join('+')})`, got.status === 200 && brandsOf(got.body) === expected.join(',') && (got.body as Row[]).length === rowsExpected)
  }
  if (hyundaiOnly) {
    const got = await listAs(hyundaiOnly)
    assert('a Hyundai GM with no Platinum grant sees only Hyundai', got.status === 200 && brandsOf(got.body) === 'hyundai' && (got.body as Row[]).length === counts.hyundai)
  } else {
    console.log('  (skipped: every Hyundai GM holds a Platinum grant)')
  }
  assert('a KIA general manager sees none (403)', (await listAs(kiaGm)).status === 403)

  console.log('\n4. Who can act (rolled back)')
  const [pending] = await rows(sql`SELECT id, status FROM discount_approvals WHERE lower(branch) = 'hyundai' AND status IN ('PENDING_GSM', 'PENDING_SM', 'PENDING_VP') ORDER BY created_at LIMIT 1`)
  assert('a Hyundai request waiting at stage 1 exists to test with', Boolean(pending))
  if (pending) {
    const patch = () => new NextRequest('http://x/api/discount-approvals', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pending.id, status: 'APPROVED', remarks: 'verify-discount-approvals' }),
    })
    try {
      await realDb.transaction(async (tx) => {
        useOuterTransaction(tx as unknown as typeof realDb)
        setTestAppUser(kiaGm)
        assert('a KIA general manager can no longer clear Hyundai stage 1', (await json(await act(patch()))).status === 403)
        if (hyundaiOnly) assert('a GM without the Platinum brand is refused Platinum (brand check)', !(await canAccessDiscountBranch(hyundaiOnly, 'platinum')))
        setTestAppUser(hyundaiGsm)
        const approved = await json(await act(patch()))
        assert('the Hyundai GSM clears stage 1 → PENDING_MD', approved.status === 200 && ((approved.body as Row)?.data as Row)?.status === 'PENDING_MD', JSON.stringify(approved.body).slice(0, 160))
        const again = await json(await act(patch()))
        assert('and cannot then act at the MD stage', again.status === 403)
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    } finally {
      useOuterTransaction(null)
      setTestAppUser(null)
    }
    const [still] = await rows(sql`SELECT status FROM discount_approvals WHERE id = ${pending.id}`)
    assert('the real request is untouched', still?.status === pending.status, String(still?.status))
  }

  console.log('\n5. Export — approved only, filtered, per viewer')
  {
    const { GET: exportGet } = await import('../app/api/discount-approvals/export/route')
    const { default: ExcelJS } = await import('exceljs')
    const { isExportable } = await import('../lib/discount-approvals/filters')
    const all = await rows(sql`SELECT * FROM discount_approvals`)
    const asFilterable = (r: Row) => ({
      branch: String(r.branch), status: String(r.status), customerName: r.customer_name as string | null, customerId: r.customer_id as string | null,
      requesterName: r.requester_name as string | null, tlManager: r.tl_manager as string | null, model: r.model as string | null,
      insuranceType: r.insurance_type as string | null, teleDate: r.tele_date ? String(r.tele_date).slice(0, 10) : null, createdAt: r.created_at as Date,
    })
    const expected = (f: { branch: string; month: string; insurance: string; q: string }, branches: string[]) =>
      all.filter((r) => branches.includes(String(r.branch).toLowerCase()) && isExportable(asFilterable(r), f)).length
    const exportAs = async (u: AppUser | null, qs: string) => { setTestAppUser(u); return exportGet(new Request(`http://x/api/discount-approvals/export?${qs}`)) }

    assert('anonymous export: 401', (await exportAs(null, 'format=xlsx')).status === 401)
    if (kiaCre) assert('a KIA CRE cannot export: 403', (await exportAs(kiaCre, 'format=pdf')).status === 403)

    const everything = { branch: 'all', month: 'all', insurance: 'all', q: '' }
    const xlsx = await exportAs(md, 'format=xlsx')
    const xlsxCount = Number(xlsx.headers.get('x-export-count'))
    assert('MD Excel = every approved request, nothing pending or rejected', xlsx.status === 200 && xlsxCount === expected(everything, ['hyundai', 'platinum']) && xlsxCount === all.filter((r) => r.status === 'APPROVED').length, String(xlsxCount))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as unknown as ArrayBuffer)
    const sheet = wb.getWorksheet('Approved discounts')
    const approvedIds = new Set(all.filter((r) => r.status === 'APPROVED').map((r) => String(r.customer_id)))
    const sheetIds: string[] = []
    sheet?.eachRow((row, n) => { const v = row.getCell(5).value; if (n > 1 && v) sheetIds.push(String(v)) })
    assert('the workbook opens, one row per request plus a total', Boolean(sheet) && sheetIds.length === xlsxCount && sheet!.rowCount === xlsxCount + 2)
    assert('every row in the workbook is an approved request', sheetIds.every((id) => approvedIds.has(id)))

    const septInHouse = { branch: 'all', month: '2026-09', insurance: 'In House', q: '' }
    const pdf = await exportAs(md, 'format=pdf&month=2026-09&insurance=In%20House')
    const pdfBytes = Buffer.from(await pdf.arrayBuffer())
    const pdfText = pdfBytes.toString('latin1')
    assert('PDF honours the month + insurance filters', pdf.status === 200 && Number(pdf.headers.get('x-export-count')) === expected(septInHouse, ['hyundai', 'platinum']))
    const xrefAt = Number(/startxref\n([0-9]+)/.exec(pdfText)?.[1])
    const offsets = [...pdfText.slice(xrefAt).matchAll(/^([0-9]{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    assert('the PDF is well-formed (header, xref offsets, EOF)', pdfText.startsWith('%PDF-1.4') && pdfText.trimEnd().endsWith('%%EOF')
      && offsets.length > 3 && offsets.every((o, i) => pdfText.startsWith(`${i + 1} 0 obj`, o)))
    assert('the PDF prints amounts as Rs (Helvetica has no ₹)', !pdfText.includes('₹') && /Rs [0-9]/.test(pdfText))

    if (hyundaiOnly) {
      const own = await exportAs(hyundaiOnly, 'format=xlsx')
      assert('a Hyundai-only GM exports Hyundai only', Number(own.headers.get('x-export-count')) === expected(everything, ['hyundai']))
      const other = await exportAs(hyundaiOnly, 'format=xlsx&branch=platinum')
      assert('…and asking for Platinum gives an empty file, not Platinum rows', other.status === 200 && Number(other.headers.get('x-export-count')) === 0)
    }
    setTestAppUser(null)
    if (process.env.DISCOUNT_EXPORT_SAMPLES) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`${process.env.DISCOUNT_EXPORT_SAMPLES}/sample.pdf`, pdfBytes)
      writeFileSync(`${process.env.DISCOUNT_EXPORT_SAMPLES}/sample-all.pdf`, Buffer.from(await (await exportAs(md, 'format=pdf')).arrayBuffer()))
      setTestAppUser(null)
    }
  }

  console.log('\n6. Source guards')
  const route = readFileSync('app/api/discount-approvals/route.ts', 'utf8')
  const lookupSrc = readFileSync('app/api/discount-approvals/lookup/route.ts', 'utf8')
  const rawInterpolations = [...route.matchAll(/sql\.raw\(`([\s\S]*?)`\)/g)].filter((m) => m[1].includes('${')).length
  assert('no sql.raw template with interpolated input in the discount route', rawInterpolations === 0)
  assert('the lookup builds no SQL from strings', !/sql\.raw\(`/.test(lookupSrc))
  const drawer = readFileSync('app/brands/hyundai/sales/discount-approvals/discount-approvals-client.tsx', 'utf8')
  assert('the dashboard drawer never shows a PAN', !/pan_number|PAN Number/.test(drawer))
  const approvalsPage = readFileSync('app/brands/kia/payment-approvals/page.tsx', 'utf8')
  assert('the Approvals page decides the brand tabs with the API\'s own rule', approvalsPage.includes('discountBranchesFor(appUser)'))

  console.log(failures ? `\n=== ${failures} FAILURE(S) ===` : '\n=== ALL PASSED ===')
}

main()
  .catch((error) => { console.error(error); failures++ })
  .finally(async () => {
    await testClient.end().catch(() => {})
    process.exit(failures ? 1 : 0)
  })
