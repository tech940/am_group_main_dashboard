import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    console.log('=== cron.job ===')
    const jobs = await sql.unsafe(`
      SELECT jobid, jobname, schedule, active, left(command, 120) AS command
      FROM cron.job ORDER BY jobname
    `)
    console.table(jobs)

    console.log('\n=== run counts last 24h (per job) ===')
    const runs = await sql.unsafe(`
      SELECT j.jobname, count(*) AS runs,
             min(d.start_time) AS first_run,
             max(d.start_time) AS last_run,
             count(*) FILTER (WHERE d.status <> 'succeeded') AS failed
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE d.start_time > now() - interval '24 hours'
      GROUP BY j.jobname ORDER BY runs DESC
    `)
    console.table(runs)

    console.log('\n=== run counts last 7d (per job) ===')
    const runs7 = await sql.unsafe(`
      SELECT j.jobname, count(*) AS runs
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE d.start_time > now() - interval '7 days'
      GROUP BY j.jobname ORDER BY runs DESC
    `)
    console.table(runs7)
  } finally {
    await sql.end()
  }
}
main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1) })
