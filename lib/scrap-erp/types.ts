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
