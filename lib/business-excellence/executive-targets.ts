/**
 * ⚠️ PLACEHOLDER LITERALS — NOT TARGETS ANYONE AT AM GROUP SET.
 *
 * Every number below is a hand-written constant with no database, admin screen or management sign-
 * off behind it, and the revenue figures are **period-blind**: the same ₹30,00,000 is compared
 * against a one-day window, a month and a full financial year alike, so "Revenue Target 12%" on a
 * short range is meaningless rather than bad news.
 *
 * They are kept because a rough watch-level is better than nothing on an ops screen, but anything
 * rendered from them MUST be labelled with TARGET_SOURCE_NOTE so nobody reads them as agreed
 * numbers. Replace with per-period targets from a real source before treating them as performance
 * measures. See also LY_GROWTH_TARGET_MULTIPLIER in the KIA BE page, which has the same problem.
 */
export const TARGET_SOURCE_NOTE = 'indicative benchmark, not an agreed target'

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

