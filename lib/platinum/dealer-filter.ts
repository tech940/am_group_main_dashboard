import { sql } from 'drizzle-orm'
import { DEFAULT_PLATINUM_DEALER_CODE } from '@/lib/platinum/dealer-branch'

export function platinumSourceDealerSql(column = sql.raw('source_dealer_code')) {
  return sql`
    CASE
      WHEN UPPER(TRIM(COALESCE(${column}::text, ''))) = 'ACTIVE'
        THEN ${DEFAULT_PLATINUM_DEALER_CODE}
      ELSE NULLIF(UPPER(TRIM(COALESCE(${column}::text, ''))), '')
    END
  `
}

export function platinumSourceDealerFilter(
  dealerCode: string | null,
  column = sql.raw('source_dealer_code')
) {
  return dealerCode
    ? sql`AND ${platinumSourceDealerSql(column)} = ${dealerCode}`
    : sql``
}
