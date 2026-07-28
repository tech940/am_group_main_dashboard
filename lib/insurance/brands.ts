// lib/insurance/brands.ts
//
// Single source of truth for the /insurance section's THREE brand feeds. Every physical table name,
// every physical column name, and every "this brand cannot do that" flag lives here — the four routes
// (summary, policies, filters, vehicles) and the client read from this map instead of hardcoding
// hyundai/platinum column names into sql.raw strings.
//
// WHY THIS FILE EXISTS: the three feeds are NOT the same shape. hyundai_insurance_policy_summary and
// am_platinum_insurance_policy_summary share a column vocabulary; kia_insurance does not — it has 50
// columns under different names, stores premiums as NUMERIC instead of TEXT, uses 'New'/'Renewal'
// instead of 'NEW'/'RENEWAL'/'ROLLOVER', and is missing 13 of the columns the feature reads. Before
// this map existed, `?type=kia` silently resolved to hyundai (a two-way fallback ternary in all four
// routes), so a KIA tab could never be added by "appending a branch".
//
// NOTE: intentionally free of `server-only`, following lib/brands/sales-stock-sources.ts. It is pure
// data plus string builders; it executes nothing. The CLIENT imports
// INSURANCE_BRANDS[brand].capabilities to decide which tabs, KPI cards, table columns and filter
// dropdowns to render at all.
//
// ALL FIGURES IN THE COMMENTS BELOW WERE MEASURED AGAINST THE LIVE DB ON 2026-07-28.

/* -------------------------------------------------------------------------- */
/* Brand identity                                                             */
/* -------------------------------------------------------------------------- */

export const INSURANCE_BRAND_IDS = ['hyundai', 'platinum', 'kia'] as const
export type InsuranceBrandId = (typeof INSURANCE_BRAND_IDS)[number]

export function isInsuranceBrandId(v: unknown): v is InsuranceBrandId {
  return typeof v === 'string' && (INSURANCE_BRAND_IDS as readonly string[]).includes(v)
}

/**
 * The ONLY place `?type=` is turned into a brand. Defaults to hyundai (the historical default) for
 * anything unrecognised, and normalises case/whitespace/array params so the four routes and the
 * client agree. Do NOT reintroduce the old `=== 'platinum' ? 'platinum' : 'hyundai'` ternary — it is
 * what made `?type=kia` render Hyundai data under a KIA heading.
 */
export function resolveBrand(param: string | string[] | null | undefined): InsuranceBrandId {
  const raw = Array.isArray(param) ? param[0] : param
  const v = (raw ?? '').trim().toLowerCase()
  return isInsuranceBrandId(v) ? v : 'hyundai'
}

/* -------------------------------------------------------------------------- */
/* Column vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every logical column the four routes reference, in one union. A brand's map MUST supply a key for
 * each — `null` means "this brand has no such column". Using Record<> (not Partial<>) is deliberate:
 * a forgotten key is a COMPILE error here rather than `undefined` interpolated into sql.raw, which
 * would emit `SELECT undefined FROM ...` at runtime.
 */
export type InsuranceColumnKey =
  // identity / keys
  | 'id'
  | 'rowHash'
  | 'policyNo'
  | 'proposalNo'
  | 'chassisNo'
  | 'engineNo'
  // parties
  | 'customerName'
  | 'insuranceCompany'
  | 'financerName'
  | 'rmName'
  | 'dpName'
  | 'subUser'
  | 'dealerCode'
  | 'mispName'
  // policy attributes
  | 'policyType'
  | 'productType' // KIA-ONLY. The OD/TP discriminator. See ODDiscriminator below.
  | 'paymentMode'
  | 'column64vbStatus'
  | 'addonOpted'
  | 'odTenure'
  | 'tpTenure'
  | 'currentNcbPercentage'
  // vehicle
  | 'modelName'
  | 'variantName'
  | 'fuelType'
  | 'mfgYear'
  | 'vehRegistNo'
  // money
  | 'grossPremium'
  | 'netPremium'
  | 'netOdPremiumA'
  | 'thirdPartyLiability'
  | 'addOnPremium'
  | 'serviceTax'
  | 'totalIdv'
  // dates
  | 'policyIssueDate'
  | 'policyStartDate'
  | 'odExpiryDate'
  // KIA-only extras (null on the other two)
  | 'cancelled'
  | 'cancelledDate'
  | 'endorsed'

export type InsuranceColumnMap = Record<InsuranceColumnKey, string | null>

/**
 * The name the API RESPONSE and the client use, regardless of brand. It happens to equal the Hyundai
 * physical name because Hyundai shipped first, and the client + CSV mappers read these keys off the
 * row (`r.policy_issue_date`, `r.dealer_code`, ...). KIA queries MUST alias back to these or every
 * mapper returns the literal string "undefined" — a silently poisoned dropdown, not an error.
 */
export const CANONICAL_COLUMN: Record<InsuranceColumnKey, string> = {
  id: 'id',
  rowHash: 'row_hash',
  policyNo: 'policy_no',
  proposalNo: 'proposal_no',
  chassisNo: 'chassis_no',
  engineNo: 'engine_no',
  customerName: 'customer_name',
  insuranceCompany: 'insurance_company',
  financerName: 'financer_name',
  rmName: 'rm_name',
  dpName: 'dp_name',
  subUser: 'sub_user',
  dealerCode: 'dealer_code',
  mispName: 'misp_name',
  policyType: 'policy_type',
  productType: 'product_type',
  paymentMode: 'payment_mode',
  column64vbStatus: 'column_64vb_status',
  addonOpted: 'addon_opted',
  odTenure: 'od_tenure',
  tpTenure: 'tp_tenure',
  currentNcbPercentage: 'current_ncb_percentage',
  modelName: 'model_name',
  variantName: 'variant_name',
  fuelType: 'fuel_type',
  mfgYear: 'mfg_year',
  vehRegistNo: 'veh_regist_no',
  grossPremium: 'gross_premium',
  netPremium: 'net_premium',
  netOdPremiumA: 'net_od_premium_a',
  thirdPartyLiability: 'third_party_liability',
  addOnPremium: 'add_on_premium',
  serviceTax: 'service_tax',
  totalIdv: 'total_idv',
  policyIssueDate: 'policy_issue_date',
  policyStartDate: 'policy_start_date',
  odExpiryDate: 'od_expiry_date',
  cancelled: 'cancelled',
  cancelledDate: 'cancelled_date',
  endorsed: 'endorsed',
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a brand's feed can actually answer. Every flag maps to a concrete surface that is HIDDEN when
 * false — never rendered as 0 / 0% / "NOT VERIFIED". On an MD-facing dashboard a zero is read as a
 * business result, not as a missing column: "64VB Compliance Rate 0%" is an accusation, and the
 * Policy Register would stamp a red "NOT VERIFIED" badge on all 1,366 KIA rows purely because the
 * field does not exist.
 */
export type InsuranceCapabilities = {
  /** 64VB Compliance KPI, the dealer-wise verified column, and the Policy Status dropdown. */
  has64vb: boolean
  /** Claim Incidence (NCB reset) KPI, and the vehicle row's currentNcb. */
  hasNcb: boolean
  /** A renewal event is an OWN-DAMAGE policy, not any policy row. See odDiscriminator. */
  hasOdTpSplit: boolean
  /** Sub-user / Branch breakdown tab + the "Dealer / Branch" filter. */
  hasSubUser: boolean
  /** Executive Performance tab (rm_name half). */
  hasRmName: boolean
  /** Executive Performance tab (dp_name fallback half). */
  hasDpName: boolean
  /** Top Financing Partners list + the financer filter. */
  hasFinancer: boolean
  /** Add-on analysis (ZD/CM/EP/RTI/KP/PB) + addon adoption %. */
  hasAddons: boolean
  /** Registration-number column, search arm and the vehicle sub-line. */
  hasRegistration: boolean
  /** The cross-dealer UNION, the "⇄ both" badge, the crossDealer filter, includeOther. */
  hasCrossDealerHistory: boolean
  /** A third ROLLOVER policy-type slice exists. */
  hasRollover: boolean
  /** Total IDV cards and per-model avg IDV. */
  hasIdv: boolean
  /** net_od_premium_a / third_party_liability / add_on_premium — the Revenue tab's premium split. */
  hasPremiumSplit: boolean
  /** Service Tax / GST KPI card. */
  hasServiceTax: boolean
  /** Proposal No column (register + CSV + search). */
  hasProposalNo: boolean
  /** A human dealer name to show beside dealer_code. */
  hasMispName: boolean
  /** More than one dealer_code in the feed — otherwise the dropdown is inert, not useful. */
  hasMultiDealer: boolean
  /** A real cancellation flag, so premium/retention can exclude cancelled policies. */
  hasCancelledFlag: boolean
  /** An endorsement flag. */
  hasEndorsedFlag: boolean
  /** Premium columns are NUMERIC (no text regex guard) rather than TEXT. */
  premiumIsNumeric: boolean
  /**
   * The 'LOST' cover-status bucket (expiry > 365 days ago) is REACHABLE. False for KIA: the earliest
   * policy_expiry_date in the whole table is 2026-01-08, so against CURRENT_DATE 2026-07-28 the
   * maximum achievable lapse is 201 days. Measured LOST = 0. Starts populating ~Jan 2027; until then
   * the pill and its filter SelectItem are a control that can only ever return nothing.
   */
  hasLostCoverBucket: boolean
  /**
   * `SET LOCAL work_mem = '64MB'` is worth its round-trip. TRUE for hyundai/platinum (measured
   * 2,318ms -> 765ms). FALSE for KIA: peak memory is 1,089 kB against a 4 MB default, nothing spills,
   * and at ~182ms pooler RTT the extra statement is roughly HALF the endpoint's total latency for
   * zero benefit (KPI query: 15ms execution, 189ms wall).
   */
  needsLargeWorkMem: boolean
}

/* -------------------------------------------------------------------------- */
/* Policy-type literals                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The feed's own spelling. KIA stores Title Case and has no rollover at all; the other two store
 * SCREAMING CASE. Every `policy_type = 'RENEWAL'` literal in the routes must come from here or it
 * scores a silent ZERO on KIA — including the one NEGATIVE comparison in the vehicles route
 * (`first_event_type <> 'NEW'`), where 'New' <> 'NEW' is TRUE. MEASURED: with the inherited 'NEW'
 * literal, history_left_censored is 1,141 of 1,141 (100%); with the correct 'New' it is 355 (31%).
 * A plausible-looking number, not an error.
 */
export type PolicyTypeLiterals = {
  new: string
  renewal: string
  rollover: string | null
}

/* -------------------------------------------------------------------------- */
/* OD / TP discriminator                                                      */
/* -------------------------------------------------------------------------- */

/**
 * HOW a brand tells an own-damage (renewal-bearing) policy from a standalone third-party / CPA
 * top-up. All three feeds CAN do this — they just do it with different columns.
 *
 *   hyundai/platinum : od_tenure <> '0'
 *   kia              : producttype = 'Addon'
 *
 * The KIA discriminator was NOT in the original brief (which asserted "no OD/TP split, so one row =
 * one event"). It is proven, three ways, against the live table:
 *
 *  1. POPULATION.  producttype='Addon' = 1,341 rows, gross 5,952..152,638, avg 28,763.
 *                  producttype='Standard' = 25 rows, gross 3,149..12,940, avg 5,608.
 *                  No comprehensive policy on a Seltos costs Rs 4,090; the cheapest Addon row is 5,952.
 *  2. TYPE PAIRING. All 25 'Standard' rows are policytype='Renewal'; not one is 'New'. A standalone
 *                  TP top-up is never booked as a new-vehicle policy.
 *  3. GAP CLEANUP (decisive). Consecutive policies per VIN, cancelled excluded:
 *                  ALL ROWS   : <30d = 12 (min 1, max 12) | 30-299d = 3 | 300-430d = 182 | >430d = 1
 *                  Addon ONLY : <30d = 0  | 30-299d = 0    | 300-430d = 182 (min 365, max 393) | >430d = 1
 *                  Applying the filter removes EVERY sub-300-day gap and leaves a clean annual-renewal
 *                  distribution. That is precisely the effect od_tenure produces on Hyundai, and it is
 *                  the error the shipped route comment was written to prevent.
 *
 * Consequence: KIA repeat vehicles = 183 (not 196), retention = 16.0% (not 17.0%), switched insurer =
 * 139 (not 148), tp_only_policies = 25 across 25 vehicles, and the 'TP_ONLY' cover bucket has 10 real
 * members. The 13-vehicle difference is entirely cars that bought a TP top-up days after their
 * comprehensive policy IN THE SAME YEAR — counting that as "came back for renewal" is wrong, and it is
 * what makes the "Renewals" column mean the SAME thing on all three brands. Which is what was asked for.
 */
export type OdDiscriminator =
  | { kind: 'odTenure' }
  | { kind: 'productTypeEquals'; value: string }

/* -------------------------------------------------------------------------- */
/* Brand definition                                                           */
/* -------------------------------------------------------------------------- */

export type InsuranceBrand = {
  id: InsuranceBrandId
  /** Physical table. Interpolated into sql.raw — never user-derived. */
  table: string
  /** Toggle pill + heading text. */
  label: string
  /** Short pill label. */
  shortLabel: string
  columns: InsuranceColumnMap
  capabilities: InsuranceCapabilities
  policyTypes: PolicyTypeLiterals
  odDiscriminator: OdDiscriminator
  /**
   * Brands whose tables are unioned when computing a vehicle's LIFETIME history. Hyundai and Platinum
   * are one group (492 chassis appear in both; computing per-table flags 375 live vehicles as lost).
   * KIA is alone — a different marque, measured ZERO VIN overlap with the Hyundai table — so unioning
   * it would only add rows that can never join.
   */
  historyPeers: readonly InsuranceBrandId[]
  /** First policy in the feed (ISO). Drives the retention footnote; do not hardcode in the client. */
  historyStartDate: string
  /** Human form of the above, for captions. */
  historyStartLabel: string
  /** Fallback date-range pill text, replacing the hardcoded '01 Dec 2022 - Today'. */
  dateRangeFallbackLabel: string
  /**
   * One line, shown once under the KPI rail, naming everything hidden for this brand. This is the
   * price of the hide-don't-zero rule: silently removing the 64VB card leaves an MD who knows the
   * Hyundai page wondering whether KIA is non-compliant or merely unmeasured.
   */
  gapDisclosure: string | null
  /** Per-brand wording for the retention tab, whose scope sentence said "both dealerships". */
  retentionScopeNote: string
  /**
   * Replaces the static "Cars that renewed with us at least once" caption ON the Vehicle Retention
   * Rate card. This is the one number that is REAL but MISLEADING by comparison, so it is captioned
   * rather than hidden.
   */
  retentionRateCaption: string
  /** Per-brand definition of the "Renewals" column + the lifetime-premium basis. Tab footnote. */
  renewalEventNote: string
}

/* -------------------------------------------------------------------------- */

const HYUNDAI_PLATINUM_COLUMNS: InsuranceColumnMap = {
  id: 'id',
  rowHash: 'row_hash',
  policyNo: 'policy_no',
  proposalNo: 'proposal_no',
  chassisNo: 'chassis_no',
  engineNo: 'engine_no',
  customerName: 'customer_name',
  insuranceCompany: 'insurance_company',
  financerName: 'financer_name',
  rmName: 'rm_name',
  dpName: 'dp_name',
  subUser: 'sub_user',
  dealerCode: 'dealer_code',
  mispName: 'misp_name',
  policyType: 'policy_type',
  productType: null, // these feeds discriminate OD/TP via od_tenure
  paymentMode: 'payment_mode',
  column64vbStatus: 'column_64vb_status',
  addonOpted: 'addon_opted',
  odTenure: 'od_tenure',
  tpTenure: 'tp_tenure',
  currentNcbPercentage: 'current_ncb_percentage',
  modelName: 'model_name',
  variantName: 'variant_name',
  fuelType: 'fuel_type',
  mfgYear: 'mfg_year',
  vehRegistNo: 'veh_regist_no',
  grossPremium: 'gross_premium',
  netPremium: 'net_premium',
  netOdPremiumA: 'net_od_premium_a',
  thirdPartyLiability: 'third_party_liability',
  addOnPremium: 'add_on_premium',
  serviceTax: 'service_tax',
  totalIdv: 'total_idv',
  policyIssueDate: 'policy_issue_date',
  policyStartDate: 'policy_start_date',
  odExpiryDate: 'od_expiry_date',
  // Neither feed carries a cancellation or endorsement flag; premium is gross of any cancellation.
  cancelled: null,
  cancelledDate: null,
  endorsed: null,
}

const HYUNDAI_PLATINUM_CAPABILITIES: InsuranceCapabilities = {
  has64vb: true,
  hasNcb: true,
  hasOdTpSplit: true,
  hasSubUser: true,
  hasRmName: true,
  hasDpName: true,
  hasFinancer: true,
  hasAddons: true,
  hasRegistration: true,
  hasCrossDealerHistory: true,
  hasRollover: true,
  hasIdv: true,
  hasPremiumSplit: true,
  hasServiceTax: true,
  hasProposalNo: true,
  hasMispName: true,
  hasMultiDealer: true,
  hasCancelledFlag: false,
  hasEndorsedFlag: false,
  // gross_premium / net_premium / net_od_premium_a / third_party_liability / add_on_premium are all
  // TEXT here (confirmed via information_schema) — hence the '^-?\d+(\.\d+)?$' guard before ::numeric.
  premiumIsNumeric: false,
  hasLostCoverBucket: true,
  needsLargeWorkMem: true,
}

const SCREAMING_POLICY_TYPES: PolicyTypeLiterals = { new: 'NEW', renewal: 'RENEWAL', rollover: 'ROLLOVER' }

/* -------------------------------------------------------------------------- */

export const INSURANCE_BRANDS: Record<InsuranceBrandId, InsuranceBrand> = {
  hyundai: {
    id: 'hyundai',
    table: 'hyundai_insurance_policy_summary',
    label: 'Hyundai Insurance',
    shortLabel: 'Hyundai',
    columns: HYUNDAI_PLATINUM_COLUMNS,
    capabilities: HYUNDAI_PLATINUM_CAPABILITIES,
    policyTypes: SCREAMING_POLICY_TYPES,
    odDiscriminator: { kind: 'odTenure' },
    historyPeers: ['hyundai', 'platinum'],
    historyStartDate: '2022-12-27',
    historyStartLabel: '27 Dec 2022',
    dateRangeFallbackLabel: '27 Dec 2022 - Today',
    gapDisclosure: null,
    retentionScopeNote: 'all years, all insurers, and both dealerships',
    retentionRateCaption: 'Cars that renewed with us at least once',
    renewalEventNote:
      'Records begin 27 Dec 2022. A renewal event is an own-damage policy (od_tenure > 0), not a ' +
      'policy row. Lifetime premium is gross of any cancellation — this feed carries no cancellation flag.',
  },

  platinum: {
    id: 'platinum',
    table: 'am_platinum_insurance_policy_summary',
    label: 'Platinum Insurance',
    shortLabel: 'Platinum',
    columns: HYUNDAI_PLATINUM_COLUMNS,
    capabilities: HYUNDAI_PLATINUM_CAPABILITIES,
    policyTypes: SCREAMING_POLICY_TYPES,
    odDiscriminator: { kind: 'odTenure' },
    historyPeers: ['hyundai', 'platinum'],
    historyStartDate: '2022-12-27',
    historyStartLabel: '27 Dec 2022',
    dateRangeFallbackLabel: '27 Dec 2022 - Today',
    gapDisclosure: null,
    retentionScopeNote: 'all years, all insurers, and both dealerships',
    retentionRateCaption: 'Cars that renewed with us at least once',
    renewalEventNote:
      'Records begin 27 Dec 2022. A renewal event is an own-damage policy (od_tenure > 0), not a ' +
      'policy row. Lifetime premium is gross of any cancellation — this feed carries no cancellation flag.',
  },

  kia: {
    id: 'kia',
    table: 'kia_insurance',
    label: 'Kia Insurance',
    shortLabel: 'Kia',

    // 50 columns / 1,366 rows / 1,157 distinct vinno / 1,169 distinct customer_name.
    columns: {
      id: 'id',
      rowHash: 'row_hash',
      policyNo: 'policyno',
      // ABSENT. quotation_no is a DIFFERENT document (a quote, not a proposal) and is populated on
      // only 315/1,366 rows (23%) — it would leave 77% of the register blank. Not a substitute.
      proposalNo: null,
      chassisNo: 'vinno',
      engineNo: 'engineno', // note: no underscore, unlike the other two feeds
      customerName: 'customer_name',
      insuranceCompany: 'insurancecompany',
      // ABSENT. No financing/hypothecation party of any kind in this feed.
      financerName: null,
      // ABSENT. kia_insurance carries no salesperson identity at all — no RM, no DP, no advisor.
      rmName: null,
      dpName: null,
      // ABSENT. No branch/sub-user column.
      subUser: null,
      dealerCode: 'dealercode',
      // ABSENT. The nearest column, `dealer`, reads 'PLATINUM AUTOMOBILES PRIVATE LIMITED' on every
      // row — the wrong entity to surface under a KIA heading, so deliberately not mapped.
      mispName: null,
      policyType: 'policytype',
      // THE OD/TP DISCRIMINATOR. 'Addon' = 1,341 comprehensive, 'Standard' = 25 standalone TP/CPA.
      productType: 'producttype',
      paymentMode: 'paymentmode',
      // ABSENT. No 64VB (premium-remittance) compliance status column.
      column64vbStatus: null,
      // ABSENT. No add-on / cover-opted column.
      addonOpted: null,
      // ABSENT. Superseded by odDiscriminator: { kind: 'productTypeEquals', value: 'Addon' }.
      // btrim(numeric) throws 42883, so no KIA numeric column is a workaround for these either.
      odTenure: null,
      tpTenure: null,
      // ABSENT. `ncb_slab_per` is NOT a substitute: NUMERIC and NULL on all 1,366 rows, and
      // regexp_replace(numeric,...) throws 42883 anyway.
      currentNcbPercentage: null,
      modelName: 'model',
      variantName: 'variant',
      fuelType: 'fueltype',
      mfgYear: 'mfg_year', // text, 100% filled — and the corroborator for history_left_censored
      // PRESENT BUT EMPTY on all 1,366 rows (0 filled). Mapped so the column resolves, but gated off
      // by capabilities.hasRegistration — an ILIKE against it is a permanently dead search arm.
      vehRegistNo: 'veh_regist_no',
      grossPremium: 'grosspremium', // NUMERIC
      netPremium: 'netpremium', // NUMERIC
      // PRESENT BUT ZERO on all 1,366 rows. Mapped, but gated off by hasPremiumSplit — worse than
      // missing, because it compiles and returns a confident Rs 0.
      netOdPremiumA: 'netodpremiuma',
      thirdPartyLiability: null, // ABSENT
      addOnPremium: null, // ABSENT
      // ABSENT. igst+cgst+sgst exist (measured 22,03,267 / 0 / 22,03,267) but ugst is NULL on all
      // rows, so a naive 4-way sum evaluates to NULL; the split is unverified, so no card.
      serviceTax: null,
      // PRESENT BUT ZERO on all 1,366 rows. Same trap as netodpremiuma; gated off by hasIdv.
      totalIdv: 'totalidv',
      policyIssueDate: 'create_date',
      policyStartDate: 'policy_effective_date',
      // 100% populated here, 0 NULLs (vs Hyundai's policy_expiry_date at 0/25,360), so cover status is
      // MORE trustworthy on KIA than on either existing brand. Note it is WHOLE-POLICY expiry, not OD
      // expiry — relabel the record inspector's "OD Expiry Date" field for this brand.
      odExpiryDate: 'policy_expiry_date',
      // KIA-only, and genuinely useful: 17 cancelled of 1,366, 0 NULL.
      cancelled: 'cancelled',
      cancelledDate: 'cancelled_date',
      endorsed: 'endorsed', // KIA-only: 69 endorsed of 1,366
    },

    capabilities: {
      // column_64vb_status does not exist in kia_insurance.
      has64vb: false,
      // current_ncb_percentage does not exist; ncb_slab_per is NULL on all 1,366 rows.
      hasNcb: false,
      // TRUE — via producttype, not od_tenure. See OdDiscriminator for the three proofs.
      hasOdTpSplit: true,
      hasSubUser: false, // sub_user does not exist
      hasRmName: false, // rm_name does not exist
      hasDpName: false, // dp_name does not exist
      hasFinancer: false, // financer_name does not exist
      hasAddons: false, // addon_opted does not exist
      // veh_regist_no exists but is EMPTY on all 1,366 rows (0 filled).
      hasRegistration: false,
      // Zero VIN overlap with the Hyundai/Platinum tables — a different marque. The union would not
      // merely be wrong, it would be empty.
      hasCrossDealerHistory: false,
      // Only two policytype values exist: 'New' (802) and 'Renewal' (564). No ROLLOVER.
      hasRollover: false,
      hasIdv: false, // totalidv = 0 on all 1,366 rows
      // netodpremiuma = 0 on all 1,366 rows; third_party_liability and add_on_premium do not exist.
      hasPremiumSplit: false,
      hasServiceTax: false, // service_tax absent; igst/cgst/sgst/ugst split unverified
      hasProposalNo: false, // proposal_no absent; quotation_no only 23% filled
      hasMispName: false, // misp_name absent; `dealer` names the wrong entity
      // dealercode = 'JK402' on all 1,366 rows (1 distinct). The dropdown would offer one inert
      // option and falsely imply a multi-branch KIA structure.
      hasMultiDealer: false,
      hasCancelledFlag: true, // 'No' 1,349 / 'Yes' 17
      hasEndorsedFlag: true, // 'No' 1,297 / 'Yes' 69
      // grosspremium/netpremium/netodpremiuma/totalidv/ncb_slab_per/oddiscount are all NUMERIC.
      // TESTED: the text guard `grosspremium ~ '^-?\d+(\.\d+)?$'` raises SQLSTATE 42883
      // "operator does not exist: numeric ~ unknown" at PARSE time — the statement never executes,
      // so COALESCE/safeNum cannot absorb it and the whole Promise.all rejects into a 500.
      premiumIsNumeric: true,
      // MIN(policy_expiry_date) = 2026-01-08; max achievable lapse today is 201 days < 365. LOST = 0.
      hasLostCoverBucket: false,
      // Peak 1,089 kB vs a 4 MB default. The SET LOCAL is a wasted round-trip (~182ms of a 189ms call).
      needsLargeWorkMem: false,
    },

    // Measured: exactly two values, 'New' (802) and 'Renewal' (564).
    policyTypes: { new: 'New', renewal: 'Renewal', rollover: null },

    odDiscriminator: { kind: 'productTypeEquals', value: 'Addon' },

    historyPeers: ['kia'],
    historyStartDate: '2025-01-09',
    historyStartLabel: 'Jan 2025',
    dateRangeFallbackLabel: '09 Jan 2025 - Today',

    gapDisclosure:
      'Kia feed: no 64VB status, no executive/RM attribution, no financer, no add-on detail, ' +
      'no OD/TP premium split, no IDV and no registration numbers. History begins Jan 2025.',
    retentionScopeNote: 'all years and all insurers',
    retentionRateCaption:
      'Since Jan 2025 — under two renewal cycles. Not comparable with Hyundai or Platinum.',
    renewalEventNote:
      'Records begin 09 Jan 2025 — barely one renewal cycle on an annual product, so retention here ' +
      'is a measure of how much history exists, not of customer loyalty. A renewal event is an ' +
      'own-damage policy (Product Type "Addon"), matching the Hyundai and Platinum definition; the 25 ' +
      'standalone third-party top-ups are shown as "+n TP" and are not counted as renewals. Lifetime ' +
      'premium here EXCLUDES the 17 cancelled policies, so it is Rs 6,23,040 lower than the Overview ' +
      'gross-premium card, which shows the register total.',
  },
}

/* -------------------------------------------------------------------------- */
/* SQL helpers                                                                */
/* -------------------------------------------------------------------------- */

/** The TEXT-brand guard. Only ever applied when capabilities.premiumIsNumeric is false. */
const NUMERIC_TEXT_GUARD = '^-?\\d+(\\.\\d+)?$'

export function brandOf(brand: InsuranceBrandId | InsuranceBrand): InsuranceBrand {
  return typeof brand === 'string' ? INSURANCE_BRANDS[brand] : brand
}

/** True when this brand physically has the column. Gate every optional surface on this or a flag. */
export function hasCol(brand: InsuranceBrandId | InsuranceBrand, key: InsuranceColumnKey): boolean {
  return brandOf(brand).columns[key] !== null
}

/**
 * Physical column name, or THROW. Throwing is deliberate: returning '' or the canonical name would
 * emit `SELECT undefined`/`SELECT rm_name` against kia_insurance and surface as an opaque 42703. The
 * throw is caught by each route's try/catch and names the brand and key.
 */
export function col(brand: InsuranceBrandId | InsuranceBrand, key: InsuranceColumnKey): string {
  const b = brandOf(brand)
  const name = b.columns[key]
  if (name === null) {
    throw new Error(
      `[insurance:brands] '${b.id}' has no column for '${key}'. Gate this surface on ` +
        `INSURANCE_BRANDS.${b.id}.capabilities before building SQL.`,
    )
  }
  return name
}

/** Physical column, table-qualified (e.g. `t.create_date`). */
export function qcol(brand: InsuranceBrandId | InsuranceBrand, key: InsuranceColumnKey, alias: string): string {
  return `${alias}.${col(brand, key)}`
}

/** `<physical> AS <canonical>` — the alias is what stops the client mappers reading `undefined`. */
export function selectAs(
  brand: InsuranceBrandId | InsuranceBrand,
  key: InsuranceColumnKey,
  as: string = CANONICAL_COLUMN[key],
): string {
  const physical = col(brand, key)
  return physical === as ? physical : `${physical} AS ${as}`
}

/**
 * A SELECT list from logical keys. Keys the brand lacks are SKIPPED by default (the client hides
 * those columns via capabilities). Pass fillAbsentWithNull to keep a stable response shape instead —
 * required for any UNION arm, where every arm must have identical arity.
 */
export function selectList(
  brand: InsuranceBrandId | InsuranceBrand,
  keys: readonly InsuranceColumnKey[],
  opts: { fillAbsentWithNull?: boolean; alias?: string } = {},
): string {
  const b = brandOf(brand)
  const prefix = opts.alias ? `${opts.alias}.` : ''
  const parts: string[] = []
  for (const key of keys) {
    const physical = b.columns[key]
    const canonical = CANONICAL_COLUMN[key]
    if (physical === null) {
      if (opts.fillAbsentWithNull) parts.push(`NULL AS ${canonical}`)
      continue
    }
    parts.push(`${prefix}${physical}` === canonical ? canonical : `${prefix}${physical} AS ${canonical}`)
  }
  return parts.join(', ')
}

/**
 * A per-row numeric premium expression.
 *
 * TEXT brands keep the regex guard (their premium columns really are TEXT and hold junk). KIA MUST
 * NOT have it: `numeric ~ unknown` is resolved at PARSE time and raises 42883, so one guarded query
 * inside summary/route.ts's single Promise.all takes the entire dashboard to a 500 — 12 of the 15
 * queries reference a guarded premium column, so the tab would be blank, not partly populated.
 *
 * Verified equal on kia_insurance: plain SUM = 38,710,728 and cast-guarded SUM = 38,710,728. The
 * plain form is preferred; casting numeric::text just to re-parse it is pointless overhead and
 * mis-handles scientific-notation rendering.
 */
export function premiumExpr(brand: InsuranceBrandId | InsuranceBrand, key: InsuranceColumnKey, alias?: string): string {
  const b = brandOf(brand)
  return premiumGuard(b, alias ? `${alias}.${col(b, key)}` : col(b, key))
}

/**
 * The same guard applied to an ARBITRARY sql reference rather than a brand column.
 *
 * Needed inside the vehicles CTE chain, where hist_all has already aliased the physical column to its
 * CANONICAL name — there, `h.gross_premium` is correct for all three brands and premiumExpr() would
 * wrongly emit `h.grosspremium` and 42703. Rule of thumb: premiumExpr() against a base table,
 * premiumGuard() against anything downstream of hist_all. Same rule for qcol / isOdExpr /
 * activeRowsPredicate — all are BASE-TABLE ONLY; use the *Hist variants downstream.
 */
export function premiumGuard(brand: InsuranceBrandId | InsuranceBrand, ref: string): string {
  if (brandOf(brand).capabilities.premiumIsNumeric) return `COALESCE(${ref}, 0)`
  return `CASE WHEN ${ref} ~ '${NUMERIC_TEXT_GUARD}' THEN ${ref}::numeric ELSE 0 END`
}

/** `COALESCE(SUM(<premiumExpr>), 0)`. */
export function premiumSum(brand: InsuranceBrandId | InsuranceBrand, key: InsuranceColumnKey, alias?: string): string {
  return `COALESCE(SUM(${premiumExpr(brand, key, alias)}), 0)`
}

/**
 * `COALESCE(AVG(...), 0)`. NULL-skipping, matching the existing route: the TEXT brands average only
 * rows that parse, so junk rows are excluded rather than averaged in as zero.
 */
export function premiumAvg(brand: InsuranceBrandId | InsuranceBrand, key: InsuranceColumnKey, alias?: string): string {
  const b = brandOf(brand)
  const ref = alias ? `${alias}.${col(b, key)}` : col(b, key)
  if (b.capabilities.premiumIsNumeric) return `COALESCE(AVG(${ref}), 0)`
  return `COALESCE(AVG(CASE WHEN ${ref} ~ '${NUMERIC_TEXT_GUARD}' THEN ${ref}::numeric END), 0)`
}

/** Single-quote escape for any literal that reaches sql.raw. */
export const esc = (v: string) => v.replace(/'/g, "''")

/** The feed's own spelling of a policy type. Returns null for a category the brand does not have. */
export function policyTypeLiteral(
  brand: InsuranceBrandId | InsuranceBrand,
  kind: keyof PolicyTypeLiterals,
): string | null {
  return brandOf(brand).policyTypes[kind]
}

/** `COUNT(CASE WHEN <policy_type> = '<literal>' THEN 1 END)::int`, or a literal 0 for a missing category. */
export function policyTypeCount(
  brand: InsuranceBrandId | InsuranceBrand,
  kind: keyof PolicyTypeLiterals,
  alias?: string,
): string {
  const b = brandOf(brand)
  const literal = b.policyTypes[kind]
  if (literal === null) return '0'
  const ref = alias ? `${alias}.${col(b, 'policyType')}` : col(b, 'policyType')
  return `COUNT(CASE WHEN ${ref} = '${esc(literal)}' THEN 1 END)::int`
}

/**
 * "Is this row an own-damage (renewal-bearing) policy?" — against the BASE TABLE.
 * hyundai/platinum: od_tenure <> '0'.  kia: producttype = 'Addon'.
 */
export function isOdExpr(brand: InsuranceBrandId | InsuranceBrand, alias?: string): string {
  const b = brandOf(brand)
  const p = alias ? `${alias}.` : ''
  if (b.odDiscriminator.kind === 'productTypeEquals') {
    return `(${p}${col(b, 'productType')} = '${esc(b.odDiscriminator.value)}')`
  }
  return `(COALESCE(NULLIF(btrim(${p}${col(b, 'odTenure')}),''),'0') <> '0')`
}

/**
 * Same test, but against CANONICAL names — i.e. anywhere downstream of the vehicles route's hist_all
 * CTE, which has already aliased od_tenure/product_type to their canonical spellings.
 */
export function isOdExprHist(brand: InsuranceBrandId | InsuranceBrand, alias = 'h'): string {
  const b = brandOf(brand)
  if (b.odDiscriminator.kind === 'productTypeEquals') {
    return `(${alias}.${CANONICAL_COLUMN.productType} = '${esc(b.odDiscriminator.value)}')`
  }
  return `(COALESCE(NULLIF(btrim(${alias}.${CANONICAL_COLUMN.odTenure}),''),'0') <> '0')`
}

/**
 * Rows to exclude from premium and retention maths, against the BASE TABLE. Only KIA can express
 * this; the other two feeds carry no cancellation flag, so their premium is gross of any cancellation
 * (state that in the footnote rather than pretending otherwise).
 *
 * IS DISTINCT FROM, not <>, so a NULL cancelled value is retained (measured 0 NULLs today; the guard
 * costs nothing and survives a future feed change).
 */
export function activeRowsPredicate(brand: InsuranceBrandId | InsuranceBrand, alias?: string): string {
  const b = brandOf(brand)
  if (!b.capabilities.hasCancelledFlag) return 'TRUE'
  const ref = alias ? `${alias}.${col(b, 'cancelled')}` : col(b, 'cancelled')
  return `${ref} IS DISTINCT FROM 'Yes'`
}

/** The tables whose union forms a vehicle's lifetime history. Single-element for KIA. */
export function historyTables(brand: InsuranceBrandId | InsuranceBrand): { id: InsuranceBrandId; table: string }[] {
  return brandOf(brand).historyPeers.map((id) => ({ id, table: INSURANCE_BRANDS[id].table }))
}

/**
 * The hist_all projection, in a fixed order. Absent keys are filled with NULL so every UNION arm has
 * identical arity — required for hyundai+platinum, harmless for KIA's single arm.
 */
export const HISTORY_COLUMN_KEYS: readonly InsuranceColumnKey[] = [
  'id',
  'chassisNo',
  'policyStartDate',
  'policyIssueDate',
  'odExpiryDate',
  'policyType',
  'insuranceCompany',
  'customerName',
  'vehRegistNo',
  'modelName',
  'variantName',
  'fuelType',
  'mfgYear',
  'totalIdv',
  'currentNcbPercentage',
  'grossPremium',
  'odTenure',
  'productType',
]

/** The cover-status buckets this brand can actually reach. Drives the pills and the filter list. */
export const ALL_COVER_STATUSES = ['ACTIVE', 'EXPIRING_30', 'EXPIRING_90', 'LAPSED', 'LOST', 'TP_ONLY'] as const
export type CoverStatus = (typeof ALL_COVER_STATUSES)[number]

export function coverStatuses(brand: InsuranceBrandId | InsuranceBrand): CoverStatus[] {
  const c = brandOf(brand).capabilities
  return ALL_COVER_STATUSES.filter((s) => {
    if (s === 'LOST' && !c.hasLostCoverBucket) return false
    if (s === 'TP_ONLY' && !c.hasOdTpSplit) return false
    return true
  })
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The policy register's sortable fields, keyed by the CANONICAL name the client already sends.
 * policies/route.ts interpolates the chosen field straight into ORDER BY, and its default is
 * 'policy_issue_date' — unmapped, the very FIRST KIA request 500s with 42703 before any filter is
 * touched. That is why this translates rather than merely allow-lists.
 */
export const SORTABLE_COLUMN_KEYS: Record<string, InsuranceColumnKey> = {
  policy_issue_date: 'policyIssueDate',
  policy_start_date: 'policyStartDate',
  od_expiry_date: 'odExpiryDate',
  gross_premium: 'grossPremium',
  net_premium: 'netPremium',
  customer_name: 'customerName',
  policy_no: 'policyNo',
  insurance_company: 'insuranceCompany',
  model_name: 'modelName',
}

export const DEFAULT_SORT_FIELD = 'policy_issue_date'

/** Canonical sort field -> this brand's physical column. Falls back to the default, never to input. */
export function resolveSortColumn(
  brand: InsuranceBrandId | InsuranceBrand,
  requested: string | null | undefined,
): string {
  const key = SORTABLE_COLUMN_KEYS[requested ?? ''] ?? SORTABLE_COLUMN_KEYS[DEFAULT_SORT_FIELD]
  return col(brand, key)
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The query-param filters, mapped to logical columns. A filter whose column the brand lacks is
 * DROPPED (not silently matched against something else) — see supportedFilterParams() below.
 *
 * Every column listed here is TEXT on every brand that has it, so the filters route's `<col> != ''`
 * guard is safe. Never point one of these at a KIA numeric column: `numeric != ''` fails to resolve,
 * and `numeric ILIKE text` raises 42883.
 */
export const FILTER_PARAM_COLUMNS: Record<string, InsuranceColumnKey> = {
  dealerCode: 'dealerCode',
  subUser: 'subUser',
  insuranceCompany: 'insuranceCompany',
  rmName: 'rmName',
  policyType: 'policyType',
  status64vb: 'column64vbStatus',
  modelName: 'modelName',
  fuelType: 'fuelType',
  paymentMode: 'paymentMode',
  financer: 'financerName',
  addonOpted: 'addonOpted',
  // KIA-only. Occupies the filter-bar slot the dead 64VB "Policy Status" dropdown vacates.
  cancelled: 'cancelled',
  endorsed: 'endorsed',
}

/** The free-text search arms, as logical keys. Absent/empty ones are dropped per brand. */
export const SEARCH_COLUMN_KEYS: readonly InsuranceColumnKey[] = [
  'customerName',
  'policyNo',
  'proposalNo',
  'vehRegistNo',
  'chassisNo',
  'modelName',
  'insuranceCompany',
  'rmName',
  'addonOpted',
]

/** Search arms this brand can actually match on (drops absent columns AND empty ones like KIA's reg). */
export function searchableColumns(brand: InsuranceBrandId | InsuranceBrand): string[] {
  const b = brandOf(brand)
  return SEARCH_COLUMN_KEYS.filter((k) => {
    if (b.columns[k] === null) return false
    if (k === 'vehRegistNo' && !b.capabilities.hasRegistration) return false
    return true
  }).map((k) => b.columns[k] as string)
}

/** Filter params this brand can honour. The rest must not render a control at all. */
export function supportedFilterParams(brand: InsuranceBrandId | InsuranceBrand): string[] {
  const b = brandOf(brand)
  return Object.entries(FILTER_PARAM_COLUMNS)
    .filter(([param, key]) => {
      if (b.columns[key] === null) return false
      // Present but single-valued is worse than missing: it looks functional and filters nothing.
      if (param === 'dealerCode' && !b.capabilities.hasMultiDealer) return false
      return true
    })
    .map(([param]) => param)
}

/** VIN shape shared by all three feeds — verified 1,366/1,366 KIA vinno values match. */
export const CHASSIS_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/

/**
 * Search-term charset guard, lifted verbatim from vehicles/route.ts so all four routes agree.
 */
export const SEARCH_TERM_PATTERN = /^[A-Za-z0-9 .\-]{1,40}$/