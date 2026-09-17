/**
 * The whole H Promise workflow against the REAL database — inside one transaction that is always rolled back.
 *
 *   npm run verify:h-promise-flow
 *
 * tsconfig.hp-flow.json maps `@/lib/db` to scripts/_shims/hp-test-db.ts, which routes every app query into the
 * outer transaction and turns the app's own `db.transaction` into savepoints. The app code under test is the
 * production code, unchanged: purchase → two-stage approval (GSM / SM, then MD) → price lock → reopen → booking →
 * sale → refusals → ledger →
 * documents → withdraw → delete/restore, plus redaction, the name lists, the rates and the exchange bonus.
 *
 * Nothing survives: no vehicle, no file row, no history row. No storage object is written (file rows are staged
 * directly with made-up paths). The stock-number sequence, which is not transactional, is reset to the highest
 * real stock number at the end. Three existing user ids are borrowed as the actors (never printed); no user row
 * is read beyond its id and nothing is written to `users`.
 */
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import { tataHPromiseFiles, tataHPromiseOptions } from '../lib/db/schema'
import { deriveCapabilities, HP_PERMISSION_KEYS, type HPromiseCapabilities } from '../lib/h-promise/access-shared'
import type { HPromiseActor } from '../lib/h-promise/access'
import type { FileKind } from '../lib/h-promise/constants'
import {
  createBooking,
  createExchangeBonus,
  createPurchase,
  decidePurchase,
  decideSale,
  deleteExchangeBonus,
  deleteVehicle,
  refundBooking,
  reopenPurchase,
  reopenSale,
  restoreVehicle,
  resubmitPurchase,
  saveBrokerRc,
  saveDocuments,
  saveSale,
  updateBooking,
  updateExchangeBonus,
  updatePurchase,
  uploadLedger,
  withdrawSale,
} from '../lib/h-promise/server'
import { checkRegistration, getVehicleDetail, listExchangeBonuses, listVehicles } from '../lib/h-promise/queries'
import { addRate, createOption, removeFutureRate, updateOption } from '../lib/h-promise/options'
import { openFile } from '../lib/h-promise/files'
import { hPromiseErrorResponse } from '../lib/h-promise/api'

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

/** Runs `fn`, expecting the app to refuse with `status` (as the route would answer). */
async function refuses(label: string, status: number, fn: () => Promise<unknown>, messagePart?: string) {
  try {
    await fn()
    assert(`${label} → refused ${status}`, false, 'it was allowed')
  } catch (error) {
    if (error instanceof Rollback) throw error
    const response = hPromiseErrorResponse(error)
    const body = (await response.json()) as { error?: string }
    const ok = response.status === status && (!messagePart || (body.error ?? '').toLowerCase().includes(messagePart.toLowerCase()))
    assert(`${label} → ${status}${messagePart ? ` "${messagePart}"` : ''}`, ok, `got ${response.status}: ${body.error}`)
  }
}

const ALL_KEYS = Object.values(HP_PERMISSION_KEYS)
function capsFor(user: HPromiseActor, keys: readonly string[]): HPromiseCapabilities {
  return deriveCapabilities(user, Object.fromEntries(keys.map((key) => [key, true])), false)
}

async function main() {
  const people = await realDb.execute<{ id: string }>(sql`SELECT id FROM public.users WHERE is_active ORDER BY created_at LIMIT 3`)
  const ids = (people as unknown as Array<{ id: string }>).map((row) => row.id)
  if (ids.length < 3) throw new Error('Need three active users to act as desk, approver and second approver.')

  const desk: HPromiseActor = { id: ids[0], name: 'Test Desk', role: 'sales_manager' }
  const approver: HPromiseActor = { id: ids[1], name: 'Test Approver', role: 'general_manager' }
  const second: HPromiseActor = { id: ids[2], name: 'Test Approver Two', role: 'md' }
  const deskCaps = capsFor(desk, [HP_PERMISSION_KEYS.registerView, HP_PERMISSION_KEYS.registerCreate, HP_PERMISSION_KEYS.registerEdit])
  const approverCaps = capsFor(approver, ALL_KEYS.filter((key) => key !== HP_PERMISSION_KEYS.paymentsEdit))
  // A second GSM / SM-level approver (every tick, but not the MD role) …
  const secondCaps = capsFor(second, ALL_KEYS)
  // … and the same person as the MD: the final stage is a role, not a tick.
  const mdCaps = deriveCapabilities(second, {}, true)
  const accountsCaps = capsFor(desk, [HP_PERMISSION_KEYS.paymentsView, HP_PERMISSION_KEYS.paymentsEdit])
  const viewerCaps = capsFor({ id: ids[2], name: 'Viewer', role: 'viewer' }, [HP_PERMISSION_KEYS.registerView])
  const createOnly = capsFor(desk, [HP_PERMISSION_KEYS.registerView, HP_PERMISSION_KEYS.registerCreate])

  const [before] = (await realDb.execute<{ n: number; max: number | null }>(sql`
    SELECT count(*)::int AS n, max(stock_no) AS max FROM public.tata_h_promise_vehicles`)) as unknown as Array<{ n: number; max: number | null }>

  try {
    await realDb.transaction(async (tx) => {
      useOuterTransaction(tx as unknown as typeof realDb)

      async function stage(kind: FileKind, by: HPromiseActor = desk, contentType = 'image/jpeg'): Promise<string> {
        const id = randomUUID()
        await tx.insert(tataHPromiseFiles).values({
          id,
          kind,
          storagePath: `u-flowtest/${kind}/${id}.${contentType === 'application/pdf' ? 'pdf' : 'jpg'}`,
          contentType,
          sizeBytes: 1234,
          sha256: 'flowtest',
          uploadedBy: by.id,
          uploadedByName: by.name,
        })
        return id
      }
      const version = async (id: string) => (await getVehicleDetail(secondCaps, id)).updatedAt

      console.log('\n1) Name lists')
      await tx.insert(tataHPromiseOptions).values([
        { kind: 'staff', value: 'FLOWTEST BUYER', label: 'Flowtest Buyer', createdByName: 'flow test' },
        { kind: 'staff', value: 'FLOWTEST SELLER', label: 'Flowtest Seller', createdByName: 'flow test' },
      ])
      const added = await createOption(second, { kind: 'staff', label: '  flowtest   extra ' })
      assert('a new name is stored upper-case with single spaces', added.value === 'FLOWTEST EXTRA' && added.label === 'flowtest extra')
      await refuses('adding the same name twice', 409, () => createOption(second, { kind: 'staff', label: 'Flowtest Extra' }), 'already on')
      const hidden = await updateOption(second, added.id, { isActive: false, label: 'Flowtest Extra (left)' })
      assert('a name can be renamed and hidden; its value never changes', !hidden.isActive && hidden.value === 'FLOWTEST EXTRA')

      console.log('\n2) Purchase')
      const reg = `ZZ ${String(Date.now()).slice(-2)} FT ${String(Math.floor(Math.random() * 9000) + 1000)}`
      const purchase = {
        regNo: reg.toLowerCase(),
        model: 'Nexon XZ+',
        colour: 'Flame Red',
        manufacturingYear: 2021,
        odometerKm: '45,210',
        location: 'TATA NARWAL',
        purchaseDate: '2026-08-01',
        purchasePrice: '5,00,000',
        purchaseGstPct: 6,
        // Required since the target-sale-date change (the overdue flag).
        expectedSaleDate: '2026-10-15',
        purchaseFinanced: false,
        purchasedBy: 'FLOWTEST BUYER',
        sellerPhone: '+91 98765 43210',
        purchaseWhatsappApprover: 'TARUN MALHOTRA',
      }
      await refuses('a purchase without its WhatsApp screenshot', 400, () => createPurchase(desk, deskCaps, purchase), 'screenshot')
      await refuses('a purchase by someone with no create right', 403, () => createPurchase(desk, viewerCaps, purchase))
      await refuses('a purchase with a staff name not on the list', 400, () => createPurchase(desk, deskCaps, { ...purchase, purchasedBy: 'NOBODY', files: { purchase_approval_screenshot: randomUUID() } }), 'from the list')
      await refuses('a purchase with a hidden staff name', 400, () => createPurchase(desk, deskCaps, { ...purchase, purchasedBy: 'FLOWTEST EXTRA' }), 'no longer offered')
      await refuses('a purchase dated in the future', 400, () => createPurchase(desk, deskCaps, { ...purchase, purchaseDate: '2099-01-01' }), 'future')
      await refuses('a purchase whose staged file belongs to someone else', 400, async () => {
        const foreign = await stage('purchase_approval_screenshot', approver)
        return createPurchase(desk, deskCaps, { ...purchase, files: { purchase_approval_screenshot: foreign } })
      }, 'expired')
      const created = await createPurchase(desk, deskCaps, { ...purchase, files: { purchase_approval_screenshot: await stage('purchase_approval_screenshot') } })
      const vid = created.id
      assert('the purchase is recorded with a stock number', typeof created.stockNo === 'number')
      let detail = await getVehicleDetail(secondCaps, vid)
      assert('it waits for approval', detail.purchaseStatus === 'pending' && detail.flags.purchasePending)
      assert('the registration is stored upper-case', detail.regNo === reg.toUpperCase())
      assert('money strings are read as numbers', detail.purchasePrice === 500000 && detail.odometerKm === 45210)
      assert('the phone number is stored as ten digits', detail.sellerPhone === '9876543210')
      assert('the screenshot is attached', detail.files.some((f) => f.kind === 'purchase_approval_screenshot'))
      assert('the history has the creation', detail.events.some((e) => e.action === 'purchase_created'))
      assert('price with GST', detail.economics.priceWithGst === 530000)
      assert('interest is accruing while in stock', (detail.economics.interest ?? 0) > 0 && detail.economics.netProfit === null)
      await refuses('the same registration again (any spacing)', 409, () => createPurchase(desk, deskCaps, { ...purchase, regNo: reg.replace(/ /g, '-'), files: { purchase_approval_screenshot: randomUUID() } }), 'already on the register')
      const check = await checkRegistration(reg)
      assert('the duplicate check finds the live vehicle', check.live?.id === vid)

      console.log('\n3) Two-stage approval (GSM / SM, then MD) and the price lock')
      await refuses('the desk approving its own purchase', 403, () => decidePurchase(desk, { ...deskCaps, approvals: { view: true, approve: true, final: false } }, vid, { decision: 'approve' }), 'someone else')
      await refuses('someone with no approve right', 403, () => decidePurchase(desk, viewerCaps, vid, { decision: 'approve' }))
      await refuses('a rejection without a reason', 400, () => decidePurchase(approver, approverCaps, vid, { decision: 'reject', reason: 'no' }))
      assert('a new purchase waits for the GSM / SM', detail.purchaseManagerStatus === 'pending' && detail.flags.purchaseQueue === 'manager')
      assert('the tick alone is the GSM / SM stage; only the MD role is final', approverCaps.approvals.approve && !approverCaps.approvals.final && mdCaps.approvals.final)
      await decidePurchase(approver, approverCaps, vid, { decision: 'reject', reason: 'Seller phone looks wrong' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('rejected at the GSM / SM stage, with the reason kept',
        detail.purchaseStatus === 'rejected' && detail.purchaseManagerStatus === 'rejected' && detail.purchaseDecisionReason === 'Seller phone looks wrong' && detail.flags.purchaseQueue === 'rejected')
      assert('the history names the stage', detail.events.some((e) => e.action === 'purchase_manager_rejected'))
      await refuses('the MD approving a rejected purchase', 409, () => decidePurchase(second, mdCaps, vid, { decision: 'approve' }))
      await updatePurchase(desk, createOnly, vid, { colour: 'Red', resubmit: true, remarks: 'Checked with the seller', expectedUpdatedAt: detail.updatedAt })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('the desk fixed and resubmitted its own rejected entry with only the create right', detail.purchaseStatus === 'pending' && detail.colour === 'Red')
      assert('resubmitting clears both stages', detail.purchaseDecidedByName === null && detail.purchaseManagerStatus === 'pending' && detail.purchaseManagerByName === null)

      await decidePurchase(approver, approverCaps, vid, { decision: 'approve', reason: 'Checked the RC' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('the GSM / SM approved: it now waits for the MD',
        detail.purchaseStatus === 'pending' && detail.purchaseManagerStatus === 'approved' && detail.purchaseManagerByName === 'Test Approver'
        && detail.purchaseManagerNote === 'Checked the RC' && detail.flags.purchaseQueue === 'md')
      await refuses('a second GSM / SM approval', 409, () => decidePurchase(second, secondCaps, vid, { decision: 'approve' }), 'waiting for the md')
      await updatePurchase(desk, deskCaps, vid, { purchasePrice: 505000, expectedUpdatedAt: detail.updatedAt })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('a price change after the GSM / SM approved sends it back to them',
        detail.purchaseManagerStatus === 'pending' && detail.flags.purchaseQueue === 'manager' && detail.events.some((e) => e.action === 'purchase_manager_reset'))
      await decidePurchase(approver, approverCaps, vid, { decision: 'approve' })
      await decidePurchase(second, mdCaps, vid, { decision: 'approve' })
      await refuses('approving twice', 409, () => decidePurchase(second, mdCaps, vid, { decision: 'approve' }), 'already approved')
      await refuses('a GSM / SM deciding an MD-approved purchase', 409, () => decidePurchase(approver, approverCaps, vid, { decision: 'reject', reason: 'Too late now' }), 'already approved')
      detail = await getVehicleDetail(secondCaps, vid)
      assert('approved by the MD after the GSM / SM',
        detail.purchaseStatus === 'approved' && detail.purchaseDecidedByName === 'Test Approver Two' && detail.purchaseDecidedRole === 'md'
        && detail.purchaseManagerStatus === 'approved' && detail.flags.purchaseQueue === 'approved')
      await refuses('changing an approved price', 409, () => updatePurchase(desk, deskCaps, vid, { purchasePrice: 490000, expectedUpdatedAt: detail.updatedAt }), 'locked')
      await refuses('the desk editing an approved entry with only the create right', 403, () => updatePurchase(desk, createOnly, vid, { colour: 'Blue', expectedUpdatedAt: detail.updatedAt }))
      await refuses('an edit from an out-of-date form', 409, () => updatePurchase(desk, deskCaps, vid, { colour: 'Blue', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }), 'someone else changed')
      let lockFired = false
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql`UPDATE public.tata_h_promise_vehicles SET purchase_price = 1 WHERE id = ${vid}`)
        })
      } catch (error) {
        lockFired = JSON.stringify(error).includes('HP001') || String((error as { cause?: { code?: string } }).cause?.code) === 'HP001'
      }
      assert('the database itself refuses an approved price change (HP001)', lockFired)
      let selfCheck = false
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql`UPDATE public.tata_h_promise_vehicles SET purchase_decided_by = created_by WHERE id = ${vid}`)
        })
      } catch (error) {
        selfCheck = JSON.stringify(error).includes('not_self') || String((error as { cause?: { constraint_name?: string } }).cause?.constraint_name).includes('not_self')
      }
      assert('the database itself refuses a self-decision (CHECK)', selfCheck)
      let managerSelfCheck = false
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql`UPDATE public.tata_h_promise_vehicles SET purchase_manager_by = created_by WHERE id = ${vid}`)
        })
      } catch (error) {
        managerSelfCheck = JSON.stringify(error).includes('manager_not_self') || String((error as { cause?: { constraint_name?: string } }).cause?.constraint_name).includes('manager_not_self')
      }
      assert('the database refuses a self-decision at the GSM / SM stage too (0073 CHECK)', managerSelfCheck)
      await updatePurchase(desk, deskCaps, vid, { colour: 'Flame Red', remarks: 'Colour per RC', expectedUpdatedAt: detail.updatedAt })
      let list = await listVehicles('live')
      let row = list.rows.find((r) => r.id === vid)
      assert('an edit after approval is flagged on the register', row?.purchaseEditedAfterApproval === true)

      await refuses('the desk reopening a purchase', 403, () => reopenPurchase(desk, deskCaps, vid, { reason: 'Price was wrong' }))
      await refuses('a GSM / SM reopening an MD-approved purchase', 403, () => reopenPurchase(approver, approverCaps, vid, { reason: 'Price was wrong' }), 'only the md')
      await reopenPurchase(second, mdCaps, vid, { reason: 'Price was mistyped' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('reopened by the MD: back to the GSM / SM', detail.purchaseStatus === 'pending' && detail.purchaseManagerStatus === 'pending' && detail.purchaseDecidedRole === null)
      await updatePurchase(approver, approverCaps, vid, { purchasePrice: 495000, expectedUpdatedAt: detail.updatedAt })
      await refuses('the approver who changed the price approving it', 403, () => decidePurchase(approver, approverCaps, vid, { decision: 'approve' }), 'someone else')
      await refuses('the creator approving it', 403, () => decidePurchase(desk, { ...approverCaps, userId: desk.id }, vid, { decision: 'approve' }))
      await decidePurchase(second, mdCaps, vid, { decision: 'approve' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('the MD approved before any GSM / SM: that stage reads "skipped"',
        detail.purchaseStatus === 'approved' && detail.purchaseManagerStatus === 'skipped' && detail.purchasePrice === 495000 && detail.flags.purchaseQueue === 'approved')
      assert('the history shows every step of both stages',
        ['purchase_manager_rejected', 'purchase_resubmitted', 'purchase_manager_approved', 'purchase_manager_reset', 'purchase_approved', 'purchase_updated', 'purchase_reopened']
          .every((a) => detail.events.some((e) => e.action === a)))

      console.log('\n4) Booking')
      await refuses('a booking without a receipt', 400, () => createBooking(desk, deskCaps, vid, { bookingDate: '2026-08-05', amount: 25000 }), 'receipt')
      await refuses('a booking before the purchase date', 400, () => createBooking(desk, deskCaps, vid, { bookingDate: '2026-07-01', amount: 25000, files: { booking_receipt: randomUUID() } }), 'before the purchase')
      const booking = await createBooking(desk, deskCaps, vid, { bookingDate: '2026-08-05', amount: '25,000', files: { booking_receipt: await stage('booking_receipt') } })
      await refuses('a second live booking', 409, () => createBooking(desk, deskCaps, vid, { bookingDate: '2026-08-06', amount: 1000, files: { booking_receipt: randomUUID() } }))
      row = (await listVehicles('live')).rows.find((r) => r.id === vid)
      assert('the vehicle shows as booked', row?.stage === 'booked' && row.booking?.amount === 25000)
      await refuses('the desk correcting the booking amount', 403, () => updateBooking(desk, deskCaps, booking.id, { amount: 20000, reason: 'Typo in amount' }), 'approver')
      await updateBooking(approver, approverCaps, booking.id, { amount: 20000, reason: 'Receipt says 20,000' })
      await updateBooking(desk, deskCaps, booking.id, { remarks: 'Customer will pay balance on delivery' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('an approver corrected the amount; the desk changed the remarks', detail.bookings[0]?.amount === 20000 && detail.bookings[0]?.remarks?.startsWith('Customer'))

      console.log('\n5) Sale')
      const sale = {
        saleDate: '2026-09-01',
        sellingPrice: 560000,
        otherCost: 12000,
        isDemo: false,
        soldTo: 'CUSTOMER',
        saleFinanced: true,
        soldBy: 'FLOWTEST SELLER',
        buyerName: 'Flow Test Buyer',
        buyerPhone: '9123456780',
        buyerAddress: 'Somewhere, Jammu',
        saleWhatsappApprover: 'SANJAY MAHAJAN',
      }
      await refuses('a sale without PAN, Aadhaar, screenshot and gate pass', 400, () => saveSale(desk, deskCaps, vid, sale), "buyer's PAN")
      await refuses('a sale before the purchase date', 400, () => saveSale(desk, deskCaps, vid, { ...sale, saleDate: '2026-07-01' }), 'before the purchase')
      await refuses('a sale by a view-only user', 403, () => saveSale(desk, viewerCaps, vid, sale))
      await saveSale(desk, deskCaps, vid, {
        ...sale,
        files: {
          buyer_pan: await stage('buyer_pan'),
          buyer_aadhaar: await stage('buyer_aadhaar', desk, 'application/pdf'),
          sale_approval_screenshot: await stage('sale_approval_screenshot'),
          gate_pass_photo: await stage('gate_pass_photo'),
        },
      })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('sold, awaiting approval', detail.stage === 'sold' && detail.saleStatus === 'pending')
      assert('gross profit = 5,60,000 − (4,95,000 + 12,000) = 53,000', detail.economics.grossProfit === 53000)
      assert('gross profit with GST = 5,60,000 − (5,24,700 + 12,000) = 23,300', detail.economics.grossProfitWithGst === 23300)
      assert('interest stops on the sale date (31 days)', detail.economics.interestDays === 31 && detail.economics.interest === Math.round(31 * 0.12 / 365 * 495000))
      assert('a sold car needs its ledger', detail.flags.ledgerPending)
      assert('a sold car without RC/KYC/insurance is flagged', detail.flags.docsMissing && detail.flags.missingDocs.length === 4)
      await refuses('refunding the booking of a sold car', 409, () => refundBooking(desk, deskCaps, booking.id, { refundDate: '2026-09-02', refundRemarks: 'Cancelled', files: { refund_cheque: randomUUID() } }), 'withdraw the sale')
      await refuses('recording a second sale over the first without the form version', 409, () => saveSale(desk, deskCaps, vid, sale))
      await refuses('the seller approving their own sale', 403, () => decideSale(desk, { ...deskCaps, approvals: { view: true, approve: true, final: false } }, vid, { decision: 'approve' }), 'someone else')
      assert('a new sale waits for the GSM / SM', detail.saleManagerStatus === 'pending' && detail.flags.saleQueue === 'manager')
      await decideSale(approver, approverCaps, vid, { decision: 'approve' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('the GSM / SM approved the sale: it waits for the MD', detail.saleStatus === 'pending' && detail.saleManagerStatus === 'approved' && detail.flags.saleQueue === 'md')
      await refuses('a GSM / SM approving it again', 409, () => decideSale(second, secondCaps, vid, { decision: 'approve' }), 'waiting for the md')
      await saveSale(desk, deskCaps, vid, { ...sale, sellingPrice: 560500, remarks: 'Final negotiated price', expectedUpdatedAt: detail.updatedAt })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('a changed selling price sends the sale back to the GSM / SM', detail.saleManagerStatus === 'pending' && detail.events.some((e) => e.action === 'sale_manager_reset'))
      await saveSale(desk, deskCaps, vid, { ...sale, remarks: 'Back to the agreed price', expectedUpdatedAt: detail.updatedAt })
      detail = await getVehicleDetail(secondCaps, vid)
      await decideSale(second, mdCaps, vid, { decision: 'approve' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('the MD approved the sale directly', detail.saleStatus === 'approved' && detail.saleManagerStatus === 'skipped' && detail.saleDecidedRole === 'md' && detail.flags.saleQueue === 'approved')
      await refuses('changing an approved selling price', 409, () => saveSale(desk, deskCaps, vid, { ...sale, sellingPrice: 550000, expectedUpdatedAt: detail.updatedAt }), 'locked')
      await saveSale(desk, deskCaps, vid, { ...sale, otherCost: 15000, remarks: 'Late invoice', expectedUpdatedAt: detail.updatedAt })
      row = (await listVehicles('live')).rows.find((r) => r.id === vid)
      assert('other cost stays editable after approval, and is flagged', row?.otherCost === 15000 && row.saleEditedAfterApproval === true)
      assert('the approved sale left the live registration index', (await checkRegistration(reg)).live === null)
      await refuses('withdrawing an approved sale', 409, () => withdrawSale(desk, deskCaps, vid, { reason: 'Buyer backed out' }), 'reopen')

      console.log('\n6) Paperwork, broker RC and the ledger')
      detail = await getVehicleDetail(secondCaps, vid)
      await refuses('broker RC on a customer sale', 409, () => saveBrokerRc(desk, deskCaps, vid, { brokerRcRemarks: 'x', expectedUpdatedAt: detail.updatedAt }), 'broker')
      await refuses('documents from a stale form', 409, () => saveDocuments(desk, deskCaps, vid, { insuranceEndDate: '2027-01-01', expectedUpdatedAt: '2020-01-01T00:00:00Z' }))
      await saveDocuments(desk, deskCaps, vid, {
        insuranceEndDate: '2027-03-31',
        hypothecation: 'UNDER_PROCESS',
        rtoStatus: 'NOT_REQUIRED',
        files: { rc: await stage('rc'), seller_pan: await stage('seller_pan'), seller_aadhaar: await stage('seller_aadhaar'), insurance_copy: await stage('insurance_copy') },
        expectedUpdatedAt: detail.updatedAt,
      })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('documents saved; nothing missing', !detail.flags.docsMissing && detail.insuranceEndDate === '2027-03-31')
      assert('hypothecation under process counts as paperwork pending', detail.flags.paperworkPending)
      const firstRc = detail.files.find((f) => f.kind === 'rc')?.id
      await saveDocuments(desk, deskCaps, vid, { files: { rc: await stage('rc') }, expectedUpdatedAt: detail.updatedAt })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('replacing the RC keeps the old one as history', detail.replacedFiles.some((f) => f.id === firstRc) && detail.files.filter((f) => f.kind === 'rc').length === 1)
      await refuses('the desk uploading the ledger', 403, () => uploadLedger(desk, deskCaps, vid, { files: { payment_ledger: randomUUID() } }))
      await uploadLedger(desk, accountsCaps, vid, { files: { payment_ledger: await stage('payment_ledger', desk, 'application/pdf') } })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('the ledger is uploaded and the payment verified', !detail.flags.ledgerPending && detail.paymentVerifiedByName === 'Test Desk')
      await refuses('uploading the ledger a second time', 409, () => uploadLedger(desk, accountsCaps, vid, { files: { payment_ledger: randomUUID() } }), 'already uploaded')

      console.log('\n7) Who sees what')
      const asViewer = await getVehicleDetail(viewerCaps, vid)
      assert('a viewer sees masked phone numbers', asViewer.sellerPhone === '••••••3210' && asViewer.buyerPhone === '••••••6780')
      assert('a viewer does not see the buyer address', asViewer.buyerAddress === null && asViewer.redacted)
      const pan = asViewer.files.find((f) => f.kind === 'buyer_pan')
      assert('a viewer sees that a PAN is on file but cannot open it', Boolean(pan) && pan?.canOpen === false && pan?.previewUrl === null)
      await refuses('a viewer opening the PAN', 403, () => openFile({ id: ids[2], name: 'Viewer', role: 'viewer' }, viewerCaps, pan!.id, false))
      await refuses('a viewer opening the ledger', 403, () => openFile({ id: ids[2], name: 'Viewer', role: 'viewer' }, viewerCaps, detail.files.find((f) => f.kind === 'payment_ledger')!.id, false))
      const asDesk = await getVehicleDetail(deskCaps, vid)
      assert('the desk sees full numbers and the address', asDesk.sellerPhone === '9876543210' && asDesk.buyerAddress === 'Somewhere, Jammu' && !asDesk.redacted)
      assert('personal documents are never pre-signed, even for the desk', asDesk.files.filter((f) => f.kind === 'buyer_pan').every((f) => f.previewUrl === null && f.canOpen))
      const eventsJson = JSON.stringify(asDesk.events)
      assert('no phone number or address appears in the history', !eventsJson.includes('9876543210') && !eventsJson.includes('9123456780') && !eventsJson.includes('Somewhere'))

      console.log('\n8) Reopen, withdraw, refund and rebook')
      await refuses('a GSM / SM reopening an MD-approved sale', 403, () => reopenSale(second, secondCaps, vid, { reason: 'Buyer cancelled' }), 'only the md')
      await reopenSale(second, mdCaps, vid, { reason: 'Buyer cancelled after approval' })
      await refuses('the desk withdrawing a sale whose ledger is uploaded', 409, () => withdrawSale(desk, deskCaps, vid, { reason: 'Buyer cancelled' }), 'ledger')
      await withdrawSale(second, { ...secondCaps, isSuperAdmin: true }, vid, { reason: 'Buyer cancelled' })
      detail = await getVehicleDetail(secondCaps, vid)
      assert('withdrawn: back to booked, sale fields cleared', detail.stage === 'booked' && detail.saleStatus === null && detail.sellingPrice === null && detail.buyerPhone === null)
      assert('a withdrawn sale has no approval stages left', detail.saleManagerStatus === null && detail.flags.saleQueue === null && detail.saleDecidedRole === null)
      assert('the sale paperwork and ledger were retired, the vehicle paperwork kept',
        !detail.files.some((f) => ['buyer_pan', 'gate_pass_photo', 'payment_ledger'].includes(f.kind)) && detail.files.some((f) => f.kind === 'rc'))
      assert('the payment check is cleared with the sale', detail.paymentVerifiedAt === null)
      await refuses('a refund before the booking date', 400, () => refundBooking(desk, deskCaps, booking.id, { refundDate: '2026-08-01', refundRemarks: 'x', files: { refund_cheque: randomUUID() } }))
      await refuses('a refund without the cheque', 400, () => refundBooking(desk, deskCaps, booking.id, { refundDate: '2026-09-03', refundRemarks: 'Cancelled' }), 'cheque')
      await refundBooking(desk, deskCaps, booking.id, { refundDate: '2026-09-03', refundRemarks: 'Customer cancelled', files: { refund_cheque: await stage('refund_cheque') } })
      await refuses('refunding twice', 409, () => refundBooking(desk, deskCaps, booking.id, { refundDate: '2026-09-03', refundRemarks: 'again', files: { refund_cheque: randomUUID() } }), 'already refunded')
      detail = await getVehicleDetail(secondCaps, vid)
      assert('refunded: back in stock', detail.stage === 'in_stock' && detail.bookings[0]?.status === 'refunded')
      assert('the refund cheque sits on the booking', detail.bookings[0]?.files.some((f) => f.kind === 'refund_cheque'))
      const rebook = await createBooking(desk, deskCaps, vid, { bookingDate: '2026-09-04', amount: 30000, files: { booking_receipt: await stage('booking_receipt') } })
      list = await listVehicles('live')
      assert('rebooked, and the MIS sees both bookings', list.bookings.filter((b) => b.vehicleId === vid).length === 2)

      console.log('\n9) Delete and restore')
      await refuses('deleting a vehicle with a live booking', 409, () => deleteVehicle(second, mdCaps, vid, { reason: 'Duplicate entry' }), 'refund')
      await refundBooking(desk, deskCaps, rebook.id, { refundDate: '2026-09-05', refundRemarks: 'Test refund', files: { refund_cheque: await stage('refund_cheque') } })
      await refuses('the desk deleting an approved purchase', 403, () => deleteVehicle(desk, { ...deskCaps, register: { ...deskCaps.register, delete: true } }, vid, { reason: 'Duplicate entry' }), 'only the md')
      await refuses('a GSM / SM deleting an MD-approved purchase', 403, () => deleteVehicle(approver, approverCaps, vid, { reason: 'Duplicate entry' }), 'only the md')
      await refuses('a delete without a reason', 400, () => deleteVehicle(approver, approverCaps, vid, {}))
      await deleteVehicle(second, mdCaps, vid, { reason: 'Entered twice' })
      assert('deleted vehicles leave the live list', !(await listVehicles('live')).rows.some((r) => r.id === vid))
      assert('and appear in the deleted list', (await listVehicles('deleted')).rows.some((r) => r.id === vid && r.deleteReason === 'Entered twice'))
      await refuses('editing a deleted vehicle', 409, () => updatePurchase(desk, deskCaps, vid, { colour: 'x', expectedUpdatedAt: new Date().toISOString() }), 'deleted')
      const again = await createPurchase(desk, deskCaps, { ...purchase, files: { purchase_approval_screenshot: await stage('purchase_approval_screenshot') } })
      await refuses('restoring while the same car is live again', 409, () => restoreVehicle(approver, approverCaps, vid), 'on the register again')
      await tx.execute(sql`UPDATE public.tata_h_promise_vehicles SET deleted_at = now(), deleted_by_name = 'flow test', delete_reason = 'flow test' WHERE id = ${again.id}`)
      await restoreVehicle(approver, approverCaps, vid)
      assert('restored', (await listVehicles('live')).rows.some((r) => r.id === vid))
      await refuses('resubmitting an approved purchase', 409, () => resubmitPurchase(desk, deskCaps, vid, {}))

      console.log('\n10) Exchange bonus and rates')
      const bonus = await createExchangeBonus(desk, deskCaps, { vehicleNo: 'jk02ft0001', newCarModel: 'Punch', bonusAmount: '15,000', customerPhone: '9988776655' })
      assert('an exchange bonus is recorded', bonus.bonusAmount === 15000 && bonus.vehicleNo === 'JK02FT0001')
      const updatedBonus = await updateExchangeBonus(desk, deskCaps, bonus.id, { vehicleNo: 'JK02FT0001', newCarModel: 'Punch EV', bonusAmount: 20000, customerPhone: '9988776655' })
      assert('and edited', updatedBonus.newCarModel === 'Punch EV')
      const bonusesForViewer = await listExchangeBonuses(viewerCaps)
      assert('its phone number is masked for a viewer', bonusesForViewer.find((b) => b.id === bonus.id)?.customerPhone === '••••••6655')
      await refuses('the desk deleting it without the delete right', 403, () => deleteExchangeBonus(desk, deskCaps, bonus.id))
      await deleteExchangeBonus(second, secondCaps, bonus.id)
      assert('and deleted', !(await listExchangeBonuses(secondCaps)).some((b) => b.id === bonus.id))

      const future = await addRate(second, { effectiveFrom: '2099-01-01', ratePct: 10, note: 'flow test' })
      await refuses('two rates on the same day', 409, () => addRate(second, { effectiveFrom: '2099-01-01', ratePct: 11 }))
      await removeFutureRate(second, future.id, '2026-09-17')
      const [seeded] = (await tx.execute(sql`SELECT id FROM public.tata_h_promise_settings WHERE effective_from = DATE '2000-01-01'`)) as unknown as Array<{ id: string }>
      await refuses('removing a rate that already applied', 409, () => removeFutureRate(second, seeded.id, '2026-09-17'), 'already applied')

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) {
      failures += 1
      console.error('\n[FAIL] the flow stopped:', error)
    }
  } finally {
    useOuterTransaction(null)
  }

  // Nothing survived, and the stock-number sequence is put back.
  const [after] = (await realDb.execute<{ n: number; files: number; events: number }>(sql`
    SELECT (SELECT count(*)::int FROM public.tata_h_promise_vehicles) AS n,
           (SELECT count(*)::int FROM public.tata_h_promise_files WHERE storage_path LIKE 'u-flowtest/%') AS files,
           (SELECT count(*)::int FROM public.tata_h_promise_events WHERE actor_name LIKE 'Test %') AS events`)) as unknown as Array<{ n: number; files: number; events: number }>
  console.log('\n11) Clean-up')
  assert('no test vehicle, file or history row survived', after.n === before.n && after.files === 0 && after.events === 0, JSON.stringify(after))
  await realDb.execute(sql`
    SELECT setval('public.tata_h_promise_vehicles_stock_no_seq', GREATEST(COALESCE((SELECT max(stock_no) FROM public.tata_h_promise_vehicles), 1), 1), (SELECT count(*) > 0 FROM public.tata_h_promise_vehicles))`)
  console.log(`  [INFO] stock-number sequence reset to ${before.max ?? 'the start'}`)

  await testClient.end({ timeout: 5 })
  console.log(failures === 0 ? `\n=== ALL ${passes} FLOW CHECKS PASSED ===` : `\n=== ${failures} FAILURE(S), ${passes} passed ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await testClient.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
