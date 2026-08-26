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
export type TimelineCategory = 'sales' | 'insurance' | 'service' | 'communication'

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

const push = (
  out: TimelineEvent[],
  date: string | null | undefined,
  category: TimelineCategory,
  title: string,
  detail: string | null = null,
  vin: string | null = null,
  reference: string | null = null,
  metadata?: Record<string, string | number | boolean | null | undefined>,
) => {
  const d = iso(date)
  if (!d) return
  out.push({ date: d, category, title, detail, vin, reference, metadata })
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
          'Policy Inception Date': iso(v.insurance.effectiveDate),
          'Policy Expiry Date': iso(v.insurance.expiryDate),
          'Current Policy Status': v.insurance.lapsed ? 'Expired / Lapsed' : 'Active In-Force',
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
          'Policy Expiry Date': iso(v.insurance.expiryDate),
          'Policy Inception Date': iso(v.insurance.effectiveDate),
          'Current Renewal Status': v.insurance.lapsed ? 'Lapsed — Uninsured' : 'Active (Renewal Due Soon)',
          'Vehicle Model': v.model,
          'Vehicle Registration': v.registration,
          'Chassis / VIN': v.vin,
        })
    }

    for (const s of v.services || []) {
      push(out, s.billDate || s.roDate, 'service', 'Service visit',
        [s.model, s.registration].filter(Boolean).join(' · ') || label, v.vin, null, {
          'Record Type': 'Workshop Repair Order (RO)',
          'Invoice / Bill Date': iso(s.billDate),
          'Job Card (RO) Date': iso(s.roDate),
          'Vehicle Model': s.model || v.model,
          'Registration Number': s.registration || v.registration,
          'Chassis / VIN': v.vin,
          'Facility': 'Authorized Dealer Workshop',
        })
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
  return out.sort((a, b) => (a.date === b.date ? a.category.localeCompare(b.category) : b.date.localeCompare(a.date)))
}

/** Only the categories that actually occur — see the note on TimelineCategory. */
export function availableCategories(events: TimelineEvent[]): TimelineCategory[] {
  const order: TimelineCategory[] = ['sales', 'insurance', 'service', 'communication']
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

    const expiry = iso(v.insurance?.expiryDate)
    if (expiry) {
      const days = daysBetween(today, new Date(`${expiry}T00:00:00Z`))
      if (days < 0) {
        actions.push({
          priority: 1, urgency: 'overdue', vin: v.vin,
          title: 'Insurance has lapsed',
          reason: `${label} — expired ${Math.abs(days)} days ago on ${expiry}. The vehicle is uninsured.`,
        })
      } else if (days <= 30) {
        actions.push({
          priority: days <= 7 ? 1 : 2,
          urgency: days <= 7 ? 'urgent' : 'soon', vin: v.vin,
          title: 'Insurance renewal due',
          reason: `${label} — expires in ${days} day${days === 1 ? '' : 's'} on ${expiry}.`,
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

    const last = iso(v.lastServiceDate)
    if (!last && v.invoiceDate) {
      const since = daysBetween(new Date(`${iso(v.invoiceDate)}T00:00:00Z`), today)
      if (since > 365) {
        actions.push({
          priority: 2, urgency: 'overdue', vin: v.vin,
          title: 'Never serviced with us',
          reason: `${label} — sold ${Math.round(since / 365)} year(s) ago and has never come in.`,
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
