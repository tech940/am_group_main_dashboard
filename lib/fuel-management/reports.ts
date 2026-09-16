/**
 * The Fuel Management report catalogue — shared by the Reports tab and GET /api/fuel-management/export.
 * No imports: the screen and the server both read it.
 */

export type FuelReportId =
  | 'daily'
  | 'monthly'
  | 'transactions'
  | 'vehicles'
  | 'branches'
  | 'departments'
  | 'purposes'
  | 'approved-vs-actual'
  | 'mileage'
  | 'cost-per-km'
  | 'exceptions'
  | 'high-consumption'

export type FuelReportGroup = 'Period' | 'Vehicles' | 'Organisation' | 'Accountability'

export const FUEL_REPORTS: readonly { id: FuelReportId; group: FuelReportGroup; title: string; description: string }[] = [
  { id: 'daily', group: 'Period', title: 'Daily fuel report', description: 'Requests, requested, approved and actual litres, and spend for each day.' },
  { id: 'monthly', group: 'Period', title: 'Monthly fuel report', description: 'The same figures by month, for periods that span months.' },
  { id: 'transactions', group: 'Period', title: 'Fuel record register', description: 'Every fuel record with its vehicle, quantities, bill, gate pass and state.' },
  { id: 'vehicles', group: 'Vehicles', title: 'Vehicle-wise fuel report', description: 'Fuel, spend, distance, mileage and cost per km for each vehicle.' },
  { id: 'mileage', group: 'Vehicles', title: 'Mileage report', description: 'Measured mileage against the expected figure, with how each was measured.' },
  { id: 'cost-per-km', group: 'Vehicles', title: 'Cost per km report', description: 'Fuel cost per kilometre for vehicles with billed full-tank stretches.' },
  { id: 'high-consumption', group: 'Vehicles', title: 'High consumption vehicles', description: 'Vehicles ranked by fuel used, against the previous period.' },
  { id: 'branches', group: 'Organisation', title: 'Branch-wise fuel report', description: 'Fuel and spend by branch.' },
  { id: 'departments', group: 'Organisation', title: 'Department-wise fuel report', description: 'Fuel and spend by the department using it.' },
  { id: 'purposes', group: 'Organisation', title: 'Fuel usage by purpose', description: 'Fuel and spend by what it was for.' },
  { id: 'approved-vs-actual', group: 'Accountability', title: 'Approved vs actual', description: 'Records with both figures, and the difference on each.' },
  { id: 'exceptions', group: 'Accountability', title: 'Fuel exception report', description: 'Every exception with its measurement and review.' },
]

export function isFuelReportId(value: unknown): value is FuelReportId {
  return FUEL_REPORTS.some((report) => report.id === value)
}
