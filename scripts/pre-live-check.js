require('dotenv').config({ quiet: true })

const { spawn } = require('child_process')
const postgres = require('postgres')

const requiredEnv = [
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

function nowLabel() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date())
}

function run(commandLine, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n[pre-live] ${label}`)
    console.log(`[pre-live] running: ${commandLine}`)

    const child = spawn(commandLine, {
      cwd: process.cwd(),
      shell: true,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${label} failed with exit code ${code}`))
    })
  })
}

function checkEnv() {
  console.log('\n[pre-live] Environment check')
  const missing = requiredEnv.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  console.log('[pre-live] required environment variables are present')
}

async function checkDatabase() {
  console.log('\n[pre-live] Database connectivity check')
  const startedAt = Date.now()
  const sql = postgres(process.env.DATABASE_URL, {
    prepare: false,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    const result = await sql`select now() as server_time`
    console.log(`[pre-live] database ok in ${Date.now() - startedAt}ms (${result[0].server_time.toISOString()})`)
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

async function main() {
  console.log('[pre-live] Starting checks before going live')
  console.log(`[pre-live] Started at ${nowLabel()}`)

  checkEnv()
  await checkDatabase()
  await run('npm run lint', 'ESLint')
  await run('npx tsc --noEmit', 'TypeScript')
  await run('npm run build', 'Production build')

  console.log('\n[pre-live] All checks passed. Safe to make this build live.')
}

main().catch((error) => {
  console.error('\n[pre-live] FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
