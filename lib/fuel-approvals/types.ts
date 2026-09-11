export type FuelLocation = 'KIA JAMMU' | 'KIA UDHAMPUR' | 'KIA BANIHAL'

export type FuelRequiredFor =
  | 'DEMO'
  | 'GENSET'
  | 'NEW DELIVERY'
  | 'STOCK YARD'
  | 'STOCK TRANSFER'
  | 'DISPLAY VEH'
  | 'PAINT BOOTH -KIA -GANYAL'
  | 'CPO'
  | 'OTHER'

export type FuelType = 'PETROL' | 'DIESEL'

export type FuelApprovalStatus =
  | 'ceo_pending'
  | 'ceo_on_hold'
  | 'accounts_pending'
  | 'accounts_on_hold'
  | 'approved'
  | 'rejected'
  | 'sent_back'
  // Legacy status support for historical records
  | 'ea_pending'
  | 'ea_on_hold'
  | 'md_pending'
  | 'md_on_hold'
  | 'ed_pending'
  | 'ed_on_hold'
  | 'hr_pending'
  | 'hr_on_hold'

export type FuelApprovalStage = 'ceo' | 'accounts' | 'completed' | 'rejected' | 'submitter' | 'ea' | 'md' | 'ed' | 'hr'

export interface FuelApprovalHistoryItem {
  id: string
  action: 'SUBMIT' | 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESUBMIT'
  stage: 'ceo' | 'accounts' | 'submitter' | 'ea' | 'md' | 'ed' | 'hr'
  userId: string
  userName: string
  userEmail: string
  userRole: string
  remarks?: string
  timestamp: string
}

export interface FuelApprovalRecord {
  id: string
  requestNumber: string
  brand: string
  location: FuelLocation | string
  fuelRequiredFor: FuelRequiredFor | string
  vehRegNo: string
  vinNo: string
  lastFuelFilledDate: string | null
  fuelType: FuelType | string
  currentKmReading: string | null
  fuelFilledDate: string
  fuelFilledLtrs: string | number
  fuelSlipUrl: string
  remarks: string | null
  status: FuelApprovalStatus
  currentStage: FuelApprovalStage

  ceoApprovedBy?: string | null
  ceoApprovedByName?: string | null
  ceoApprovedAt?: string | null
  ceoRemarks?: string | null

  accountsApprovedBy?: string | null
  accountsApprovedByName?: string | null
  accountsApprovedAt?: string | null
  accountsRemarks?: string | null

  eaApprovedBy?: string | null
  eaApprovedByName?: string | null
  eaApprovedAt?: string | null
  eaRemarks?: string | null

  edApprovedBy?: string | null
  edApprovedByName?: string | null
  edApprovedAt?: string | null
  edRemarks?: string | null

  hrApprovedBy?: string | null
  hrApprovedByName?: string | null
  hrApprovedAt?: string | null
  hrRemarks?: string | null

  mdApprovedBy?: string | null
  mdApprovedByName?: string | null
  mdApprovedAt?: string | null
  mdRemarks?: string | null

  rejectedBy?: string | null
  rejectedByName?: string | null
  rejectedAt?: string | null
  rejectStage?: string | null
  rejectRemarks?: string | null

  sendBackReason?: string | null

  submittedById?: string | null
  submittedByName: string
  submittedByEmail: string

  history: FuelApprovalHistoryItem[]

  createdAt: string | Date
  updatedAt: string | Date
}
