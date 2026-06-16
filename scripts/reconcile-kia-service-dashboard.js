require('dotenv').config({ quiet: true })
const { execSync } = require('node:child_process')
const path = require('node:path')

const EXPECTED = {
  intake: {
    'Free Service': { today: 4, mtd: 36 },
    'Paid Service': { today: 3, mtd: 35 },
    'Running Repair': { today: 4, mtd: 36 },
    'Accidental Repair': { today: 2, mtd: 29 },
  },
  delivered: {
    'Free Service': { today: 5, mtd: 36 },
    'Paid Service': { today: 3, mtd: 37 },
    'Running Repair': { today: 6, mtd: 36 },
    'Accidental Repair': { today: 1, mtd: 25 },
  },
  labourMtd: 554378,
  partsMtd: 916263,
  rsaMtd: 16,
  mcpMtd: 1,
  ewMtd: 2,
  alignmentCount: 48,
  balancingCount: 41,
  alignmentLabour: 30212,
  balancingLabour: 25417,
  engineOilMtd: 262,
  avgLabourPerRo: 4137,
  labourPerRoWithoutVas: 3719,
  averageRo: 10,
}

function compare(label, actual, expected, tolerance = 0) {
  const ok = tolerance > 0 ? Math.abs(actual - expected) <= tolerance : actual === expected
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}: actual=${actual} expected=${expected}`)
  return ok
}

function runBuildMetrics() {
  const script = path.join(__dirname, 'verify-kia-service-dashboard-metrics.mjs')
  const output = execSync(`npx tsx "${script}"`, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ANALYTICS_READ_SOURCE: 'postgres' },
  })
  const metrics = {}
  const intake = {}
  const delivered = {}
  let exportDate = null

  for (const line of output.split('\n')) {
    if (line.startsWith('exportDate:')) {
      exportDate = line.split('exportDate:')[1].trim().split(' ')[0]
    }
    if (line.includes("'Free Service':") && line.includes('intake:')) continue
    const intakeMatch = line.match(/'([^']+)': \{ today: (\d+), mtd: (\d+) \}/)
    if (intakeMatch) {
      const [, cat, today, mtd] = intakeMatch
      if (output.indexOf('intake:') < output.indexOf(line) && output.indexOf('delivered:') > output.indexOf(line)) {
        intake[cat] = { today: Number(today), mtd: Number(mtd) }
      } else if (output.indexOf('delivered:') < output.indexOf(line)) {
        delivered[cat] = { today: Number(today), mtd: Number(mtd) }
      }
    }
    if (line.startsWith('labour MTD:')) metrics.labourMtd = Number(line.split(':')[1].trim())
    if (line.startsWith('parts MTD:')) metrics.partsMtd = Number(line.split(':')[1].trim())
    if (line.startsWith('RSA MTD:')) metrics.rsaMtd = Number(line.split(':')[1].trim())
    if (line.startsWith('MCP MTD:')) metrics.mcpMtd = Number(line.split(':')[1].trim())
    if (line.startsWith('E/W MTD:')) metrics.ewMtd = Number(line.split(':')[1].trim())
    if (line.startsWith('alignment:')) {
      const [alignment, balancing] = line.replace('alignment:', '').split('balancing:').map((v) => Number(v.trim()))
      metrics.alignmentCount = alignment
      metrics.balancingCount = balancing
    }
    if (line.startsWith('alignment labour:')) {
      const [alignmentLabour, balancingLabour] = line
        .replace('alignment labour:', '')
        .split('balancing labour:')
        .map((v) => Number(v.trim()))
      metrics.alignmentLabour = alignmentLabour
      metrics.balancingLabour = balancingLabour
    }
    if (line.startsWith('engine oil MTD:')) metrics.engineOilMtd = Number(line.split(':')[1].trim())
    if (line.startsWith('VAS amount:')) metrics.vasAmount = Number(line.split(':')[1].trim())
    if (line.startsWith('average RO:')) metrics.averageRo = Number(line.split(':')[1].trim())
    if (line.startsWith('avg labour per RO:')) metrics.avgLabourPerRo = Number(line.split(':')[1].trim())
    if (line.startsWith('labour per RO without VAS:')) metrics.labourPerRoWithoutVas = Number(line.split(':')[1].trim())
  }

  return { exportDate, intake, delivered, metrics, raw: output }
}

async function main() {
  console.log('=== buildMetrics reconciliation (JK402 @ 2026-06-15) ===\n')
  const { exportDate, intake, delivered, metrics, raw } = runBuildMetrics()
  console.log(raw)
  console.log('\n=== ACCEPTANCE CHECKS ===')

  let ok = compare('exportDate', exportDate, '2026-06-15')

  console.log('\n-- Intake --')
  for (const [cat, exp] of Object.entries(EXPECTED.intake)) {
    const row = intake[cat] || { today: 0, mtd: 0 }
    ok &= compare(`${cat} MTD`, row.mtd, exp.mtd)
    ok &= compare(`${cat} today`, row.today, exp.today)
  }

  console.log('\n-- Delivered / revenue --')
  for (const [cat, exp] of Object.entries(EXPECTED.delivered)) {
    const row = delivered[cat] || { today: 0, mtd: 0 }
    ok &= compare(`${cat} delivered MTD`, row.mtd, exp.mtd)
    ok &= compare(`${cat} delivered today`, row.today, exp.today)
  }
  ok &= compare('Labour MTD', Math.round(metrics.labourMtd || 0), EXPECTED.labourMtd, 1)
  ok &= compare('Parts MTD', Math.round(metrics.partsMtd || 0), EXPECTED.partsMtd, 1)

  console.log('\n-- Addons / operations --')
  ok &= compare('RSA MTD', metrics.rsaMtd || 0, EXPECTED.rsaMtd)
  ok &= compare('MCP MTD', metrics.mcpMtd || 0, EXPECTED.mcpMtd)
  ok &= compare('E/W MTD', metrics.ewMtd || 0, EXPECTED.ewMtd)
  ok &= compare('Alignment count', Math.round(metrics.alignmentCount || 0), EXPECTED.alignmentCount)
  ok &= compare('Balancing count', Math.round(metrics.balancingCount || 0), EXPECTED.balancingCount)
  ok &= compare('Alignment labour', Math.round(metrics.alignmentLabour || 0), EXPECTED.alignmentLabour)
  ok &= compare('Balancing labour', Math.round(metrics.balancingLabour || 0), EXPECTED.balancingLabour)

  console.log('\n-- Derived --')
  ok &= compare('Engine oil MTD', Math.round(metrics.engineOilMtd || 0), EXPECTED.engineOilMtd)
  ok &= compare('Average RO', Math.round(metrics.averageRo || 0), EXPECTED.averageRo)
  ok &= compare('Avg labour / RO', Math.round(metrics.avgLabourPerRo || 0), EXPECTED.avgLabourPerRo, 5)
  ok &= compare('Labour / RO w/o VAS', Math.round(metrics.labourPerRoWithoutVas || 0), EXPECTED.labourPerRoWithoutVas, 5)

  if (metrics.vasAmount != null) {
    const impliedVas = EXPECTED.labourMtd - EXPECTED.labourPerRoWithoutVas * 134
    console.log(`\nNote: VAS amount=${metrics.vasAmount}; reference implies ~${impliedVas} (adv_wise June may be missing)`)
  }

  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
