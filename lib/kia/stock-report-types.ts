export type KiaStockStatus = 'Free Stock' | 'In transit'
export type KiaStockTab = 'overview' | 'models' | 'dealers' | 'movement' | 'aging' | 'reports'
export type KiaStockDateMode = 'grn_date' | 'departure_date' | 'order_date' | 'retail_date'

export type KiaStockMonthOption = {
  key: string
  label: string
  year: number
  month: number
}

export type KiaStockFreshnessPayload = {
  selectedMonthKey: string
  sourceUpdatedAt: string | null
  minDate: string | null
  maxDate: string | null
  rowCount: number
  availableMonths: KiaStockMonthOption[]
  dealerOptions: string[]
  statusOptions: string[]
}

export type KiaStockKpi = {
  label: string
  value: number
  formattedValue: string
  helper: string
}

export type KiaStockMetricPoint = {
  name: string
  value: number
}

export type KiaStockModelCard = {
  model: string
  units: number
  stockValue: number
  avgAge: number
  freeStock: number
  inTransit: number
  variants: KiaStockMetricPoint[]
  colors: KiaStockMetricPoint[]
}

export type KiaStockDealerRow = {
  dealer: string
  total: number
  freeStock: number
  inTransit: number
  stockValue: number
  avgAge: number
  aging: KiaStockMetricPoint[]
}

export type KiaStockVehicleRow = {
  rowKey: string
  dealer: string
  stockStatus: string
  model: string
  variant: string
  color: string
  vin: string
  stockAge: number
  stockValue: number
  grnDate: string | null
  departureDate: string | null
  stockLocation: string
  blocked: string
}

export type KiaStockSummaryPayload = {
  context: {
    selectedMonthKey: string
    selectedMonthLabel: string
    startDate: string
    endDate: string
    updatedAt: string | null
    dealerCode: string | null
    dateMode: KiaStockDateMode
  }
  overview: {
    kpis: KiaStockKpi[]
    dealerSplit: KiaStockMetricPoint[]
    modelMix: KiaStockMetricPoint[]
    statusMix: KiaStockMetricPoint[]
    agingBuckets: KiaStockMetricPoint[]
    highValue: KiaStockVehicleRow[]
    slowMoving: KiaStockVehicleRow[]
  }
  models: {
    cards: KiaStockModelCard[]
    variantMix: KiaStockMetricPoint[]
    colorMix: KiaStockMetricPoint[]
  }
  dealers: {
    rows: KiaStockDealerRow[]
  }
  movement: {
    arrivals: KiaStockMetricPoint[]
    statusCounts: KiaStockMetricPoint[]
    monthly: Array<{ month: string; arrivals: number; retail: number; transfers: number; testDrive: number }>
  }
  aging: {
    buckets: KiaStockMetricPoint[]
    byModel: Array<{ model: string; avgAge: number; units: number }>
    rows: KiaStockVehicleRow[]
  }
}

export type KiaStockReportPayload = {
  columns: string[]
  defaultVisibleColumns: string[]
  rows: Record<string, unknown>[]
  uniqueValues: Record<string, string[]>
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
}

export type KiaStockCsvPayload = {
  fileName: string
  content: string
}
