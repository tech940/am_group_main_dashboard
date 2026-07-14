export type SourceKey = 'enquiry' | 'booking' | 'sales' | 'accessories'
export type ReportKey = SourceKey
export type TemperatureKey = 'Hot' | 'Warm' | 'Cold'
export type FinanceModeKey = 'Cash' | 'In-house' | 'Self-Finance'

export type SalesReportMonthOption = {
  key: string
  label: string
  year: number
  month: number
  sourceKeys: SourceKey[]
}

export type SalesReportFreshnessSource = {
  key: SourceKey
  label: string
  sourceUpdatedAt: string | null
  rowCount: number
  minDate: string | null
  maxDate: string | null
  availableMonths: string[]
}

export type SalesReportFreshnessPayload = {
  selectedMonthKey: string
  sourceUpdatedAt: string | null
  availableMonths: SalesReportMonthOption[]
  dealerOptions: string[]
  sources: SalesReportFreshnessSource[]
  coverageWarnings: string[]
}

export type SalesReportKpi = {
  label: string
  value: number
  formattedValue: string
  comparisonValue: number
  formattedComparisonValue: string
  comparisonLabel: string
  comparisonContext?: string | null
  changePct: number | null
  changeLabel: string
  trendDirection?: 'higher_is_better' | 'lower_is_better'
}

export type SalesReportMetricPoint = {
  name: string
  value: number
}

export type SalesReportSourceCard = {
  source: string
  enquiries: number
  bookings: number
  enquirySharePct: number
  conversionPct: number
  highlightWalkIn: boolean
}

export type SalesReportConsultantRow = {
  consultant: string
  enquiries: number
  bookings: number
  bookingRatePct: number
  walkinEnquiries: number
  walkinBookings: number
  walkinConversionPct: number
  testDrives: number
  tdRatePct: number
}

export type SalesReportLostRow = {
  enquiryDate: string | null
  customer: string
  phone: string
  model: string
  source: string
  consultant: string
  status: string
  lostReason: string
  lostDueTo: string
  lostRemark: string
}

export type SalesRetailTransaction = {
  rowKey: string
  customerName: string
  phone: string
  model: string
  variant: string
  color: string
  consultant: string
  source: string
  financeType: string
  financier: string
  exShowroomPrice: number
  invoiceDate: string | null
  deliveryDate: string | null
  customerId: string
  deliveryDays: number | null
  vin: string
  accessoriesValue: number
  accessoriesCount: number
}

export type SalesRetailModelCard = {
  model: string
  units: number
  revenue: number
  avgPrice: number
  avgDeliveryDays: number | null
  variants: Array<{ name: string; count: number }>
  colors: Array<{ name: string; count: number }>
  financeBreakdown: Array<{ name: FinanceModeKey; count: number }>
}

export type SalesReportSummaryPayload = {
  context: {
    selectedMonthKey: string
    selectedMonthLabel: string
    comparisonMonthKey: string
    comparisonMonthLabel: string
    startDate?: string
    endDate?: string
    comparisonStartDate?: string
    comparisonEndDate?: string
    rangeMode?: 'month' | 'custom'
  }
  assumptions: string[]
  overview: {
    kpis: SalesReportKpi[]
    enquiryStatus: SalesReportMetricPoint[]
    sourceShare: SalesReportMetricPoint[]
    dealerSummary: SalesReportMetricPoint[]
    leadTemperature: Array<{ name: TemperatureKey; value: number }>
    testDrive: Array<{ name: string; value: number }>
    funnel: SalesReportMetricPoint[]
    topModels: SalesReportMetricPoint[]
    sourceCards: SalesReportSourceCard[]
    walkinSpotlight: {
      enquiries: number
      sharePct: number
      message: string
    }
  }
  models: {
    sourceOptions: string[]
    items: Array<{ model: string; enquiries: number; bookings: number }>
    topFive: SalesReportMetricPoint[]
    /** Completed test drives (td_status = "Done") grouped by model, ranked high → low. */
    testDrivesByModel: Array<{ model: string; testDrives: number }>
    /** Completed test drives grouped by model + variant, ranked high → low. */
    testDrivesByModelVariant: Array<{ model: string; variant: string; testDrives: number }>
    sourceBreakdown: Record<string, Array<{ model: string; enquiries: number; bookings: number }>>
  }
  sources: {
    items: Array<{ source: string; enquiries: number; bookings: number; sharePct: number; conversionPct: number }>
    dealerMatrix: Array<{ dealer: string; values: Array<{ source: string; enquiries: number }> }>
    walkinSpotlight: {
      enquiries: number
      sharePct: number
      message: string
    }
  }
  team: {
    leaderboard: SalesReportConsultantRow[]
    comparison: Array<{ consultant: string; enquiries: number; bookings: number }>
  }
  trend: {
    daily: Array<{ day: string; enquiries: number }>
    weeks: Array<{ week: string; dates: string; total: number; avg: number; peak: string }>
    trendNote: string
  }
  lost: {
    totalLost: number
    lostRatePct: number
    lostRateChangePct: number | null
    reasons: SalesReportMetricPoint[]
    consultants: SalesReportMetricPoint[]
    models: SalesReportMetricPoint[]
    sources: SalesReportMetricPoint[]
    rows: SalesReportLostRow[]
  }
  retail: {
    kpis: Array<{ label: string; value: number; formattedValue: string }>
    modelCards: SalesRetailModelCard[]
    financeSummary: Array<{ name: FinanceModeKey; units: number; sharePct: number }>
    financiers: Array<{ financier: string; count: number }>
    financeByModel: Array<{ model: string; Cash: number; 'In-house': number; 'Self-Finance': number }>
    financeByConsultant: Array<{ consultant: string; Cash: number; 'In-house': number; 'Self-Finance': number }>
    transactions: SalesRetailTransaction[]
    accessories: {
      totalRevenue: number
      totalItems: number
      avgPerCar: number
      crossSellRatePct: number
      matchedRetailUnits: number
    }
  }
  missedFollowups?: {
    count: number
    byModel: SalesReportMetricPoint[]
    byConsultant: SalesReportMetricPoint[]
    bySource: SalesReportMetricPoint[]
  } | null
}

export type SalesReportListPayload = {
  // 'test_drives' is a filtered view of the enquiry report (td_status = "Done"), not a real source.
  report: ReportKey | 'test_drives'
  title: string
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

export type SalesReportCsvPayload = {
  fileName: string
  content: string
}
