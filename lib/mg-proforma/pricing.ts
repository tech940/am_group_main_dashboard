export type MgPriceLookupRow = {
  model?: string | null
  trimDescription?: string | null
  colour?: string | null
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

export type MgBankBranchLookupRow = {
  bank_name?: string | null
  bank_branch?: string | null
}

export type ProformaPricingInput = {
  modelName: string
  vehicleColor: string
  bankName: string
  bankBranch: string
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
  price: MgPriceLookupRow | null
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

function toAmount(value: unknown) {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function getMgBankOptions(banks: MgBankBranchLookupRow[]) {
  return uniqueValues(['CASH', ...banks.map((bank) => bank.bank_name || '')])
}

export function findCanonicalBank(input: string, banks: MgBankBranchLookupRow[]) {
  const normalized = normalizeLookup(input)
  if (!normalized) return ''
  if (normalized === 'cash') return 'CASH'
  return banks.find((bank) => normalizeLookup(bank.bank_name) === normalized)?.bank_name?.trim() || ''
}

export function getBranchesForBank(input: string, banks: MgBankBranchLookupRow[]) {
  const canonicalBank = findCanonicalBank(input, banks)
  if (!canonicalBank) return []
  return uniqueValues(
    banks
      .filter((bank) => normalizeLookup(bank.bank_name) === normalizeLookup(canonicalBank))
      .map((bank) => bank.bank_branch || '')
  )
}

export function findCanonicalBranch(input: string, bankInput: string, banks: MgBankBranchLookupRow[]) {
  const normalized = normalizeLookup(input)
  if (!normalized) return ''
  const canonicalBank = findCanonicalBank(bankInput, banks)
  if (!canonicalBank) return ''
  return banks.find((bank) => (
    normalizeLookup(bank.bank_name) === normalizeLookup(canonicalBank)
    && normalizeLookup(bank.bank_branch) === normalized
  ))?.bank_branch?.trim() || ''
}

export function findPriceByTrim(input: string, prices: MgPriceLookupRow[]) {
  const normalized = normalizeLookup(input)
  if (!normalized) return null
  return prices.find((price) => normalizeLookup(price.trimDescription) === normalized) || null
}

export function findMgPrice(input: ProformaPricingInput, prices: MgPriceLookupRow[]) {
  const normalizedModel = normalizeLookup(input.modelName)
  const normalizedTrim = normalizeLookup(input.trimDescription)
  if (!normalizedTrim) return null

  const trimMatches = prices.filter((price) => normalizeLookup(price.trimDescription) === normalizedTrim)
  const modelTrimMatches = normalizedModel
    ? trimMatches.filter((price) => normalizeLookup(price.model) === normalizedModel)
    : trimMatches
  const matches = modelTrimMatches.length > 0 ? modelTrimMatches : trimMatches
  if (matches.length <= 1) return matches[0] || null

  const normalizedColor = normalizeLookup(input.vehicleColor)
  if (normalizedColor) {
    const colorMatch = matches.find((price) => normalizeLookup(price.colour) === normalizedColor)
    if (colorMatch) return colorMatch
  }

  return matches[0] || null
}

export function calculateMgProformaPricing(
  input: ProformaPricingInput,
  prices: MgPriceLookupRow[],
  banks: MgBankBranchLookupRow[]
): ProformaPricingResult {
  const price = findMgPrice(input, prices)
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
