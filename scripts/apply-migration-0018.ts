/**
 * Applies migration 0018 — schedules the two maintenance jobs on Supabase pg_cron.
 *
 * WHY SUPABASE AND NOT VERCEL CRON: the Vercel plan here is Hobby, which caps cron at once per day
 * — fine for user-deactivation, impossible for KIA maintenance (every 5 min). pg_cron + pg_net are
 * already installed on this project and already run three jobs successfully
 * (enqueue-kia-daily / enqueue-platinum-daily / enqueue-hmil-daily), so this reuses proven
 * infrastructure rather than introducing a second scheduler.
 *
 * SHAPE deliberately mirrors public.invoke_automation_enqueue: SECURITY DEFINER, same search_path,
 * secrets read from Vault (never inlined into cron.job.command, which is world-readable to anyone
 * with DB access), RAISE EXCEPTION when a secret is missing.
 *
 * The secret travels as an `Authorization: Bearer` header rather than a ?secret= query param so it
 * never lands in Vercel's access logs.
 *
 * ⚠️ These jobs stay inert until CRON_SECRET is set in the Vercel production environment — the
 * endpoints fail closed (503) without it. That env var is the deliberate on-switch.
 *
 * Idempotent: Vault secrets upsert, cron.schedule() upserts by job name, function is CREATE OR
 * REPLACE. Safe to re-run.
 *
 * Run:  npx tsx scripts/apply-migration-0018.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://app.amautomotivegroup.com'

const JOBS = [
  {
    name: 'user-deactivation-daily',
    schedule: '30 20 * * *', // 02:00 IST
    path: '/api/maintenance/user-deactivation',
  },
  {
    name: 'kia-maintenance',
    // HOURLY, not every 5 minutes. This enforces 48h dealer holds and 72h/120h allocation
    // reservations — hourly leaves a deadline at most ~1h late, i.e. 1.4% of a 72h window, which
    // nobody can perceive. The other sweep (markKiaSoldAllocations) reacts to the KIA stock feed,
    // which is uploaded roughly once a day, so it has no new input to see more often than that.
    // Every 5 min was 288 runs/day for the same result as 24 — 12x the Vercel Fluid CPU and 12x the
    // write transactions on the pooler, buying nothing. Dial to '*/15 * * * *' only if someone
    // actually complains that a lapsed reservation takes too long to free the vehicle.
    schedule: '0 * * * *',
    path: '/api/brands/kia/maintenance',
  },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) throw new Error('CRON_SECRET is not set in .env — needed to seed the Vault secret.')

  const sql = postgres(url, { max: 1, prepare: false })

  try {
    // 1. Vault secrets — upsert so re-runs rotate rather than fail on the unique name.
    // Done as parameterized statements, not a DO block: a DO body is a string literal, so bind
    // parameters cannot be typed inside it ("could not determine data type of parameter $1").
    for (const [name, value, description] of [
      ['app_base_url', APP_BASE_URL, 'Public base URL of the Next.js dashboard (Vercel)'],
      ['app_cron_secret', cronSecret, 'Bearer token for the app maintenance cron endpoints (CRON_SECRET in Vercel env)'],
    ]) {
      const [existing] = await sql<{ id: string }[]>`SELECT id FROM vault.secrets WHERE name = ${name}`
      if (existing) {
        await sql`SELECT vault.update_secret(${existing.id}::uuid, ${value}, ${name}, ${description})`
        console.log(`[0018] vault secret ${name} updated`)
      } else {
        await sql`SELECT vault.create_secret(${value}, ${name}, ${description})`
        console.log(`[0018] vault secret ${name} created`)
      }
    }

    // 2. Helper. Mirrors public.invoke_automation_enqueue.
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.invoke_app_maintenance(p_path text)
      RETURNS bigint
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public', 'vault', 'net'
      AS $function$
        DECLARE
          v_app_url text;
          v_secret text;
          v_request_id bigint;
        BEGIN
          SELECT decrypted_secret INTO v_app_url
          FROM vault.decrypted_secrets WHERE name = 'app_base_url';

          SELECT decrypted_secret INTO v_secret
          FROM vault.decrypted_secrets WHERE name = 'app_cron_secret';

          IF v_app_url IS NULL OR v_secret IS NULL THEN
            RAISE EXCEPTION 'Missing app_base_url or app_cron_secret Vault secret';
          END IF;

          SELECT net.http_post(
            url := rtrim(v_app_url, '/') || p_path,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || v_secret
            ),
            timeout_milliseconds := 30000
          ) INTO v_request_id;

          RETURN v_request_id;
        END;
      $function$;
    `)
    console.log('[0018] public.invoke_app_maintenance() created')

    // 3. Schedule. cron.schedule upserts by job name.
    for (const job of JOBS) {
      const [{ schedule: jobId }] = await sql<{ schedule: number }[]>`
        SELECT cron.schedule(${job.name}, ${job.schedule},
          ${`SELECT public.invoke_app_maintenance('${job.path}');`})`
      console.log(`[0018] cron job ${job.name} scheduled (jobid ${jobId}) — ${job.schedule} -> ${job.path}`)
    }

    // Verification
    const jobs = await sql<{ jobname: string; schedule: string; active: boolean; command: string }[]>`
      SELECT jobname, schedule, active, command FROM cron.job
      WHERE jobname = ANY(${JOBS.map((j) => j.name)}) ORDER BY jobname`

    console.log('')
    console.log('Migration 0018 applied. Scheduled jobs:')
    for (const j of jobs) {
      console.log(`  ${j.jobname.padEnd(26)} ${j.schedule.padEnd(12)} active=${j.active}`)
      console.log(`     ${j.command.trim()}`)
    }

    const leaked = jobs.filter((j) => j.command.includes(cronSecret))
    console.log('')
    console.log(leaked.length === 0
      ? 'Secret leak check: PASS — no secret inlined in cron.job.command (read from Vault at run time).'
      : `Secret leak check: FAIL — ${leaked.length} job(s) contain the raw secret.`)

    process.exit(jobs.length === JOBS.length && leaked.length === 0 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0018 failed:', error); process.exit(1) })
