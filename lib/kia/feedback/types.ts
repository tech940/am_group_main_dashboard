export type FeedbackRow = {
  id: string
  dealerCode: string
  branch: string
  customerName: string | null
  mobile: string | null
  model: string | null
  consultantName: string | null
  overallRating: number
  staffCourtesyRating: number | null
  testDriveRating: number | null
  showroomAmbienceRating: number | null
  experienceTags: string[]
  remarks: string | null
  source: string
  createdAt: string
}

export type FeedbackDashboardData = {
  rows: FeedbackRow[]
  total: number
  summary: {
    total: number
    avgRating: number
    ratingCounts: { 1: number; 2: number; 3: number; 4: number; 5: number }
    avgCourtesy: number
    avgTestDrive: number
    avgAmbience: number
    positivePct: number
  }
}
