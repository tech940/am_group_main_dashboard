import type { KiaCustomerProfile } from './reader'

/**
 * The unified customer timeline, and what to do next.
 *
 * ── Pure derivation, zero extra queries ───────────────────────────────────────────────────────
 * Every event below already arrives in the profile payload — the enquiry rows carry the enquiry,
 * test-drive, booking and delivery dates; the vehicle rows carry invoice, insurance and every
 * service bill. The reader was fetching all of it and rendering almost none of it. So this module
 * takes no database at all, which also means it costs nothing on a page that already fans out
 * across a dozen tables against a pooler that charges per statement.
 *
 * ── One timeline, not four ────────────────────────────────────────────────────────────────────
 * Sales, insurance and workshop events are interleaved into a single chronological list on purpose.
 * Split timelines are what the section is meant to replace: the whole point is that an employee
 * reads one story instead of opening four reports and doing the merge in their head.
 */

/**
 * Categories are derived from the data, never hardcoded into the filter bar.
 *
 * ⚠️ The brief asks for Warranty, Finance and Communication filters. There is no warranty-claim or
 * finance-event data that can be attached to a person today, so offering those filters would give
 * an employee a control that always returns nothing — which reads as "this customer has no
 * warranty" rather than "we do not hold that". Only categories with at least one real event are
 * offered; see `availableCategories`.
 */
export type TimelineCategory = 'sales' | 'insurance' | 'service' | 'communication' | 'accessories'

/**
 * One line of a multi-line document — today, one accessory off a counter-sale bill.
 *
 * Structured rather than folded into `metadata` because metadata is a flat scalar map printed as a
 * label/value grid; a dozen accessory lines with quantities and prices is a TABLE, and squashing it
 * into one comma-joined string is what left the breakdown unbuilt.
 */
export type TimelineLineItem = {
  description: string
  qty: number | null
  amount: number | null
}

export type TimelineEvent = {
  /** ISO date. Events without a date are dropped — an undated row cannot be placed in a story. */
  date: string
  category: TimelineCategory
  title: string
  detail: string | null
  /** The vehicle this happened to, when it happened to one. */
  vin: string | null
  /** Enquiry no / booking no / policy no — whatever identifies the underlying record. */
  reference: string | null
  metadata?: Record<string, string | number | boolean | null | undefined>
  /** Present when the event summarises several lines — see TimelineLineItem. */
  lines?: TimelineLineItem[]
}

/**
 * Normalise a date to YYYY-MM-DD.
 *
 * ⚠️ The payload carries MIXED formats and this is not cosmetic: insurance dates arrive ISO
 * ('2027-06-25') while sales and service dates arrive DD/MM/YYYY ('30/01/2026'). Sorting the raw
 * strings put 30/01/2026 above 29/01/2025 — a timeline that looks ordered and is not, which is worse
 * than one that is obviously broken because nobody checks it.
 *
 * Returns null for anything unparseable rather than guessing: an undated row cannot be placed in a
 * story, and inventing a position for it would put a fabricated event in a customer's history.
 */
const iso = (value: string | null | undefined): string | null => {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null

  // Already ISO (possibly with a time component).
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (isoMatch) {
    const out = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    return out.startsWith('1900-') || out === '1970-01-01' ? null : out
  }

  // DD/MM/YYYY or DD-MM-YYYY. Day-first, NOT month-first: these are Indian DMS feeds, and reading
  // 03/04/2026 as March would move an event a month without ever looking wrong.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    if (day < 1 || day > 31 || month < 1 || month > 12) return null
    const out = `${dmy[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return out.startsWith('1900-') ? null : out
  }

  return null
}

/**
 * A rupee figure for the timeline's metadata grid.
 *
 * ⚠️ Pre-formatted to a STRING, deliberately. The client's breakdown grid prints metadata with a
 * bare String(val), so a raw number renders as "15234.5" — no symbol, no grouping. It also DROPS
 * any key whose value is null, so a null amount would make its cell vanish silently rather than
 * say anything. Both problems disappear if the server sends finished text.
 *
 * `absent` is the wording for "we hold no price", and it is never "Rs 0": an unbilled workshop
 * visit and a genuinely free one are different facts, and 2,398 of 5,711 visits are the former.
 */
const rupees = (value: number | null | undefined, absent = 'Not billed'): string => {
  /*
   * Sub-rupee values are treated as absent. This is not fussiness: the feed stores labour as 0.01 on
   * parts-only jobs, and at zero decimal places that prints "₹0" beside a ₹13,753 total — which
   * reads as "labour was free" rather than "there was no labour". 282 of 3,313 billed rows are
   * genuinely parts-only, so this case is common enough to get right.
   */
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 1) {
    return absent
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(Number(value))
}

const push = (
  out: TimelineEvent[],
  date: string | null | undefined,
  category: TimelineCategory,
  title: string,
  detail: string | null = null,
  vin: string | null = null,
  reference: string | null = null,
  metadata?: Record<string, string | number | boolean | null | undefined>,
  lines?: TimelineLineItem[],
) => {
  const d = iso(date)
  if (!d) return
  out.push({ date: d, category, title, detail, vin, reference, metadata, ...(lines?.length ? { lines } : {}) })
}

/**
 * Milestones a customer would recognise as something that happened TO them.
 *
 * ⚠️ The stream showed every funnel step the DMS records — enquiry created, test drive, booking
 * created, vehicle invoiced — which is the SALESPERSON's paperwork, not the customer's story. On a
 * normal buyer that is five rows of noise around the one line that matters. These stay in the data
 * and remain visible under "View Full Timeline"; they are simply not the default reading.
 */
const MILESTONE_TITLES = new Set([
  'Vehicle delivered',
  'Payment received',
  'Service visit',
  'Accessories purchased',
  'Insurance policy started',
  'Insurance policy expires',
  'Insurance renewal due',
  'Extended warranty purchased',
  'Complaint raised',
  'Enquiry lost',
])

/**
 * Takes the minimal shape rather than TimelineEvent so the client page — which declares its own
 * structurally-identical type — can share this one list instead of keeping a second copy of it.
 * A duplicated list here is how the screen and the server drift.
 */
export function isMilestoneEvent(event: { title: string }): boolean {
  return MILESTONE_TITLES.has(event.title)
}

/**
 * Collapse events that describe the SAME real-world happening.
 *
 * ⚠️ "Vehicle delivered" was emitted twice for every ordinary purchase — once from the enquiry row
 * (which carries the funnel's delivery_date) and once from the vehicle row (which carries the sales
 * feed's). Same customer, same car, same day, two lines. The same is true of "Booking created".
 *
 * The richer record wins: the one carrying a VIN, and failing that the one with more metadata. A
 * naive "keep the first" would have kept the enquiry copy, which has no VIN and so cannot be
 * filtered by vehicle.
 */
function dedupeSameEvent(events: TimelineEvent[]): TimelineEvent[] {
  /*
   * ⚠️ The two copies do NOT share their detail text, which is why an exact-match key misses them.
   * The enquiry copy reads "SONET"; the vehicle copy reads "SONET · JK14L3988". Grouping is
   * therefore on the MODEL — the first segment of the detail — plus the date and the title.
   */
  const groupKey = (e: TimelineEvent) => {
    const model = String(e.detail || '').split('·')[0].trim().toLowerCase()
    return `${e.date}|${e.title}|${model}`
  }

  const groups = new Map<string, TimelineEvent[]>()
  const order: string[] = []
  for (const e of events) {
    const k = groupKey(e)
    if (!groups.has(k)) { groups.set(k, []); order.push(k) }
    groups.get(k)!.push(e)
  }

  const out: TimelineEvent[] = []
  for (const k of order) {
    const group = groups.get(k)!
    if (group.length === 1) { out.push(group[0]); continue }
    /*
     * A VIN-bearing event is a real vehicle record; a VIN-less one on the same day for the same
     * model is the funnel's shadow of it. Keep EVERY VIN-bearing event — a dealership genuinely
     * takes delivery of several cars of one model on one day, and collapsing those would erase
     * real handovers — and drop the shadows only when a real record exists to shadow.
     */
    const withVin = group.filter((e) => e.vin)
    out.push(...(withVin.length ? withVin : [group[0]]))
  }
  return out
}

/** Every dated event on this customer, newest first. */
export function buildCustomerTimeline(profile: KiaCustomerProfile): TimelineEvent[] {
  const out: TimelineEvent[] = []

  for (const e of profile.enquiries || []) {
    const model = e.model || null
    push(out, e.enquiryDate, 'sales', 'Enquiry created', model, null, e.enquiryNo, {
      'Record Type': 'Showroom Enquiry',
      'Enquiry Number': e.enquiryNo,
      'Enquiry Date': iso(e.enquiryDate),
      'Interested Model': e.model,
      'Lead Status': e.status,
      'Source Channel': e.source,
      'Assigned Consultant': e.consultant,
      'Test Drive Date': iso(e.testDriveDate),
      'Converted Booking No': e.bookingNo,
      'Delivery Date': iso(e.deliveryDate),
      'Lost Date': iso(e.lostDate),
    })
    push(out, e.testDriveDate, 'sales', 'Test drive', model, null, e.enquiryNo, {
      'Record Type': 'Customer Test Drive',
      'Test Drive Date': iso(e.testDriveDate),
      'Demonstration Model': e.model,
      'Associated Enquiry': e.enquiryNo,
      'Sales Consultant': e.consultant,
      'Enquiry Status': e.status,
    })
    // The booking date on the ENQUIRY row, not a second booking record: enquiry.booking_no is the
    // funnel link, and using it here keeps a booking attached to the enquiry that produced it.
    push(out, e.bookingDate, 'sales', 'Booking created', model, null, e.bookingNo, {
      'Record Type': 'Confirmed Vehicle Booking',
      'Booking Number': e.bookingNo,
      'Booking Date': iso(e.bookingDate),
      'Booked Model': e.model,
      'Originating Enquiry': e.enquiryNo,
      'Sales Consultant': e.consultant,
      'Delivery Date': iso(e.deliveryDate),
    })
    push(out, e.deliveryDate, 'sales', 'Vehicle delivered', model, null, e.bookingNo, {
      'Record Type': 'Vehicle Delivery Handover',
      'Delivery Date': iso(e.deliveryDate),
      'Model': e.model,
      'Booking Reference': e.bookingNo,
      'Enquiry Reference': e.enquiryNo,
      'Sales Consultant': e.consultant,
    })
    push(out, e.lostDate, 'sales', 'Enquiry lost', model, null, e.enquiryNo, {
      'Record Type': 'Lost Lead Closure',
      'Lost Date': iso(e.lostDate),
      'Enquiry Number': e.enquiryNo,
      'Model': e.model,
      'Consultant': e.consultant,
    })
  }

  // Bookings with no matching enquiry row would otherwise be invisible — the enquiry loop above can
  // only see bookings the funnel recorded.
  const seenBookings = new Set((profile.enquiries || []).map((e) => e.bookingNo).filter(Boolean))
  for (const b of profile.bookings || []) {
    if (b.bookingNo && seenBookings.has(b.bookingNo)) continue
    push(out, b.bookingDate, 'sales', 'Booking created', b.model, null, b.bookingNo, {
      'Record Type': 'Direct Booking',
      'Booking Number': b.bookingNo,
      'Booking Date': iso(b.bookingDate),
      'Booked Model': b.model,
      'Sales Consultant': b.consultant,
      'Committed Delivery Date': iso(b.committedDeliveryDate),
    })
  }

  for (const r of profile.receipts || []) {
    push(out, r.receiptDate, 'sales', 'Payment received', r.model, null, null, {
      'Record Type': 'Payment Receipt',
      'Receipt Date': iso(r.receiptDate),
      'Model': r.model,
    })
  }

  for (const v of profile.vehicles || []) {
    const label = [v.model, v.registration].filter(Boolean).join(' · ') || v.vin
    push(out, v.invoiceDate, 'sales', 'Vehicle invoiced', label, v.vin, null, {
      'Record Type': 'Vehicle Tax Invoice',
      'Invoice Date': iso(v.invoiceDate),
      'Vehicle Model': v.model,
      'Registration Plate': v.registration,
      'Chassis / VIN': v.vin,
      'Delivery Date': iso(v.deliveryDate),
    })
    push(out, v.deliveryDate, 'sales', 'Vehicle delivered', label, v.vin, null, {
      'Record Type': 'Vehicle Handover / Delivery',
      'Delivery Date': iso(v.deliveryDate),
      'Invoice Date': iso(v.invoiceDate),
      'Vehicle Model': v.model,
      'Registration Plate': v.registration,
      'Chassis / VIN': v.vin,
    })

    if (v.insurance) {
      push(out, v.insurance.effectiveDate, 'insurance', 'Insurance policy started',
        [v.insurance.insurer, label].filter(Boolean).join(' · ') || null, v.vin, v.insurance.policyNo, {
          'Record Type': 'Insurance Policy Inception',
          'Policy Number': v.insurance.policyNo,
          'Insurance Company': v.insurance.insurer,
          'Policy Type': v.insurance.policyType,
          ...(v.insurance.previousInsurer ? { 'Previous Insurer': v.insurance.previousInsurer } : {}),
          ...(v.insurance.cancelled ? { 'Policy Cancelled': 'Yes — this policy is not in force' } : {}),
          // Gross is what the customer actually paid; net is before tax. Both are present on every
          // policy we hold, so no "not available" wording is needed here.
          /*
           * ⚠️ RAW numbers as well as the formatted strings. The insurance table's Premium column
           * reads `metadata.grossPremium`, and only the pre-formatted 'Premium Paid (incl. tax)'
           * key existed — so every policy showed "—" in that column while its premium was still
           * being counted into the header's Total Spend. The total looked invented.
           */
          grossPremium: v.insurance.grossPremium ?? null,
          policyNo: v.insurance.policyNo ?? null,
          insurer: v.insurance.insurer ?? null,
          'Premium Paid (incl. tax)': rupees(v.insurance.grossPremium, 'Not recorded'),
          'Net Premium': rupees(v.insurance.netPremium, 'Not recorded'),
          'Policy Inception Date': iso(v.insurance.effectiveDate),
          'Policy Expiry Date': iso(v.insurance.expiryDate),
          // A cancelled policy is not cover, whatever its expiry date says.
          'Current Policy Status': v.insurance.cancelled
            ? 'Cancelled'
            : v.insurance.lapsed ? 'Expired / Lapsed' : 'Active In-Force',
          'Vehicle Model': v.model,
          'Vehicle Registration': v.registration,
          'Chassis / VIN': v.vin,
        })
      // The expiry is a FUTURE event as often as a past one. It is included deliberately: a renewal
      // that has not happened yet is the single most actionable thing on this screen.
      push(out, v.insurance.expiryDate, 'insurance',
        v.insurance.lapsed ? 'Insurance expired' : 'Insurance expires',
        [v.insurance.insurer, label].filter(Boolean).join(' · ') || null, v.vin, v.insurance.policyNo, {
          'Record Type': 'Insurance Policy Expiry Milestone',
          'Policy Number': v.insurance.policyNo,
          'Insurance Company': v.insurance.insurer,
          // The premium on the EXPIRING policy — the number the renewal conversation starts from.
          grossPremium: v.insurance.grossPremium ?? null,
          policyNo: v.insurance.policyNo ?? null,
          insurer: v.insurance.insurer ?? null,
          'Premium Last Paid': rupees(v.insurance.grossPremium, 'Not recorded'),
          'Policy Expiry Date': iso(v.insurance.expiryDate),
          'Policy Inception Date': iso(v.insurance.effectiveDate),
          'Current Renewal Status': v.insurance.cancelled
            ? 'Cancelled — not in force'
            : v.insurance.lapsed ? 'Lapsed — Uninsured' : 'Active (Renewal Due Soon)',
          'Vehicle Model': v.model,
          'Vehicle Registration': v.registration,
          'Chassis / VIN': v.vin,
        })
    }

    for (const s of v.services || []) {
      /*
       * The bill, split the way the feed actually stores it.
       *
       * ⚠️ Tax is shown whenever labour or parts are, and that is not decoration: total_amt is
       * TAX-INCLUSIVE, and labour + parts alone reconciles to it on 0 of 3,313 billed rows while
       * labour + parts + tax reconciles on 3,300. Omitting the tax line would put three numbers on
       * screen that visibly refuse to add up to the total beside them.
       *
       * Discount appears only when there is one — it is non-zero on 394 rows, so an always-present
       * "Discount Rs 0" would be noise on 93% of visits. 'Other' is never shown at all: the column
       * is 0 on every one of the 5,711 rows.
       */
      const priced = s.amount !== null && s.amount !== undefined
      const jobCardRef = s.roNo || s.billNo || null
      push(out, s.billDate || s.roDate, 'service', 'Service visit',
        [s.model, s.registration].filter(Boolean).join(' · ') || label, v.vin, jobCardRef, {
          jobCard: jobCardRef,
          serviceType: s.workType || 'General Service',
          amount: s.amount,
          /*
           * The odometer at this visit and the distance since the previous one, as raw numbers for
           * the table column. Both are null when the feed holds no reading — about a third of
           * billed visits — and the table must render that absence rather than a 0.
           */
          odometer: s.mileage ?? null,
          kmSinceLast: s.mileageSinceLast ?? null,
          billAmount: s.amount,
          labour: s.labour,
          parts: s.parts,
          tax: s.tax,
          advisor: s.advisor,
          'Record Type': isNviVisit(s.workType)
            ? 'Pre-Delivery Inspection (NVI) — not a customer visit'
            : 'Workshop Repair Order (RO)',
          'Job Card Number': jobCardRef,
          'Work Type': s.workType,
          'Total Billed': s.billStatus === 'Cancel'
            ? `${rupees(s.amount)} — bill cancelled, excluded from totals`
            : rupees(s.amount),
          ...(s.billStatus === 'Payment Not Received' || s.billStatus === 'Partial Paymant Received'
            ? { 'Payment Status': `Marked '${s.billStatus}' in the DMS — outstanding amount not recorded` }
            : {}),
          ...(priced ? {
            'Labour': rupees(s.labour, '—'),
            'Parts': rupees(s.parts, '—'),
            'Tax': rupees(s.tax, '—'),
          } : {}),
          ...(s.discount ? { 'Discount Given': rupees(s.discount) } : {}),
          ...(s.mileage
            ? { 'Odometer at Visit': `${Math.round(s.mileage).toLocaleString('en-IN')} km` }
            : { 'Odometer at Visit': 'Not recorded on this job card' }),
          ...(s.mileageSinceLast
            ? { 'Distance Since Previous Visit': `${Math.round(s.mileageSinceLast).toLocaleString('en-IN')} km` }
            : {}),
          'Service Advisor': s.advisor,
          'Invoice / Bill Date': iso(s.billDate),
          'Job Card (RO) Date': iso(s.roDate),
          'Vehicle Model': s.model || v.model,
          'Registration Number': s.registration || v.registration,
          'Chassis / VIN': v.vin,
          'Facility': 'Authorized Dealer Workshop',
        })
    }
    /*
     * Accessory counter sales, one event per BILL rather than per line: the average vehicle has a
     * dozen lines, and a dozen near-identical timeline cards for one afternoon at the counter
     * buries every other event. The items themselves go in the metadata, where the breakdown grid
     * lists them.
     */
    const accessoryBills = new Map<string, { billDate: string | null; items: typeof v.accessories }>()
    for (const a of v.accessories || []) {
      const billKey = a.billNo || `${a.billDate || 'undated'}`
      if (!accessoryBills.has(billKey)) accessoryBills.set(billKey, { billDate: a.billDate, items: [] })
      accessoryBills.get(billKey)!.items.push(a)
    }
    for (const [billKey, bill] of accessoryBills) {
      const total = bill.items.map((a) => a.amount).filter((x): x is number => x !== null).reduce((a, b) => a + b, 0)
      const names = bill.items.map((a) => a.description).filter(Boolean) as string[]
      const shown = names.slice(0, 8)
      const itemsSummary = shown.join(', ') + (names.length > shown.length ? ` +${names.length - shown.length} more` : '')
      push(out, bill.billDate, 'accessories', 'Accessories purchased',
        itemsSummary || `${bill.items.length} item${bill.items.length === 1 ? '' : 's'}`,
        v.vin, bill.items[0]?.billNo || null, {
          amount: total > 0 ? total : null,
          items: itemsSummary,
          'Record Type': 'Accessory Counter Sale',
          // Only a REAL bill number is labelled as one — the grouping key falls back to the date,
          // and a date wearing a 'Bill No' label is a fabricated document reference.
          ...(bill.items[0]?.billNo ? { 'Bill No': bill.items[0].billNo } : {}),
          'Items': itemsSummary,
          'Total (incl. tax)': rupees(total, 'Not recorded'),
          'Vehicle Model': v.model,
          'Registration Number': v.registration,
          'Chassis / VIN': v.vin,
        },
        /*
         * The per-item breakdown the comment above has always promised. It was never actually
         * passed to the client — only the comma-joined `itemsSummary` string was — so the "breakdown
         * grid" it refers to could not exist. Quantities and per-line amounts come through here.
         */
        bill.items.map((a) => ({
          description: a.description || 'Accessory',
          qty: typeof a.qty === 'number' ? a.qty : null,
          amount: typeof a.amount === 'number' ? a.amount : null,
        })))
    }

    for (const c of v.complaints || []) {
      push(out, c.date, 'communication', 'Complaint raised', c.model || label, v.vin, c.complaintNo, {
        'Record Type': 'Customer Feedback / Complaint',
        'Complaint Ticket No': c.complaintNo,
        'Date Raised': iso(c.date),
        'Date Closed': iso(c.closeDate),
        'Ticket Status': c.closeDate ? 'Closed / Resolved' : 'Open / In-Progress',
        'Vehicle Model': c.model || v.model,
        'Chassis / VIN': v.vin,
      })
      push(out, c.closeDate, 'communication', 'Complaint closed', c.model || label, v.vin, c.complaintNo, {
        'Record Type': 'Customer Feedback Resolution',
        'Complaint Ticket No': c.complaintNo,
        'Date Closed': iso(c.closeDate),
        'Date Raised': iso(c.date),
        'Ticket Status': 'Closed / Resolved',
        'Vehicle Model': c.model || v.model,
        'Chassis / VIN': v.vin,
      })
    }
  }

  // Newest first, and stable within a day so a delivery never renders above the invoice that
  // produced it purely because of array order.
  // Collapse the double-counted handover before anything downstream counts or renders it.
  return dedupeSameEvent(out)
    .sort((a, b) => (a.date === b.date ? a.category.localeCompare(b.category) : b.date.localeCompare(a.date)))
}

/**
 * NVI is the dealership's own new-vehicle inspection before handover, not a customer visit.
 * Labelling it in the timeline stops a pre-delivery check reading as a workshop relationship.
 */
const isNviVisit = (workType: string | null | undefined): boolean =>
  String(workType || '').trim().toUpperCase() === 'NVI'

/** Only the categories that actually occur — see the note on TimelineCategory. */
export function availableCategories(events: TimelineEvent[]): TimelineCategory[] {
  const order: TimelineCategory[] = ['sales', 'insurance', 'service', 'accessories', 'communication']
  const present = new Set(events.map((e) => e.category))
  return order.filter((c) => present.has(c))
}

export type NextBestAction = {
  /** Lower sorts first. */
  priority: number
  urgency: 'overdue' | 'urgent' | 'soon' | 'watch'
  title: string
  reason: string
  vin: string | null
}

const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000)

/**
 * What should happen next for this customer.
 *
 * Derived from the same payload, in priority order. Deliberately conservative: every action names
 * the fact that produced it, so an employee can judge it rather than trust it. An action with no
 * supporting date is not emitted at all — a prompt nobody can verify is worse than no prompt.
 *
 * @param today injected so the output is testable and so a server/client clock difference cannot
 *   change what an employee is told to do.
 */
export function buildNextBestActions(profile: KiaCustomerProfile, today: Date = new Date()): NextBestAction[] {
  const actions: NextBestAction[] = []

  for (const v of profile.vehicles || []) {
    const label = [v.model, v.registration].filter(Boolean).join(' · ') || v.vin

    /*
     * The renewal prompt names the money. A renewal desk works its list by VALUE, not by date —
     * "expires in 12 days" is a chore, "Rs 28,092 of premium at risk in 12 days" is a priority.
     * grosspremium is populated on 100% of the policies we hold, so the fallback wording is rare.
     */
    const premiumNote = v.insurance?.grossPremium
      ? ` Last premium ${rupees(v.insurance.grossPremium)} — that renewal value is at risk.`
      : ''
    const expiry = iso(v.insurance?.expiryDate)
    if (v.insurance?.cancelled) {
      // A cancelled policy is not cover, whatever its expiry date says. Before this check, 17
      // cancelled policies rendered as live insurance and their expiry dates drove renewal prompts.
      actions.push({
        priority: 1, urgency: 'urgent', vin: v.vin,
        title: 'Policy cancelled',
        reason: `${label} — policy ${v.insurance.policyNo || ''} is marked cancelled in our book. The vehicle may be uninsured.`,
      })
    } else if (expiry) {
      const days = daysBetween(today, new Date(`${expiry}T00:00:00Z`))
      if (days < 0) {
        actions.push({
          priority: 1, urgency: 'overdue', vin: v.vin,
          title: 'Insurance has lapsed',
          reason: `${label} — expired ${Math.abs(days)} days ago on ${expiry}. The vehicle is uninsured.${premiumNote}`,
        })
      } else if (days <= 90) {
        actions.push({
          priority: days <= 7 ? 1 : 2,
          urgency: days <= 7 ? 'urgent' : 'soon', vin: v.vin,
          title: 'Insurance renewal due',
          reason: `${label} — expires in ${days} day${days === 1 ? '' : 's'} on ${expiry}.${premiumNote}`,
        })
      }
    } else if (v.invoiceDate) {
      // A car we sold with no policy on file. Stated as "none on record", never as "uninsured":
      // the insurance feed only covers policies sold through the dealership.
      actions.push({
        priority: 3, urgency: 'watch', vin: v.vin,
        title: 'No insurance on record',
        reason: `${label} — sold ${iso(v.invoiceDate)}, but no policy of ours is on file. They may be insured elsewhere.`,
      })
    }

    /*
     * The last REAL visit, never an NVI row. NVI is the dealership's own pre-delivery inspection,
     * stamped on delivery day — before this filter, 126 sold vehicles whose only workshop row was
     * that inspection looked "recently serviced" and the win-back prompt below never fired for
     * exactly the customers who have never once come in.
     */
    const lastRealVisit = (v.services || []).find((svc) => String(svc.workType || '').trim().toUpperCase() !== 'NVI')
    /*
     * Date the real visit the way the timeline does: billDate, then roDate. The earlier form fell
     * back to v.lastServiceDate when the found visit was undated — and lastServiceDate is the
     * UNFILTERED max, i.e. potentially the NVI delivery-day date this whole block exists to
     * exclude. A real visit with no date at all yields null, and the guard below then makes NO
     * claim rather than a wrong one.
     */
    const last = lastRealVisit ? iso(lastRealVisit.billDate ?? lastRealVisit.roDate) : null
    if (!lastRealVisit && v.invoiceDate) {
      const since = daysBetween(new Date(`${iso(v.invoiceDate)}T00:00:00Z`), today)
      if (since > 365) {
        actions.push({
          priority: 2, urgency: 'overdue', vin: v.vin,
          title: 'Never serviced with us',
          reason: v.nviOnly
            ? `${label} — sold ${Math.round(since / 365)} year(s) ago. Only our own pre-delivery inspection is on file; the customer has never come in.`
            : `${label} — sold ${Math.round(since / 365)} year(s) ago and has never come in.`,
        })
      }
    } else if (last) {
      const since = daysBetween(new Date(`${last}T00:00:00Z`), today)
      if (since > 365) {
        actions.push({
          priority: 2, urgency: 'overdue', vin: v.vin,
          title: 'Service win-back',
          reason: `${label} — last seen ${last}, ${Math.round(since / 30)} months ago.`,
        })
      } else if (since > 300) {
        actions.push({
          priority: 3, urgency: 'soon', vin: v.vin,
          title: 'Service due',
          reason: `${label} — last serviced ${last}.`,
        })
      }
    }

    for (const c of v.complaints || []) {
      if (c.date && !c.closeDate) {
        actions.push({
          priority: 1, urgency: 'urgent', vin: v.vin,
          title: 'Open complaint',
          reason: `${label} — raised ${iso(c.date)} and still open.`,
        })
      }
    }
  }

  /*
   * Bills the DMS says were never fully collected. The figure quoted is the BILLED value of those
   * bills — there is no amount-received or balance column anywhere in the feed, so an outstanding
   * amount cannot be computed and must never be implied. One customer in five carries at least one
   * such bill, and the advisor phoning about the next service deserves to know before offering a
   * courtesy.
   */
  const unpaid = (profile.vehicles || []).reduce(
    (acc, v) => {
      acc.count += v.unpaidCount || 0
      if (v.unpaidBilledTotal) acc.billed += v.unpaidBilledTotal
      return acc
    },
    { count: 0, billed: 0 },
  )
  if (unpaid.count > 0) {
    actions.push({
      priority: 2, urgency: 'soon', vin: null,
      title: 'Service bills not marked fully collected',
      reason: `${unpaid.count} bill${unpaid.count === 1 ? '' : 's'} of ${rupees(unpaid.billed, 'unrecorded value')} billed `
        + `${unpaid.count === 1 ? 'is' : 'are'} marked 'Payment Not Received' or 'Partial Paymant Received' in the DMS. `
        + `The amount actually outstanding is not recorded — check before offering anything free.`,
    })
  }

  // An enquiry that never became a booking, with nothing since. Only when they own no vehicle:
  // an existing owner enquiring again is a different conversation.
  const openEnquiries = (profile.enquiries || []).filter((e) => !e.bookingNo && !e.lostDate && e.enquiryDate)
  if (openEnquiries.length && !(profile.vehicles || []).length) {
    const newest = openEnquiries.map((e) => iso(e.enquiryDate)).filter(Boolean).sort().reverse()[0]!
    const since = daysBetween(new Date(`${newest}T00:00:00Z`), today)
    actions.push({
      priority: since > 60 ? 3 : 2,
      urgency: since > 60 ? 'watch' : 'soon',
      vin: null,
      title: since > 60 ? 'Cold enquiry — no booking' : 'Open enquiry to follow up',
      reason: `${openEnquiries.length} enquiry(s) with no booking. Latest ${newest}, ${since} days ago.`,
    })
  }

  const rank = { overdue: 0, urgent: 1, soon: 2, watch: 3 } as const
  return actions.sort((a, b) => a.priority - b.priority || rank[a.urgency] - rank[b.urgency])
}
