/** Direct session URL for batch ETL (avoids transaction-pooler timeouts on port 6543). */
function syncDatabaseUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')

  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

/** Supabase direct DB host (bypasses pooler). */
function directDatabaseUrl() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')

  const url = new URL(raw)
  const projectRef = url.username.includes('.')
    ? url.username.split('.')[1]
    : (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace('https://', '').replace('.supabase.co', '')

  if (!projectRef) throw new Error('Could not resolve Supabase project ref')

  const direct = new URL(raw)
  direct.hostname = `db.${projectRef}.supabase.co`
  direct.port = '5432'
  direct.username = 'postgres'
  direct.searchParams.delete('pgbouncer')
  return direct.toString()
}

function databaseUrlCandidates() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL
  const candidates = []

  if (process.env.DATABASE_DIRECT_URL) candidates.push(process.env.DATABASE_DIRECT_URL)
  if (raw) {
    candidates.push(directDatabaseUrl())
    candidates.push(syncDatabaseUrl())
    candidates.push(raw)
  }

  return [...new Set(candidates.filter(Boolean))]
}

async function pickDatabaseUrl(postgres, logPrefix = '[db]') {
  const dns = require('node:dns/promises')
  const candidates = databaseUrlCandidates()

  for (const url of candidates) {
    const endpoint = new URL(url)
    const hostnames = [endpoint.hostname]

    try {
      const { address } = await dns.lookup(endpoint.hostname, { family: 6 })
      if (address && !hostnames.includes(address)) hostnames.push(address)
    } catch {
      // IPv6 not available for this host
    }

    for (const host of hostnames) {
      const candidate = new URL(url)
      candidate.hostname = host.includes(':') ? `[${host}]` : host

      const db = postgres(candidate.toString(), {
        ssl: { rejectUnauthorized: false },
        prepare: false,
        max: 1,
        connect_timeout: 60,
        idle_timeout: 1,
      })
      try {
        await db.unsafe('SELECT 1')
        await db.end({ timeout: 5 })
        console.log(`${logPrefix} using database endpoint ${candidate.hostname}:${candidate.port}`)
        return candidate.toString()
      } catch {
        await db.end({ timeout: 5 }).catch(() => {})
      }
    }
  }

  throw new Error('Could not connect to Supabase using pooler, session, or direct database URLs')
}

module.exports = { syncDatabaseUrl, directDatabaseUrl, databaseUrlCandidates, pickDatabaseUrl }
