// Shared types for the Petty Cash workspace. Fields mirror the API payload,
// which returns a mix of camelCase and snake_case — normalize helpers in
// pc-shared.tsx resolve both.

export type PettyCashUser = {
  id: string
  role: string
  brand: string | null
  fullName: string
  email: string
}

export type PettyCashCategory = {
  id: string
  name: string
  slug: string
}

export type PettyCashAllocation = {
  id: string
  allocationNumber?: string
  allocation_number?: string
  branchId?: string
  branch_id?: string
  allocatedAmount?: string
  allocated_amount?: string
  spentAmount?: string
  spent_amount?: string
  remainingAmount?: string
  status: string
  allocatedAt?: string
  allocated_at?: string
}

export type PettyCashRequest = {
  id: string
  requestNumber?: string
  request_number?: string
  branchId?: string
  branch_id?: string
  status: string
  currentStage?: string
  current_stage?: string
  requestedByName?: string
  requested_by_name?: string
  requestedAmount?: string
  requested_amount?: string
  purpose: string
  location?: string | null
  department?: string | null
  requestForm?: Record<string, unknown> | null
  createdBy?: string
  created_by?: string
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

export type PettyCashExpense = {
  id: string
  expenseNumber?: string
  expense_number?: string
  allocationId?: string
  allocation_id?: string
  branchId?: string
  branch_id?: string
  status: string
  currentStage?: string
  current_stage?: string
  expenseDate?: string
  expense_date?: string
  particulars: string
  amount: string
  vendorName?: string | null
  vendor_name?: string | null
  receivedBy?: string | null
  received_by?: string | null
  purpose: string
  location?: string | null
  department?: string | null
  createdBy?: string
  created_by?: string
  createdAt?: string
  created_at?: string
}

export type PettyCashLedgerEntry = {
  id: string
  entryType?: string
  entry_type?: string
  branchId?: string
  branch_id?: string
  amount: string
  balanceAfter?: string
  balance_after?: string
  description: string
  location?: string | null
  createdAt?: string
  created_at?: string
}

export type PettyCashSummary = {
  allocationAmount: number
  spentAmount: number
  remainingAmount: number
  canRequestTopUp: boolean
  canSubmitExpense: boolean
  topUpThreshold: number
  topUpReason: string
  pendingRequestCount: number
  pendingExpenseCount: number
  requestCount: number
  expenseCount: number
  /* Lifetime figures — computed in Postgres over every allocation the user may see, since petty
     cash began. Deliberately independent of the Allocations tab filter, which the KPI row used to
     inherit (so "total spent" quietly meant "spent on still-open allocations"). */
  lifetimeAllocated?: number
  lifetimeSpent?: number
  lifetimeAllocationCount?: number
  openAllocationCount?: number
  /** Unspent cash right now — a present-tense quantity, so open floats only. */
  remainingNow?: number
  /** ISO timestamp of the first allocation ever, for the "since …" subtitle. */
  since?: string | null
}

export type DashboardPayload = {
  user: PettyCashUser
  categories: PettyCashCategory[]
  currentAllocation: PettyCashAllocation | null
  requests: PettyCashRequest[]
  expenses: PettyCashExpense[]
  summary: PettyCashSummary
}

export type RequestFormState = {
  location: string
  department: string
  requestedAmount: string
  typeOfPayment: string
  purpose: string
}

export type ExpenseFormState = {
  allocationId: string
  expenseDate: string
  categoryId: string
  amount: string
  vendorName: string
  receivedBy: string
  location: string
  purpose: string
}

export const EMPTY_REQUEST_FORM: RequestFormState = {
  location: '',
  department: '',
  requestedAmount: '',
  typeOfPayment: '',
  purpose: '',
}

export const EMPTY_EXPENSE_FORM: ExpenseFormState = {
  allocationId: '',
  expenseDate: new Date().toLocaleDateString('en-CA'),
  categoryId: '',
  amount: '',
  vendorName: '',
  receivedBy: '',
  location: '',
  purpose: '',
}

export type RequestWorkflowAction = 'approve' | 'reject' | 'hold'
export type ApprovalStage = 'ed_approval' | 'ea_approval' | 'md_approval' | 'accounts'
