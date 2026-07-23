import { ScrapTransaction } from './types'

export type ShareholderKey = 'sanjay' | 'ankur' | 'sanjeev'

export type ShareholderInfo = {
  key: ShareholderKey
  name: string
  color: string
}

export const SHAREHOLDERS: ShareholderInfo[] = [
  { key: 'sanjay', name: 'Sanjay Mahajan', color: '#0284c7' }, // Sky/Blue
  { key: 'ankur', name: 'Ankur Mahajan', color: '#16a34a' },  // Green
  { key: 'sanjeev', name: 'Sanjeev Mahajan', color: '#d97706' }, // Amber
]

export type CompanyShareConfig = {
  matchKeys: string[]
  displayName: string
  shares: Record<ShareholderKey, number> // Percentage e.g. 70 means 70%
}

export const COMPANY_SHARE_CONFIGS: CompanyShareConfig[] = [
  {
    matchKeys: ['JAM', 'JAMMU AUTOMART', 'JAMMU AUTO MART'],
    displayName: 'JAMMU AUTOMART',
    shares: { sanjay: 70, ankur: 30, sanjeev: 0 },
  },
  {
    matchKeys: ['PLATINUM', 'PLATINUM AUTO'],
    displayName: 'PLATINUM AUTO',
    shares: { sanjay: 50, ankur: 50, sanjeev: 0 },
  },
  {
    matchKeys: ['MG', 'AM MG', 'MG MOTORS'],
    displayName: 'AM MG',
    shares: { sanjay: 50, ankur: 50, sanjeev: 0 },
  },
  {
    matchKeys: ['SMAM TATA', 'SMAM', 'TATA'],
    displayName: 'SMAM TATA',
    shares: { sanjay: 33.333333333333336, ankur: 33.333333333333336, sanjeev: 33.333333333333336 },
  },
  {
    matchKeys: ['BAJAJ', 'AM BAJAJ'],
    displayName: 'AM BAJAJ',
    shares: { sanjay: 33.333333333333336, ankur: 33.333333333333336, sanjeev: 33.333333333333336 },
  },
  {
    matchKeys: ['DIAMOND', 'DIAMOND AUTO'],
    displayName: 'DIAMOND AUTO',
    shares: { sanjay: 70, ankur: 0, sanjeev: 30 },
  },
]

export const DEFAULT_COMPANY_SHARE: Record<ShareholderKey, number> = {
  sanjay: 50,
  ankur: 50,
  sanjeev: 0,
}

export function getCompanyShareConfig(companyName: string): { displayName: string; shares: Record<ShareholderKey, number> } {
  const upper = String(companyName || '').trim().toUpperCase()
  for (const cfg of COMPANY_SHARE_CONFIGS) {
    if (cfg.matchKeys.some((k) => k.toUpperCase() === upper || upper.includes(k.toUpperCase()))) {
      return { displayName: cfg.displayName, shares: cfg.shares }
    }
  }
  return {
    displayName: companyName ? companyName.toUpperCase() : 'OTHER COMPANY',
    shares: DEFAULT_COMPANY_SHARE,
  }
}

export type CompanyDistributionRow = {
  company: string
  totalRevenue: number
  transactionCount: number
  shares: Record<ShareholderKey, number> // %
  shareAmounts: Record<ShareholderKey, number> // ₹
  txns: ScrapTransaction[]
}

export type DistributionSummary = {
  totalRevenue: number
  totalTransactions: number
  personTotals: Record<ShareholderKey, { name: string; amount: number; percentage: number; txns: ScrapTransaction[] }>
  companyRows: CompanyDistributionRow[]
}

export function calculateScrapDistribution(transactions: ScrapTransaction[]): DistributionSummary {
  const companyMap: Record<string, { totalRevenue: number; txns: ScrapTransaction[] }> = {}

  let grandTotalRevenue = 0

  transactions.forEach((t) => {
    const rawGroup = t.groupName || 'JAMMU AUTOMART'
    const { displayName } = getCompanyShareConfig(rawGroup)

    const amt = Number(t.amountReceived || 0)
    grandTotalRevenue += amt

    if (!companyMap[displayName]) {
      companyMap[displayName] = { totalRevenue: 0, txns: [] }
    }
    companyMap[displayName].totalRevenue += amt
    companyMap[displayName].txns.push(t)
  })

  const personTotals: Record<ShareholderKey, { name: string; amount: number; percentage: number; txns: ScrapTransaction[] }> = {
    sanjay: { name: 'Sanjay Mahajan', amount: 0, percentage: 0, txns: [] },
    ankur: { name: 'Ankur Mahajan', amount: 0, percentage: 0, txns: [] },
    sanjeev: { name: 'Sanjeev Mahajan', amount: 0, percentage: 0, txns: [] },
  }

  const companyRows: CompanyDistributionRow[] = Object.entries(companyMap).map(([company, data]) => {
    const { shares } = getCompanyShareConfig(company)

    const shareAmounts: Record<ShareholderKey, number> = {
      sanjay: (data.totalRevenue * (shares.sanjay || 0)) / 100,
      ankur: (data.totalRevenue * (shares.ankur || 0)) / 100,
      sanjeev: (data.totalRevenue * (shares.sanjeev || 0)) / 100,
    }

    // Accumulate to person totals
    const keys: ShareholderKey[] = ['sanjay', 'ankur', 'sanjeev']
    keys.forEach((key) => {
      personTotals[key].amount += shareAmounts[key]
      if (shareAmounts[key] > 0) {
        personTotals[key].txns.push(...data.txns)
      }
    })

    return {
      company,
      totalRevenue: data.totalRevenue,
      transactionCount: data.txns.length,
      shares,
      shareAmounts,
      txns: data.txns,
    }
  }).sort((a, b) => b.totalRevenue - a.totalRevenue)

  // Calculate overall percentage for each person
  if (grandTotalRevenue > 0) {
    const keys: ShareholderKey[] = ['sanjay', 'ankur', 'sanjeev']
    keys.forEach((key) => {
      personTotals[key].percentage = (personTotals[key].amount / grandTotalRevenue) * 100
    })
  }

  return {
    totalRevenue: grandTotalRevenue,
    totalTransactions: transactions.length,
    personTotals,
    companyRows,
  }
}
