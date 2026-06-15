const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const dotenv = require('dotenv')
const { createPlatinumBeApiCookieHeader } = require('./lib/platinum-be-api-auth')

dotenv.config({ quiet: true })

function closeTo(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(Number(actual) - expected) <= tolerance,
    `Expected ${expected}, received ${actual}`
  )
}

async function isServerReachable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/`, {
      method: 'GET',
      redirect: 'manual',
    })
    return response.status < 500
  } catch {
    return false
  }
}

async function waitForServer(baseUrl, timeoutMs = 120_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReachable(baseUrl)) return
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`Timed out waiting for Next.js server at ${baseUrl}`)
}

function startDevServer() {
  const child = spawn('npm run dev', {
    cwd: process.cwd(),
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  return child
}

async function fetchOverview(baseUrl, cookie, query = '') {
  const url = `${baseUrl.replace(/\/$/, '')}/api/brands/platinum/business-excellence/overview?chunk=full&startDate=2026-06-01&endDate=2026-06-14${query}`
  const startedAt = Date.now()
  const response = await fetch(url, { headers: { cookie } })
  const elapsedMs = Date.now() - startedAt

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Overview API auth failed (${response.status}). Check PLATINUM_BE_API_EMAIL/password or user brand access.`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Overview API failed (${response.status}): ${body.slice(0, 500)}`)
  }

  return {
    payload: await response.json(),
    elapsedMs,
  }
}

async function main() {
  const baseUrl = process.env.PLATINUM_BE_API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const readSource = process.env.ANALYTICS_READ_SOURCE || 'postgres'
  let devServer = null
  let startedDevServer = false

  try {
    if (!(await isServerReachable(baseUrl))) {
      console.log(`[verify-platinum-be-api] starting dev server at ${baseUrl}`)
      devServer = startDevServer()
      startedDevServer = true
      await waitForServer(baseUrl)
    }

    const cookie = await createPlatinumBeApiCookieHeader()
    if (!cookie) {
      throw new Error(
        'API auth is not configured. Set PLATINUM_BE_API_COOKIE, PLATINUM_BE_API_EMAIL + PLATINUM_BE_API_PASSWORD, or SUPABASE_SERVICE_ROLE_KEY for automatic login.'
      )
    }

    const { payload, elapsedMs: coldMs } = await fetchOverview(baseUrl, cookie, '&skipCache=true')
    assert.ok(payload.kpis, 'overview payload must include kpis')
    assert.ok(payload.comparison, 'overview payload must include comparison')

    closeTo(payload.kpis.revenue, payload.comparison.revenue.cy)
    closeTo(payload.kpis.labour, payload.comparison.labour.cy)
    closeTo(payload.kpis.parts, payload.comparison.parts.cy)
    closeTo(payload.kpis.totalJc, payload.comparison.totalJc.cy)

    const lyRevenue = payload.comparison.revenue.ly
    const deltaPct = payload.comparison.revenue.deltaPct
    if (lyRevenue !== null && lyRevenue > 0 && deltaPct !== null) {
      const expectedGrowth = ((payload.kpis.revenue - lyRevenue) / lyRevenue) * 100
      closeTo(deltaPct, expectedGrowth, 0.05)
    }

    const vas = payload.comparison.workshopVasAmount
    assert.ok(vas, 'overview payload must include workshopVasAmount comparison')
    if (vas.comparisonStatus === 'not_comparable') {
      assert.equal(vas.ly, null, 'workshopVasAmount.ly must be null when not comparable')
      assert.equal(vas.comparisonLabel, 'No comparable LY period')
      assert.equal(vas.deltaPct, null)
    } else if (vas.ly !== null && vas.ly !== undefined) {
      assert.ok(Number.isFinite(Number(vas.ly)), 'workshopVasAmount.ly must be numeric when present')
    }

    const { payload: jammuPayload } = await fetchOverview(baseUrl, cookie, '&skipCache=true&dealer_code=N5211')
    const jammuVas = jammuPayload.comparison?.workshopVasAmount
    assert.ok(jammuVas, 'Jammu overview must include workshopVasAmount comparison')
    assert.equal(jammuVas.comparisonStatus, 'not_comparable', 'Jammu MTD VAS LY must be not comparable')
    assert.equal(jammuVas.ly, null, 'Jammu workshopVasAmount.ly must be null')
    assert.equal(jammuVas.comparisonLabel, 'No comparable LY period')

    const coldBudgetMs = Number(process.env.PLATINUM_BE_API_COLD_BUDGET_MS || 12_000)
    assert.ok(coldMs <= coldBudgetMs, `cold overview exceeded budget (${coldMs}ms > ${coldBudgetMs}ms)`)

    await fetchOverview(baseUrl, cookie, '')
    const { elapsedMs: warmMs } = await fetchOverview(baseUrl, cookie, '')
    const warmBudgetMs = Number(process.env.PLATINUM_BE_API_WARM_BUDGET_MS || 8_000)
    assert.ok(warmMs <= warmBudgetMs, `warm overview exceeded budget (${warmMs}ms > ${warmBudgetMs}ms)`)

    console.log('[verify-platinum-be-api] passed', {
      analyticsReadSource: readSource,
      revenue: payload.kpis.revenue,
      lyRevenue: payload.comparison.revenue.ly,
      totalJc: payload.kpis.totalJc,
      vasLy: vas.ly,
      vasComparisonStatus: vas.comparisonStatus,
      jammuVasLy: jammuVas.ly,
      coldMs,
      warmMs,
    })
  } finally {
    if (startedDevServer && devServer) {
      devServer.kill('SIGTERM')
    }
  }
}

main().catch((error) => {
  console.error('[verify-platinum-be-api] failed', error)
  process.exit(1)
})
