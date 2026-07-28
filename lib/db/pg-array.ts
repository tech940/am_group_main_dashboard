import 'server-only'

/**
 * Build a Postgres array LITERAL to interpolate into a drizzle `sql` template.
 *
 * ⚠️ THE TRAP THIS EXISTS FOR: drizzle does NOT serialise a JS array into a Postgres array. It
 * expands it into a comma-separated PARAMETER TUPLE, so
 *
 *     sql`SELECT unnest(${ids}::text[])`        with ids = ['a','b','c']
 *
 * is sent as `unnest(($1, $2, $3)::text[])` — three separate scalar params wrapped in parentheses,
 * which Postgres rejects. A single-element array is worse: `(($1))::text[]` with $1 = '794%' looks
 * plausible and still fails, because a bare string is not valid array-literal syntax.
 *
 * None of this is caught by TypeScript or by `next build`. It only fails when the query actually
 * runs, which is how three separate Callyzer queries shipped broken.
 *
 * Passing one properly-escaped literal string keeps it to a single bound parameter and casts
 * cleanly. For wide row sets prefer `jsonb_to_recordset` over many parallel arrays — see
 * lib/callyzer/sync.ts.
 */
export function pgArrayLiteral(values: Array<string | number | null | undefined>): string {
  const parts = values.map((v) => {
    if (v === null || v === undefined) return 'NULL'
    // Quote every element and escape the two characters that are special inside a quoted element.
    // Quoting uniformly means numeric arrays need no separate path — Postgres accepts {"1","2"}
    // for int[] just as happily as {1,2}.
    return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  })
  return `{${parts.join(',')}}`
}
