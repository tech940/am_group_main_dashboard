export interface ScrapLocation {
  id: string
  name: string
  code: string
  address?: string
}

export interface ScrapDepartment {
  id: string
  name: string
  code: string
}

export interface ScrapType {
  id: string
  name: string
  unit: 'Kg' | 'Ltr' | 'Pcs' | 'Ton'
  defaultRatePerUnit: number
}

export interface ScrapDescription {
  id: string
  scrapTypeId?: string
  name: string
}

export interface ScrapEmployee {
  id: string
  name: string
  role: string
  phone?: string
}

export interface ScrapPaymentMode {
  id: string
  name: string
  isOnline: boolean
}

export interface ScrapHandoverUser {
  id: string
  name: string
  designation?: string
}

export interface ScrapGroup {
  id: string
  name: string
  code?: string
}

export interface ScrapMasterDataItem {
  id: string
  category: 'location' | 'department' | 'scrap_type' | 'description' | 'sold_by' | 'payment_mode' | 'payment_handover_to' | 'group'
  name: string
  code?: string
  metadata?: Record<string, unknown>
  isActive?: boolean
  sortOrder?: number
}

export interface ScrapAttachment {
  id: string
  transactionId: string
  type: 'weight_picture' | 'tally_receipt' | 'scrap_picture'
  url: string
  fileName: string
  fileSize?: number
  mimeType?: string
}

/** Used in the entry form to track uploaded documents before they are submitted */
export interface ScrapFormAttachment {
  id: string
  url: string
  fileName: string
  fileType: 'image' | 'pdf' | 'document'
  type: 'weight_picture' | 'tally_receipt' | 'scrap_picture'
  size?: number
}

export interface ScrapTransaction {
  id: string
  transactionNumber: string
  timestamp: string
  groupId?: string
  groupName?: string
  locationId: string
  locationName: string
  departmentId: string
  departmentName: string
  scrapTypeId: string
  scrapTypeName: string
  unit: string
  description: string
  weightQty: number
  ratePerUnit: number
  calculatedTotal: number
  amountReceived: number
  outstandingAmount: number
  soldById: string
  soldByName: string
  soldTo: string
  soldDate: string
  paymentModeId: string
  paymentModeName: string
  paymentHandoverToId: string
  paymentHandoverToName: string
  remarks?: string
  status: 'COMPLETED' | 'FLAGGED' | 'DRAFT'
  attachments: ScrapAttachment[]
  isDistributed?: boolean
  distributedAt?: string
  distributedBy?: string
  /** When true, this transaction's revenue was routed directly to accounts (not distributed to shareholders) */
  sentToAccounts?: boolean
  accountsReceivedAt?: string
  accountsNote?: string
  createdAt: string
  updatedAt: string
}

export interface ScrapFilterState {
  dateRange: 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'quarter' | 'year'
  startDate?: string
  endDate?: string
  groups: string[]
  locations: string[]
  departments: string[]
  scrapTypes: string[]
  soldBy: string[]
  paymentModes: string[]
  handoverUsers: string[]
  minAmount?: number
  maxAmount?: number
  minWeight?: number
  maxWeight?: number
  searchQuery: string
  status?: string
}

export interface ScrapKpiMetrics {
  totalRevenue: number
  totalWeight: number
  totalTransactions: number
  avgSellingRate: number
  amountReceived: number
  outstandingAmount: number
  cashCollection: number
  onlineCollection: number
  chequeCollection: number
  avgRevenuePerTxn: number
  highestRevenueLocation: { name: string; amount: number }
  highestRevenueDepartment: { name: string; amount: number }
  highestSellingScrapType: { name: string; amount: number }
  monthlyGrowthPct: number
  yearlyGrowthPct: number
  collectionEfficiencyPct: number
  forecastNextMonthRevenue: number
}

export interface ScrapAiInsight {
  id: string
  type: 'trend' | 'anomaly' | 'performance' | 'forecast'
  title: string
  description: string
  severity: 'info' | 'warning' | 'positive'
  metricImpact?: string
  timestamp: string
}

export function normalizeScrapLocationName(rawName: string | null | undefined, groupName?: string | null): string {
  if (!rawName) return ''
  const trimmed = String(rawName).trim()
  const clean = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  const grp = String(groupName || '').toUpperCase()

  // 1. AUTO SQUARE GANGYAL
  if (clean.includes('AUTO SQUARE') || (clean.includes('HYUNDAI') && clean.includes('GANGYAL'))) {
    return 'AM HYUNDAI AUTO SQUARE - GANGYAL'
  }

  // 2. BAJAJ LOCATIONS
  if (clean.includes('BAJAJ') || clean.includes('REHARI') || grp.includes('BAJAJ')) {
    if (clean.includes('TALAB') || clean.includes('TILLO')) return 'BAJAJ - TALAB TILLO'
    if (clean.includes('CHANNI')) return 'BAJAJ - CHANNI'
    if (clean.includes('REHARI') || clean.includes('BAJAJ')) return 'BAJAJ - REHARI'
  }

  // 3. KTM LOCATIONS
  if (clean.includes('KTM') || grp.includes('KTM')) {
    if (clean.includes('CHANNI')) return 'KTM - CHANNI'
    if (clean.includes('GANGYAL') || clean.includes('KTM')) return 'KTM - GANGYAL'
  }

  // 4. DIAMOND HONDA LOCATIONS
  if (clean.includes('HONDA') || clean.includes('DIAMOND') || grp.includes('HONDA') || grp.includes('DIAMOND')) {
    if (clean.includes('DIGIANA')) return 'DIAMOND HONDA - DIGIANA'
    if (clean.includes('CHANNI')) return 'DIAMOND HONDA - CHANNI'
    if (clean.includes('BISNAH') || clean.includes('BISHNAH')) return 'DIAMOND HONDA - BISNAH'
    if (clean.includes('MIRA') || clean.includes('SAHAB') || clean.includes('SAHIB')) return 'DIAMOND HONDA - MIRA SAHAB'
    if (clean.includes('GANGYAL')) return 'DIAMOND HONDA - GANGYAL'
    if (clean.includes('PHALLAN') || clean.includes('MANDAL')) return 'DIAMOND HONDA - PHALLAN MANDAL'
  }

  // 5. KIA LOCATIONS
  if (clean.includes('KIA') || grp.includes('KIA')) {
    if (clean.includes('PALOURA')) return 'AM KIA - PALOURA'
    if (clean.includes('UDHAMPUR')) return 'AM KIA - UDHAMPUR'
    if (clean.includes('GANGYAL') || clean.includes('KIA')) return 'AM KIA - GANGYAL'
  }

  // 6. MG LOCATIONS
  if (clean.includes('MG') || grp.includes('MG')) {
    if (clean.includes('KATHUA')) return 'MG - KATHUA'
    if (clean.includes('CHANNI') || clean.includes('MG')) return 'MG - CHANNI'
  }

  // 7. TATA LOCATIONS
  if (clean.includes('TATA') || clean.includes('SMAM') || grp.includes('TATA') || grp.includes('SMAM')) {
    if (clean.includes('BODY') || clean.includes('CHANNI')) return 'AM TATA BODYSHOP CHANNI'
    if (clean.includes('NARWAL')) return 'AM TATA - NARWAL'
    if (clean.includes('KATHUA')) return 'AM TATA - KATHUA'
    if (clean.includes('SUPWAL')) return 'AM TATA - SUPWAL'
    if (clean.includes('BALCHAMA') || clean.includes('SUNDERBANI')) return 'AM TATA - BALCHAMA SUNDERBANI'
    if (clean.includes('BILLAWAR')) return 'AM TATA - BILLAWAR'
    if (clean.includes('CHANDERKOT') || clean.includes('RAMBAN')) return 'AM TATA - CHANDERKOT RAMBAN'
    if (clean.includes('POONCH')) return 'AM TATA - POONCH'
    if (clean.includes('REASI')) return 'AM TATA - REASI'
    if (clean.includes('LAMBERI')) return 'AM TATA - LAMBERI'
  }

  // 8. PLATINUM (AM HYUNDAI) LOCATIONS
  if (clean.includes('PLATINUM') || clean.includes('PALTINUM') || grp.includes('PLATINUM')) {
    if (clean.includes('RAJOURI')) return 'PLATINUM (AM HYUNDAI) - RAJOURI'
    if (clean.includes('POONCH')) return 'PLATINUM (AM HYUNDAI) - POONCH'
    if (clean.includes('SUNDERBANI')) return 'PLATINUM (AM HYUNDAI) - SUNDERBANI'
    if (clean.includes('MENDOR')) return 'PLATINUM (AM HYUNDAI) - MENDOR'
    if (clean.includes('PALOURA') || clean.includes('PLATINUM') || clean.includes('PALTINUM')) return 'PLATINUM (AM HYUNDAI) - PALOURA'
  }

  // 9. JAMMU AUTO MART (JAM) LOCATIONS
  if (clean.includes('JAMMU') || clean.includes('AUTO MART') || clean.includes('AUTOMART') || grp.includes('JAM')) {
    if (clean.includes('CHANNI') || clean.includes('RAMA')) return 'JAMMU AUTO MART - CHANNI RAMA'
    if (clean.includes('KATHUA')) return 'JAMMU AUTO MART - KATHUA'
    if (clean.includes('SUPWAL')) return 'JAMMU AUTO MART - SUPWAL'
    if (clean.includes('BILLAWAR')) return 'JAMMU AUTO MART - BILLAWAR'
    if (clean.includes('R S PURA') || clean.includes('RS PURA') || clean.includes('R S') || clean.includes('PURA')) return 'JAMMU AUTO MART - R.S PURA'
    if (clean.includes('AKHNOOR')) return 'JAMMU AUTO MART - AKHNOOR'
    if (clean.includes('NANAK') || clean.includes('PROMISE')) return 'JAMMU AUTO MART - NANAK NAGAR (H PROMISE)'
  }

  // 10. Standalone Locality Matches
  if (clean.includes('AKHNOOR')) return 'JAMMU AUTO MART - AKHNOOR'
  if (clean.includes('BILLAWAR')) return 'JAMMU AUTO MART - BILLAWAR'
  if (clean.includes('BISHNAH') || clean.includes('BISNAH')) return 'DIAMOND HONDA - BISNAH'
  if (clean.includes('MIRA SAHIB') || clean.includes('MIRA SAHAB')) return 'DIAMOND HONDA - MIRA SAHAB'
  if (clean.includes('DIGIANA')) return 'DIAMOND HONDA - DIGIANA'
  if (clean.includes('NARWAL')) return 'AM TATA - NARWAL'
  if (clean.includes('PALOURA')) return 'PLATINUM (AM HYUNDAI) - PALOURA'
  if (clean.includes('RAJOURI')) return 'PLATINUM (AM HYUNDAI) - RAJOURI'
  if (clean.includes('POONCH')) return 'PLATINUM (AM HYUNDAI) - POONCH'
  if (clean.includes('R S PURA') || clean.includes('RS PURA')) return 'JAMMU AUTO MART - R.S PURA'
  if (clean.includes('UDHAMPUR')) return 'AM KIA - UDHAMPUR'
  if (clean.includes('KATHUA')) return 'JAMMU AUTO MART - KATHUA'
  if (clean.includes('SUPWAL')) return 'JAMMU AUTO MART - SUPWAL'
  if (clean.includes('CHANNI')) return 'JAMMU AUTO MART - CHANNI RAMA'
  if (clean.includes('GANGYAL')) return 'AM HYUNDAI AUTO SQUARE - GANGYAL'

  return trimmed
}
