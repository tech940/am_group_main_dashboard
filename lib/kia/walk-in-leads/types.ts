/** What the Walk-in Leads API returns. Client-safe: types only. Dates are YYYY-MM-DD, instants ISO. */

export type WalkInLead = {
  id: string
  enquiryDate: string
  dealerCode: string
  branch: string
  customerName: string
  /** Real only for MD / Developer / Finance Head (and the other KIA PII roles); `••••••` for everyone else. */
  mobile: string
  countryCode: string
  email: string | null
  address: string | null
  model: string
  consultantName: string
  testDrive: boolean
  enquirySource: string
  customerType: string | null
  exchange: boolean | null
  exchangeDetails: string | null
  additionalInfo: string | null
  expectedBookingDate: string | null
  remarks: string | null
  booked: boolean
  source: 'form' | 'import'
  submittedAt: string
  updatedAt: string
  updatedByName: string | null
  /** The same mobile visited before this lead. Worked out on the server, so it holds even when the number is masked. */
  repeatVisit: boolean
}

export type WalkInBreakdown = { key: string; count: number; testDrives: number; booked: number }

export type WalkInSummary = {
  total: number
  testDrives: number
  booked: number
  exchange: number
  newCustomers: number
  existingCustomers: number
  repeatVisits: number
  byModel: WalkInBreakdown[]
  bySource: WalkInBreakdown[]
  byConsultant: WalkInBreakdown[]
  byDay: Array<{ date: string; count: number }>
}

export type WalkInFilters = {
  from: string
  to: string
  dealer: string | null
  model: string | null
  consultant: string | null
  source: string | null
  booked: 'yes' | 'no' | null
  testDrive: 'yes' | 'no' | null
  q: string
  page: number
  pageSize: number
}

export type WalkInListResponse = {
  rows: WalkInLead[]
  total: number
  filters: WalkInFilters
  summary: WalkInSummary
  consultants: string[]
  branches: Array<{ code: string; label: string }>
  canViewPii: boolean
  can: { create: boolean; edit: boolean; delete: boolean }
  today: string
}

export type WalkInFormLink = { dealerCode: string; branch: string; path: string }
