import 'dotenv/config'

/** Times each component of the Group Cockpit payload to find where the minutes go. */
async function main() {
  const t = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    const start = Date.now()
    try {
      const out = await fn()
      console.log(`${label}: ${((Date.now() - start) / 1000).toFixed(1)}s`)
      return out
    } catch (e) {
      console.log(`${label}: FAILED after ${((Date.now() - start) / 1000).toFixed(1)}s — ${e instanceof Error ? e.message : e}`)
      return null
    }
  }

  const { fetchCanonicalHyundaiRoBillingMetrics } = await import('../lib/hyundai/business-excellence-metrics')
  const { fetchCanonicalRoBillingMetrics } = await import('../lib/platinum/business-excellence-metrics')
  const { getKiaWorkshopSummary } = await import('../lib/kia/workshop-summary')
  const { getCaBranchSummary } = await import('../lib/ca/ca-data')

  // Mirror cockpit windows for Aug 2026 through today (8th)
  const cy = { cyStart: '2026-08-01', cyEnd: '2026-08-08', lyStart: '2025-08-01', lyEnd: '2025-08-08' }

  await t('hyundai canonical audit (cold-ish)', () => fetchCanonicalHyundaiRoBillingMetrics(cy))
  await t('platinum canonical audit         ', () => fetchCanonicalRoBillingMetrics(cy))
  await t('kia workshop summary             ', () => getKiaWorkshopSummary({ endDate: cy.cyEnd }))
  await t('ca branch summary (cash)         ', () => getCaBranchSummary({ from: null, to: null }))

  const { getGroupCockpit } = await import('../lib/cockpit/cockpit-data')
  await t('getGroupCockpit FULL (warm cache)', () => getGroupCockpit({ endDate: null }))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
