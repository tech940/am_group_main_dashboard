export type KiaPriceLookupRow = {
  model?: string | null
  trimDescription?: string | null
  newExShowroomPrice?: string | number | null
  exShowroomPrice?: string | number | null
  tcs?: string | number | null
  registrationCharges?: string | number | null
  statutoryCharges?: string | number | null
  insurance?: string | number | null
  fastag?: string | number | null
  accessoriesKit?: string | number | null
  extendedWarranty4thYear?: string | number | null
  insuranceCompany?: string | null
}

export type KiaBankBranchLookupRow = {
  bank_name?: string | null
  bank_branch?: string | null
}

export type ProformaPricingInput = {
  bankName: string
  bankBranch: string
  modelName?: string
  trimDescription: string
  exShowroom: string | number
  tcsValue: string | number
  registrationCharges: string | number
  insuranceValue: string | number
  fastagValue: string | number
  accessoriesKit: string | number
  extWarranty: string | number
  cashDiscount: string | number
  exchangeValue: string | number
  bookingAmount: string | number
  govtEmployeeDiscount: string | number
  additionalDiscount: string | number
}

export type ProformaPricePrefill = {
  exShowroom: string
  tcsValue: string
  registrationCharges: string
  insuranceValue: string
  fastagValue: string
  accessoriesKit: string
  extWarranty: string
  insuranceCompany: string
}

export type ProformaPricingResult = {
  price: KiaPriceLookupRow | null
  canonicalTrim: string
  trimIsValid: boolean
  canonicalBank: string
  bankIsValid: boolean
  canonicalBranch: string
  branchIsValid: boolean
  branchOptions: string[]
  prefill: ProformaPricePrefill | null
  totals: {
    totalCustomerCost: number
    grandTotalCost: number
  }
}

function normalizeLookup(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeBankName(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\bbank\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function toAmount(value: unknown) {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function getKiaBankOptions(banks: KiaBankBranchLookupRow[]) {
  return uniqueValues(['CASH', ...banks.map((bank) => bank.bank_name || '')])
}

export function findCanonicalBank(input: string, banks: KiaBankBranchLookupRow[]) {
  const normalized = normalizeBankName(input)
  if (!normalized) return ''
  if (normalized === 'cash') return 'CASH'
  return banks.find((bank) => normalizeBankName(bank.bank_name) === normalized)?.bank_name?.trim() || ''
}

export function getBranchesForBank(input: string, banks: KiaBankBranchLookupRow[]) {
  const canonicalBank = findCanonicalBank(input, banks)
  if (!canonicalBank) return []
  return uniqueValues(
    banks
      .filter((bank) => normalizeBankName(bank.bank_name) === normalizeBankName(canonicalBank))
      .map((bank) => bank.bank_branch || '')
  )
}

export function findCanonicalBranch(input: string, bankInput: string, banks: KiaBankBranchLookupRow[]) {
  const normalized = normalizeLookup(input)
  if (!normalized) return ''
  const canonicalBank = findCanonicalBank(bankInput, banks)
  if (!canonicalBank) return ''
  return banks.find((bank) => (
    normalizeBankName(bank.bank_name) === normalizeBankName(canonicalBank)
    && normalizeLookup(bank.bank_branch) === normalized
  ))?.bank_branch?.trim() || ''
}

export function findPriceByTrim(input: string, prices: KiaPriceLookupRow[]) {
  const normalized = normalizeLookup(input)
  if (!normalized) return null
  return prices.find((price) => normalizeLookup(price.trimDescription) === normalized) || null
}

function alnum(value: unknown) {
  return normalizeLookup(value).replace(/[^a-z0-9]/g, '')
}

// Auto-fetch the vehicle price by MODEL + VARIANT. Tries an exact trim match first
// (unchanged behaviour), then falls back to a model-scoped fuzzy match so a booking
// whose variant text differs slightly from the price sheet still resolves a price
// instead of leaving Ex-Showroom at 0.
export function findPriceByModelTrim(model: string | undefined, trim: string, prices: KiaPriceLookupRow[]) {
  const exact = findPriceByTrim(trim, prices)
  if (exact) return exact

  const trimKey = alnum(trim)
  if (!trimKey) return null
  const modelKey = normalizeLookup(model)

  const candidates = prices.filter((price) => {
    if (modelKey && normalizeLookup(price.model) !== modelKey) return false
    const priceKey = alnum(price.trimDescription)
    if (!priceKey) return false
    return priceKey.includes(trimKey) || trimKey.includes(priceKey)
  })
  if (candidates.length === 0) return null

  // Prefer the most specific (longest) matching trim.
  return candidates.sort((a, b) => alnum(b.trimDescription).length - alnum(a.trimDescription).length)[0]
}

export function calculateKiaProformaPricing(
  input: ProformaPricingInput,
  prices: KiaPriceLookupRow[],
  banks: KiaBankBranchLookupRow[]
): ProformaPricingResult {
  const price = findPriceByModelTrim(input.modelName, input.trimDescription, prices)
  const canonicalTrim = price?.trimDescription?.trim() || ''
  const canonicalBank = findCanonicalBank(input.bankName, banks)
  const branchOptions = canonicalBank ? getBranchesForBank(canonicalBank, banks) : []
  const canonicalBranch = findCanonicalBranch(input.bankBranch, canonicalBank, banks)
  const bankIsValid = !input.bankName.trim() || Boolean(canonicalBank)
  const branchIsValid = !input.bankBranch.trim() || Boolean(canonicalBranch)
  const trimIsValid = !input.trimDescription.trim() || Boolean(price)

  const registration = price
    ? canonicalBank === 'CASH'
      ? toAmount(price.registrationCharges)
      : toAmount(price.registrationCharges) + toAmount(price.statutoryCharges)
    : toAmount(input.registrationCharges)

  const prefill = price
    ? {
        exShowroom: String(price.newExShowroomPrice ?? price.exShowroomPrice ?? 0),
        tcsValue: String(price.tcs ?? 0),
        registrationCharges: String(registration),
        insuranceValue: String(price.insurance ?? 0),
        fastagValue: String(price.fastag ?? 0),
        accessoriesKit: String(price.accessoriesKit ?? 0),
        extWarranty: String(price.extendedWarranty4thYear ?? 0),
        insuranceCompany: price.insuranceCompany || '',
      }
    : null

  const totalCustomerCost =
    toAmount(input.exShowroom)
    + toAmount(input.tcsValue)
    + toAmount(input.registrationCharges)
    + toAmount(input.insuranceValue)
    + toAmount(input.fastagValue)
    + toAmount(input.accessoriesKit)
    + toAmount(input.extWarranty)

  const grandTotalCost =
    totalCustomerCost
    - toAmount(input.cashDiscount)
    - toAmount(input.exchangeValue)
    - toAmount(input.bookingAmount)
    - toAmount(input.govtEmployeeDiscount)
    - toAmount(input.additionalDiscount)

  return {
    price,
    canonicalTrim,
    trimIsValid,
    canonicalBank,
    bankIsValid,
    canonicalBranch,
    branchIsValid,
    branchOptions,
    prefill,
    totals: {
      totalCustomerCost,
      grandTotalCost,
    },
  }
}
