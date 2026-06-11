export const EXECUTIVE_TARGETS = {
  overview: {
    revenue: 3000000,
    maxOpenRo: 25,
    maxComplaintsOpen: 2,
  },
  roBilling: {
    revenue: 3000000,
    labourPerVehicle: 3000,
    partsPerVehicle: 5000,
    maxDiscountLeakage: 20000,
  },
  workshop: {
    revenue: 3000000,
    labourPerRo: 3500,
    partsPerRo: 5000,
    vasPenetrationPct: 18,
    addonPenetrationPct: 35,
  },
  openRo: {
    maxOpenRo: 25,
    maxAvgAgingDays: 5,
    maxOver15Days: 0,
    maxDelayedRo: 0,
  },
  complaints: {
    closureRatePct: 90,
    maxOpenComplaints: 2,
    maxAvgResolutionDays: 3,
  },
  demoJobCards: {
    complianceRatePct: 100,
    remarkCoveragePct: 100,
    maxOverdueVehicles: 0,
  },
} as const

