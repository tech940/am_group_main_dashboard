import 'dotenv/config'

async function main() {
  const t = async <T>(label: string, fn: () => Promise<T>) => {
    const start = Date.now()
    try {
      await fn()
      console.log(`${label}: ${((Date.now() - start) / 1000).toFixed(2)}s`)
    } catch (e) {
      console.log(`${label}: FAILED ${((Date.now() - start) / 1000).toFixed(2)}s — ${e instanceof Error ? e.message : e}`)
    }
  }

  const { getKiaRetailReview } = await import('../lib/kia/retail-review')
  const { getKiaConversionPanel, getKiaExchangePanel, getKiaAccessoriesPanel } = await import('../lib/kia/retail-review-panels')
  const { getKiaBookingsPanel, getKiaEnquiryPanel } = await import('../lib/kia/retail-review-pipeline')

  await t('retail      ', () => getKiaRetailReview({ currentYear: 2026, previousYear: null }))
  await t('conversion  ', () => getKiaConversionPanel(2026))
  await t('bookings    ', () => getKiaBookingsPanel(2026))
  await t('enquiries   ', () => getKiaEnquiryPanel(2026))
  await t('exchange    ', () => getKiaExchangePanel(2026))
  await t('accessories ', () => getKiaAccessoriesPanel(2026))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
