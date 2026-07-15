import 'server-only'

export type CronAuthResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Shared secret gate for the scheduled maintenance endpoints.
 *
 * FAILS CLOSED BY CONSTRUCTION. The original KIA guard was `if (secret && provided !== secret)`,
 * which skips the check entirely when the env var is missing — so with KIA_MAINTENANCE_SECRET unset
 * in production, POST /api/brands/kia/maintenance ran DB write sweeps for any anonymous caller on
 * the internet. Verified live: an unauthenticated POST returned 200. Never re-introduce that shape;
 * an unconfigured secret must mean "refuse to run", never "let everyone in".
 *
 * Two accepted credentials:
 *  - `Authorization: Bearer $CRON_SECRET` — the scheduler (Supabase pg_cron via pg_net, or Vercel
 *    Cron). Preferred: headers stay out of access logs, unlike a query string.
 *  - `?secret=$<job secret>` — manual curl / the npm runner scripts, per-job.
 */
export function authorizeCronRequest(
  request: Request,
  url: URL,
  job: { secret: string | undefined; secretEnvName: string }
): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret && !job.secret) {
    return {
      ok: false,
      status: 503,
      error: `Neither CRON_SECRET nor ${job.secretEnvName} is configured; refusing to run.`,
    }
  }

  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return { ok: true }
  }
  if (job.secret && url.searchParams.get('secret') === job.secret) {
    return { ok: true }
  }

  return { ok: false, status: 403, error: 'Forbidden' }
}
