// Single source of truth for formatting Business Excellence "data freshness"
// timestamps. ALWAYS renders in India Standard Time (Asia/Kolkata) so the date and
// time are correct regardless of where the code runs (server SSR defaults to UTC,
// browsers use the visitor's timezone). Every brand's BE page must use these — do
// not hand-roll toLocaleDateString/toLocaleString without a timeZone, or the date
// can silently shift by a day near midnight IST.

const IST = 'Asia/Kolkata'

/** Long form: "07 Jul 2026, 11:02 am IST". Used for the primary "Updated:" label. */
export function formatBusinessFreshness(value?: string | null): string {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return `${date.toLocaleString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })} IST`
}

/** Short form: "07 Jul, 11:02 am IST". Used for the per-source freshness pills. */
export function formatBusinessFreshnessShort(value?: string | null): string {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return `${date.toLocaleString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })} IST`
}
