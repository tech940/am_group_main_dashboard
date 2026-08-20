import { sql } from 'drizzle-orm'

type SqlColumn = ReturnType<typeof sql.raw>

export function platinumSourceDealerSql(
  column: SqlColumn = sql.raw('source_dealer_code'),
  fallbackColumns: SqlColumn[] = []
) {
  const candidates = [
    sql`NULLIF(NULLIF(UPPER(TRIM(COALESCE(${column}::text, ''))), ''), 'ACTIVE')`,
    ...fallbackColumns.map((fallback) => sql`NULLIF(UPPER(TRIM(COALESCE(${fallback}::text, ''))), '')`),
  ]

  const resolved = sql`COALESCE(${sql.join(candidates, sql`, `)})`

  return sql`
    CASE
      WHEN ${resolved} = 'N6824' THEN 'N6250'
      WHEN ${resolved} IN ('N6828', 'N6848') THEN 'N6828'
      ELSE ${resolved}
    END
  `
}

export function platinumSourceDealerFilter(
  dealerCode: string | null,
  column: SqlColumn = sql.raw('source_dealer_code'),
  fallbackColumns: SqlColumn[] = []
) {
  return dealerCode
    ? sql`AND ${platinumSourceDealerSql(column, fallbackColumns)} = ${dealerCode}`
    : sql``
}
