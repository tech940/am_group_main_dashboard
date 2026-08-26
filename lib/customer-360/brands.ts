import type { BranchValue } from '@/lib/branches'

/**
 * CUSTOMER 360 — the brand registry.
 *
 * The section is one route across every brand, so the question "what can this brand actually show?"
 * has to be answered somewhere explicit. It is answered HERE, once, and both the server and the UI
 * read it. The alternative — letting each panel discover at render time that its data is missing —
 * is how a customer ends up looking like they have never serviced with us when the truth is that we
 * cannot see their service history at all. Those are completely different statements and the UI must
 * never make the first one on the strength of the second.
 *
 * ── Why the brands differ ─────────────────────────────────────────────────────────────────────
 * Measured 2026-08-26 against live data, not assumed:
 *
 *   kia_sales_report          1,040 rows · VIN full        · contact_num1 real 1,040/1,040
 *   hyundai_sales_report     23,504 rows · VIN MASKED all  · contact_num1 real     0/23,504
 *   am_platinum_sales_report  6,465 rows · VIN MASKED all  · contact_num1 real     0/6,465
 *
 * The Hyundai and Platinum sales feeds arrive with the VIN reduced to its last five characters
 * ('**********54240') and the phone to its last four ('******6786'). Both are masked at the source
 * system, outside this repo, so no amount of work here recovers them.
 *
 * That matters because VIN is the ONLY key that reaches the workshop, insurance and complaint feeds.
 * Without it a Hyundai buyer cannot be joined to anything beyond the sale itself.
 *
 * ⚠️ A near-miss worth recording, so nobody re-derives it and ships it:
 * Hyundai's service feed (hyundai_ro_billing_report) is NOT masked — 143,816 rows with full VINs and
 * 143,806 real phones. It is tempting to join the masked sales row to it on the surviving
 * last-5-of-VIN plus last-4-of-phone, and that composite key looks excellent: 9,849 sales keys match
 * exactly one full VIN and ZERO match more than one. It was tested and REJECTED. Of those 9,848
 * matches only 6,846 agree with the buyer's own name; 3,002 (30.5%) name a different person
 * entirely — 'ARUN SUDHAN' matching to 'MANISH SHARMA'. The group averages 1.04 distinct names, so
 * this is not an artefact of picking the wrong row: the key itself is wrong about a third of the
 * time. A 30% chance of showing one customer another customer's repair history and spend is not a
 * feature, it is a data-protection incident.
 *
 * If the masking is ever lifted upstream, delete `salesOnly` for that brand and the existing KIA
 * reader path serves it unchanged.
 */

export type CustomerBrand = Extract<BranchValue, 'kia' | 'hyundai' | 'platinum'>

export type BrandCapabilities = {
  /** Enquiry funnel: enquiries, test drives, lost reasons. */
  enquiries: boolean
  /** Bookings raised before the sale. */
  bookings: boolean
  /** Workshop history joined to the customer's vehicle. */
  service: boolean
  /** Policies we hold for the vehicle. */
  insurance: boolean
  /** Complaint records. */
  complaints: boolean
  /** Payment receipts against a booking. */
  receipts: boolean
  /** A real, unmasked contact number. */
  phone: boolean
  /** A full VIN, and therefore a vehicle that can be joined to anything else. */
  vin: boolean
}

export type BrandConfig = {
  brand: CustomerBrand
  label: string
  /** The sales feed. Every brand has one; it is what makes somebody a customer at all. */
  salesTable: string
  capabilities: BrandCapabilities
  /**
   * Set when the brand can only ever show the sale. Rendered to the user verbatim, so it states the
   * cause rather than apologising — an employee who knows WHY a panel is empty can go and fix the
   * feed; one who is told "no data" concludes the customer is inactive.
   */
  salesOnly: string | null
}

const FULL: BrandCapabilities = {
  enquiries: true, bookings: true, service: true, insurance: true,
  complaints: true, receipts: true, phone: true, vin: true,
}

const SALES_ONLY: BrandCapabilities = {
  enquiries: false, bookings: false, service: false, insurance: false,
  complaints: false, receipts: false, phone: false, vin: false,
}

const MASKED_NOTE =
  'The sales feed for this brand arrives with the VIN and phone number already masked at source '
  + '(shown as **********54240 and ******6786). VIN is the only key that reaches the workshop, '
  + 'insurance and complaint records, so purchases are all that can be shown here. This is a limit '
  + 'of the incoming feed, not of the customer — they may well have serviced with us.'

export const CUSTOMER_BRANDS: Record<CustomerBrand, BrandConfig> = {
  kia: {
    brand: 'kia',
    label: 'AM Kia',
    salesTable: 'kia_sales_report',
    capabilities: FULL,
    salesOnly: null,
  },
  hyundai: {
    brand: 'hyundai',
    label: 'AM Hyundai',
    salesTable: 'hyundai_sales_report',
    capabilities: SALES_ONLY,
    salesOnly: MASKED_NOTE,
  },
  platinum: {
    brand: 'platinum',
    label: 'AM Platinum',
    // ⚠️ NOT platinum_sales_report — that table does not exist. The Platinum feed was renamed to the
    // am_ prefix; the same rename already broke customer identity resolution once.
    salesTable: 'am_platinum_sales_report',
    capabilities: SALES_ONLY,
    salesOnly: MASKED_NOTE,
  },
}

export const CUSTOMER_BRAND_LIST = Object.values(CUSTOMER_BRANDS)

export function isCustomerBrand(value: unknown): value is CustomerBrand {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CUSTOMER_BRANDS, value)
}

/** The brand to use when none was supplied. KIA is the only one with a full profile. */
export const DEFAULT_CUSTOMER_BRAND: CustomerBrand = 'kia'
