import { sql } from 'drizzle-orm'

/**
 * Canonical Hyundai operation-code identifiers for the Operation Wise Analysis report
 * (`hyundai_operation_wise_analysis_report.op_part_code`).
 *
 * Sourced from the op/part codes supplied by each Hyundai dealer branch
 * (N5216, N6844, N6845, N6846, N6847, N6848) and reconciled against every code
 * present in the loaded snapshots. A code is VAS or not regardless of which branch
 * billed it, so the list is global; branch attribution is done by the dealer filter.
 *
 * Wheel alignment and wheel balancing are value-added work but are deliberately
 * NOT part of VAS revenue. They are reported separately as the Actual WA / WB
 * counts in the Service Performance table.
 */
export const HYUNDAI_VAS_IDENTIFIER_VERSION = 'hyundai-vas-dealer-codes-2026-08-07-v3'

export const HYUNDAI_VAS_CODES = [
  'A10AA1LCERAHR',
  'A10AA3LCERAHR',
  'A10AAACDVAS3M',
  'A10AAACDVAS3MHW',
  'A10AAACDVASEB',
  'A10AAACDVASEBAA',
  'A10AAACDVASHR',
  'A10AAACDVASHRAA',
  'A10AAACDVASHRHW',
  'A10AAACDVASWT',
  'A10AAACDVASWTHW',
  'A10AAATLVASHR',
  'A10AAATLVASHRAA',
  'A10AAATLVASHRHW',
  'A10AAATMVASHR',
  'A10AAATMVASHRAA',
  'A10AAATSVASHR',
  'A10AAAWPVAS3M',
  'A10AAAWPVASHR',
  'A10AAAWPVASHRAA',
  'A10AAAWPVASHRHW',
  'A10AAAWPVASWT',
  'A10AAEBLVAS3M',
  'A10AAEBLVASEB',
  'A10AAEBLVASHR',
  'A10AAEBLVASHRAA',
  'A10AAEBLVASWT',
  'A10AAEBMVAS3M',
  'A10AAEBMVASHR',
  'A10AAEBMVASWT',
  'A10AAEBSVAS3M',
  'A10AAEBSVASHR',
  'A10AAEBSVASWT',
  'A10AAECLVAS3M',
  'A10AAECLVASEB',
  'A10AAECLVASHR',
  'A10AAECLVASHRAA',
  'A10AAECLVASWT',
  'A10AAECLVASWTAA',
  'A10AAECMVAS3M',
  'A10AAECMVAS3MHW',
  'A10AAECMVASEB',
  'A10AAECMVASHR',
  'A10AAECMVASHRHW',
  'A10AAECMVASWT',
  'A10AAECMVASWTHW',
  'A10AAECSVAS3M',
  'A10AAECSVASEB',
  'A10AAECSVASEBHW',
  'A10AAECSVASHR',
  'A10AAECSVASHRHW',
  'A10AAECSVASWT',
  'A10AAECSVASWTHW',
  'A10AAEGRVASEB',
  'A10AAEGRVASHR',
  'A10AAEGRVASHRAA',
  'A10AAEGRVASWT',
  'A10AAEMCVASHR',
  'A10AAGM05TBCL',
  'A10AAHLRVASHR',
  'A10AAIALNVAS3M',
  'A10AAIALVAS3M',
  'A10AAIALVASEB',
  'A10AAIALVASWR',
  'A10AAIALVASWT',
  'A10AAIAMNVAS3M',
  'A10AAIAMVAS3M',
  'A10AAIAMVASEB',
  'A10AAIAMVASWR',
  'A10AAIAMVASWT',
  'A10AAIASNVAS3M',
  'A10AAIASVAS3M',
  'A10AAIASVASAR',
  'A10AAIASVASEB',
  'A10AAIASVASWR',
  'A10AAIASVASWT',
  'A10AAIELVASEB',
  'A10AAIELVASHR',
  'A10AAIELVASHRAA',
  'A10AAIEMVASHR',
  'A10AAIEMVASHRHW',
  'A10AAIEMVASWT',
  'A10AAIESVASEB',
  'A10AAIESVASHR',
  'A10AAIESVASHRHW',
  'A10AAIESVASWT',
  'A10AAISSVAL3M',
  'A10AAISSVALHR',
  'A10AAISSVAM3M',
  'A10AAISSVAMHR',
  'A10AAISSVAMHRAA',
  'A10AAISSVAMHRHW',
  'A10AAISSVASAR',
  'A10AAISSVASEB',
  'A10AAISSVASHR',
  'A10AAISSVASHRAA',
  'A10AAISSVASSK',
  'A10AAISSVASWR',
  'A10AALUB03LNA',
  'A10AAPILVAS3M',
  'A10AAPILVASEB',
  'A10AAPILVASHR',
  'A10AAPILVASHRAA',
  'A10AAPILVASWT',
  'A10AAPIMVAS3M',
  'A10AAPIMVASEB',
  'A10AAPIMVASHR',
  'A10AAPIMVASHRHW',
  'A10AAPIMVASWT',
  'A10AAPISVASEB',
  'A10AAPISVASHR',
  'A10AAPISVASHRHW',
  'A10AAPMSVAS01',
  'A10AAPPLVASHR',
  'A10AAPPLVASHRAA',
  'A10AAPPMVASHR',
  'A10AAPPMVASHRHW',
  'A10AAPPSVASHR',
  'A10AARRLVASHR',
  'A10AARRLVASHRAA',
  'A10AARRMVAS3M',
  'A10AARRMVASHR',
  'A10AARRMVASHRHW',
  'A10AARRSVASHR',
  'A10AARRSVASWT',
  'A10AARUB19LNA',
  'A10AASA68CROS',
  'A10AASA68CROSAA',
  'A10AASCLVAS3M',
  'A10AASCLVASHR',
  'A10AASCLVASHRAA',
  'A10AASCLVASWT',
  'A10AASCMVAS3M',
  'A10AASCMVASEB',
  'A10AASCMVASHR',
  'A10AASCMVASHRHW',
  'A10AASCMVASWT',
  'A10AASCSVAS3M',
  'A10AASCSVASEB',
  'A10AASCSVASHR',
  'A10AASCSVASHRHW',
  'A10AASCSVASWT',
  'A10AASPLVAS3M',
  'A10AASPLVASEB',
  'A10AASPLVASHR',
  'A10AASPLVASHRAA',
  'A10AASPLVASHRHW',
  'A10AASPLVASWT',
  'A10AASPMVAS3M',
  'A10AASPMVASEB',
  'A10AASPMVASEBAA',
  'A10AASPMVASHR',
  'A10AASPMVASHRAA',
  'A10AASPMVASHRHW',
  'A10AASPMVASWT',
  'A10AASPSVAS3M',
  'A10AASPSVAS3MHW',
  'A10AASPSVASEB',
  'A10AASPSVASEBHW',
  'A10AASPSVASHR',
  'A10AASPSVASHRHW',
  'A10AASPSVASWT',
  'A10AATBC0003M',
  'A10AATBC000EBAA',
  'A10AATBC000HR',
  'A10AATBC000HRAA',
  'A10AATBC000HRHW',
  'A10AATBC000WM',
  'A10AATBC000WR',
  'A10AATBC000WRAA',
  'A10AATBC000WT',
  'A10AATBC000WTHW',
  'A10AAUBCAL03M',
  'A10AAUBCAL0EBAA',
  'A10AAUBCAL0HR',
  'A10AAUBCAL0HRAA',
  'A10AAUBCAL0WR',
  'A10AAUBCAS03M',
  'A10AAUBCAS0EB',
  'A10AAUBCAS0HR',
  'A10AAUBCAS0HRHW',
  'A10AAUBCAS0WR',
  'A10AAUBCAS0WT',
  'A10AAWTSVASHR',
] as const

export const HYUNDAI_WHEEL_ALIGNMENT_CODES = [
  'A10AAGM06WHAL',
  'A10AAGM06WHALAA',
  'A10AAGM06WHALHW',
] as const

export const HYUNDAI_WHEEL_BALANCING_CODES = [
  'A10AAGM07WHBL',
  'A10AAGM07WHBLAA',
  'A10AAGM07WHBLHW',
] as const

export const HYUNDAI_ALL_IDENTIFIER_CODES = [
  ...HYUNDAI_VAS_CODES,
  ...HYUNDAI_WHEEL_ALIGNMENT_CODES,
  ...HYUNDAI_WHEEL_BALANCING_CODES,
] as const

export type HyundaiOperationCategory = 'vas' | 'wheel_alignment' | 'wheel_balancing' | 'unknown'

const VAS_CODE_SET = new Set<string>(HYUNDAI_VAS_CODES)
const WHEEL_ALIGNMENT_CODE_SET = new Set<string>(HYUNDAI_WHEEL_ALIGNMENT_CODES)
const WHEEL_BALANCING_CODE_SET = new Set<string>(HYUNDAI_WHEEL_BALANCING_CODES)

export function normalizeHyundaiOperationCode(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function classifyHyundaiOperationCode(value: unknown): HyundaiOperationCategory {
  const code = normalizeHyundaiOperationCode(value)
  if (WHEEL_ALIGNMENT_CODE_SET.has(code)) return 'wheel_alignment'
  if (WHEEL_BALANCING_CODE_SET.has(code)) return 'wheel_balancing'
  if (VAS_CODE_SET.has(code)) return 'vas'
  return 'unknown'
}

function codeInSql(column: ReturnType<typeof sql.raw>, codes: readonly string[]) {
  return sql`UPPER(TRIM(COALESCE(${column}::text, ''))) IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`
}

export function hyundaiVasCodeSql(column: ReturnType<typeof sql.raw>) {
  return codeInSql(column, HYUNDAI_VAS_CODES)
}

export function hyundaiWheelAlignmentCodeSql(column: ReturnType<typeof sql.raw>) {
  return codeInSql(column, HYUNDAI_WHEEL_ALIGNMENT_CODES)
}

export function hyundaiWheelBalancingCodeSql(column: ReturnType<typeof sql.raw>) {
  return codeInSql(column, HYUNDAI_WHEEL_BALANCING_CODES)
}

export function hyundaiKnownCodeSql(column: ReturnType<typeof sql.raw>) {
  return codeInSql(column, HYUNDAI_ALL_IDENTIFIER_CODES)
}
