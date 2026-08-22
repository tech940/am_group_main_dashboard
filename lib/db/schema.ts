import { pgTable, uuid, text, timestamp, boolean, integer, decimal, jsonb, pgEnum, index, uniqueIndex, bigint, date } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Enums
export const roleEnum = pgEnum('role', ['admin', 'developer', 'branch_admin', 'ceo', 'purchase_manager', 'finance_head', 'ea', 'md', 'eba', 'accounts', 'manager', 'technician', 'viewer', 'service_manager', 'general_manager', 'sales_head', 'sales_executive', 'sales_manager', 'finance_team', 'service_general_manager', 'call_agent', 'ca', 'crm', 'idt', 'cre', 'edp', 'cxm', 'ccm', 'ed', 'vp', 'assistant_manager', 'process_coordinator', 'hr'])
export const statusEnum = pgEnum('status', ['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'])
export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'urgent'])
export const vehicleStatusEnum = pgEnum('vehicle_status', ['available', 'in_use', 'maintenance', 'retired'])
export const inventoryStatusEnum = pgEnum('inventory_status', ['in_stock', 'out_of_stock', 'low_stock', 'discontinued'])
export const purchaseOrderStageEnum = pgEnum('purchase_order_stage', ['initial_submission', 'vendor_information', 'ea_approval', 'md_approval', 'grn', 'accounts'])
export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', ['submitted', 'vendor_info_pending', 'awaiting_ea_approval', 'ea_approved', 'ea_denied', 'awaiting_md_approval', 'md_approved', 'md_denied', 'awaiting_grn', 'awaiting_accounts', 'completed', 'cancelled', 'on_hold', 'ea_on_hold', 'md_on_hold'])
export const financeOrderStageEnum = pgEnum('finance_order_stage', ['finance_head_submission', 'accounts_verification', 'ea_approval', 'md_approval', 'completed'])
export const financeOrderStatusEnum = pgEnum('finance_order_status', ['draft', 'awaiting_accounts_verification', 'accounts_verified', 'accounts_denied', 'accounts_on_hold', 'awaiting_ea_approval', 'ea_approved', 'ea_denied', 'ea_on_hold', 'awaiting_md_approval', 'md_approved', 'md_denied', 'md_on_hold', 'completed', 'cancelled'])
export const paymentModeEnum = pgEnum('payment_mode', ['cash', 'cheque', 'bank_transfer', 'upi', 'credit_card', 'other'])
export const pettyCashRequestStatusEnum = pgEnum('petty_cash_request_status', ['draft', 'submitted', 'ed_pending', 'ed_approved', 'ed_on_hold', 'ed_rejected', 'ea_pending', 'ea_approved', 'ea_on_hold', 'ea_rejected', 'md_pending', 'md_approved', 'md_on_hold', 'md_rejected', 'accounts_pending', 'accounts_on_hold', 'approved', 'rejected', 'cancelled'])
export const pettyCashExpenseStatusEnum = pgEnum('petty_cash_expense_status', ['pending', 'ed_pending', 'ed_approved', 'ed_rejected', 'ea_approved', 'ea_rejected', 'md_approved', 'md_rejected', 'accounts_pending', 'approved', 'rejected', 'cancelled'])
export const pettyCashAllocationStatusEnum = pgEnum('petty_cash_allocation_status', ['active', 'closed', 'cancelled'])
export const pettyCashLedgerEntryTypeEnum = pgEnum('petty_cash_ledger_entry_type', ['allocation', 'expense', 'adjustment', 'closure'])

// Users table (extends Supabase auth.users)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  supabaseId: text('supabase_id').unique().notNull(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  role: roleEnum('role').default('viewer').notNull(),
  brand: text('brand'), // Brand/Branch assignment: 'kia', 'tata', 'hyundai', 'honda', 'ktm', 'triumph', 'bajaj', 'mg'
  dealers: text('dealers'), // Optional dealer/branch scope within the brand (comma-separated codes, e.g. 'JK402'). Null = all branches of the brand.
  department: text('department'),
  phoneNumber: text('phone_number'),
  avatarUrl: text('avatar_url'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  isActive: boolean('is_active').default(true).notNull(),
  // Last time the user actually USED the app, not the last time they signed in. Supabase sessions
  // auto-refresh, so an everyday user can go weeks without a fresh login event — last_login would
  // deactivate the most active staff. Written at most once per LAST_SEEN_THROTTLE_MS per user by
  // lib/auth/app-user.ts; read by the auto-deactivation sweep in lib/auth/user-deactivation.ts.
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  usersLastSeenActiveIdx: index('users_last_seen_active_idx').on(table.lastSeenAt),
}))

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  targetUserId: uuid('target_user_id').references(() => users.id),
  action: text('action').notNull(),
  branch: text('branch'),
  beforeValue: jsonb('before_value'),
  afterValue: jsonb('after_value'),
  reason: text('reason'),
  requestMetadata: jsonb('request_metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  adminAuditActorIdx: index('admin_audit_logs_actor_idx').on(table.actorUserId, table.createdAt),
  adminAuditTargetIdx: index('admin_audit_logs_target_idx').on(table.targetUserId, table.createdAt),
  adminAuditBranchIdx: index('admin_audit_logs_branch_idx').on(table.branch, table.createdAt),
}))

// Permission groups table
export const permissionGroups = pgTable('permission_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  name: text('name').notNull(),
  parentKey: text('parent_key'),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  permissionGroupsKeyIdx: uniqueIndex('permission_groups_key_idx').on(table.key),
  permissionGroupsParentIdx: index('permission_groups_parent_idx').on(table.parentKey),
}))

// Permissions table
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  groupKey: text('group_key').references(() => permissionGroups.key, { onDelete: 'cascade' }),
  label: text('label'),
  description: text('description'),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  permissionsNameIdx: uniqueIndex('permissions_name_idx').on(table.name),
  permissionsGroupActionIdx: uniqueIndex('permissions_group_action_idx').on(table.groupKey, table.action),
  permissionsResourceIdx: index('permissions_resource_idx').on(table.resource),
}))

// Role permissions junction table
export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: roleEnum('role').notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
  allowed: boolean('allowed').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  rolePermissionsRolePermissionIdx: uniqueIndex('role_permissions_role_permission_idx').on(table.role, table.permissionId),
  rolePermissionsRoleIdx: index('role_permissions_role_idx').on(table.role),
}))

// User-level overrides. Null/no row means inherit from role template.
export const userPermissions = pgTable('user_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
  allowed: boolean('allowed').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userPermissionsUserPermissionIdx: uniqueIndex('user_permissions_user_permission_idx').on(table.userId, table.permissionId),
  userPermissionsUserIdx: index('user_permissions_user_idx').on(table.userId),
}))

export const permissionAuditLogs = pgTable('permission_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  oldValue: boolean('old_value'),
  newValue: boolean('new_value'),
  source: text('source').default('manual').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  permissionAuditTargetIdx: index('permission_audit_target_idx').on(table.targetUserId, table.createdAt),
  permissionAuditPermissionIdx: index('permission_audit_permission_idx').on(table.permissionId),
}))

// Vehicles table
export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  vin: text('vin').unique().notNull(),
  make: text('make').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  licensePlate: text('license_plate').unique(),
  status: vehicleStatusEnum('status').default('available').notNull(),
  mileage: integer('mileage').default(0),
  purchaseDate: timestamp('purchase_date'),
  purchasePrice: decimal('purchase_price', { precision: 10, scale: 2 }),
  location: text('location'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// Workshop jobs table
export const workshopJobs = pgTable('workshop_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobNumber: text('job_number').unique().notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'restrict' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: statusEnum('status').default('pending').notNull(),
  priority: priorityEnum('priority').default('medium').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  estimatedHours: decimal('estimated_hours', { precision: 5, scale: 2 }),
  actualHours: decimal('actual_hours', { precision: 5, scale: 2 }),
  estimatedCost: decimal('estimated_cost', { precision: 10, scale: 2 }),
  actualCost: decimal('actual_cost', { precision: 10, scale: 2 }),
  startDate: timestamp('start_date'),
  dueDate: timestamp('due_date'),
  completedDate: timestamp('completed_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// Recon workflows table
export const reconWorkflows = pgTable('recon_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowNumber: text('workflow_number').unique().notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'restrict' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: statusEnum('status').default('pending').notNull(),
  priority: priorityEnum('priority').default('medium').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  stage: text('stage').default('inspection'),
  stages: jsonb('stages').$type<{ name: string; status: string; completedAt: Date | null }[]>().default([]),
  startDate: timestamp('start_date'),
  dueDate: timestamp('due_date'),
  completedDate: timestamp('completed_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// Inventory items table
export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').unique().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  quantity: integer('quantity').default(0).notNull(),
  unit: text('unit').notNull(),
  minimumStock: integer('minimum_stock').default(0),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }),
  location: text('location'),
  supplier: text('supplier'),
  status: inventoryStatusEnum('status').default('in_stock').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// Inventory transactions table
export const inventoryTransactions = pgTable('inventory_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id').references(() => inventoryItems.id, { onDelete: 'restrict' }).notNull(),
  type: text('type').notNull(), // 'in', 'out', 'adjustment'
  quantity: integer('quantity').notNull(),
  previousQuantity: integer('previous_quantity').notNull(),
  newQuantity: integer('new_quantity').notNull(),
  reason: text('reason'),
  referenceId: text('reference_id'), // Could link to job, order, etc.
  performedBy: uuid('performed_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Tasks table
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  status: statusEnum('status').default('pending').notNull(),
  priority: priorityEnum('priority').default('medium').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  dueDate: timestamp('due_date'),
  completedDate: timestamp('completed_date'),
  relatedToType: text('related_to_type'), // 'workshop_job', 'recon_workflow', 'vehicle', etc.
  relatedToId: uuid('related_to_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// Comments/Notes table
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  entityType: text('entity_type').notNull(), // 'workshop_job', 'recon_workflow', 'vehicle', etc.
  entityId: uuid('entity_id').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  isInternal: boolean('is_internal').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// Attachments table
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  fileUrl: text('file_url').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

// (The `notifications` table + its Drizzle model were removed with the in-app notification system.
// The physical table is left in the database — drop it separately if you want it gone for good.)

// Activity logs table
export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  changes: jsonb('changes').$type<Record<string, { old: unknown; new: unknown }>>(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const userActivityEvents = pgTable('user_activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  supabaseId: text('supabase_id'),
  email: text('email'),
  sessionId: text('session_id'),
  eventType: text('event_type').notNull(),
  routePath: text('route_path'),
  routeQuery: text('route_query'),
  pageTitle: text('page_title'),
  brand: text('brand'),
  module: text('module'),
  sectionKey: text('section_key'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userActivityEventsUserCreatedIdx: index('user_activity_events_user_created_idx').on(table.userId, table.createdAt),
  userActivityEventsSupabaseCreatedIdx: index('user_activity_events_supabase_created_idx').on(table.supabaseId, table.createdAt),
  userActivityEventsEmailCreatedIdx: index('user_activity_events_email_created_idx').on(table.email, table.createdAt),
  userActivityEventsTypeCreatedIdx: index('user_activity_events_type_created_idx').on(table.eventType, table.createdAt),
  userActivityEventsBrandCreatedIdx: index('user_activity_events_brand_created_idx').on(table.brand, table.createdAt),
  userActivityEventsModuleCreatedIdx: index('user_activity_events_module_created_idx').on(table.module, table.createdAt),
  userActivityEventsSectionCreatedIdx: index('user_activity_events_section_created_idx').on(table.sectionKey, table.createdAt),
  userActivityEventsSessionCreatedIdx: index('user_activity_events_session_created_idx').on(table.sessionId, table.createdAt),
}))

// Dashboard Settings table
export const dashboardSettings = pgTable('dashboard_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  value: jsonb('value').notNull(),
  category: text('category').notNull(), // 'general', 'security', 'notifications', 'backup'
  description: text('description'),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Business Excellence Data table
export const businessExcellenceData = pgTable('business_excellence_am_kia_new', {
  id: uuid('id').primaryKey().defaultRandom(),
  brand: text('brand').notNull(), // 'kia', 'tata', etc.
  sheetName: text('sheet_name').notNull(),
  headers: jsonb('headers').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
})

export const kiaStockLocalStatuses = pgTable('kia_stock_local_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  vinNumber: text('vin_number').unique().notNull(),
  localStatus: text('local_status').notNull(),
  dealerCode: text('dealer_code'),
  model: text('model'),
  variant: text('variant'),
  color: text('color'),
  engineNo: text('engine_no'),
  kinInvoiceNo: text('kin_invoice_no'),
  kinInvoiceDate: text('kin_invoice_date'),
  orderNo: text('order_no'),
  stockStatusAtMark: text('stock_status_at_mark'),
  stockLocation: text('stock_location'),
  bookingNo: text('booking_no'),
  customerId: text('customer_id'),
  customerName: text('customer_name'),
  basicPrice: decimal('basic_price', { precision: 14, scale: 2 }),
  vehicleSnapshot: jsonb('vehicle_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  sourceUploadedAt: timestamp('source_uploaded_at', { withTimezone: true }),
  notes: text('notes'),
  markedBy: uuid('marked_by').references(() => users.id),
  markedByName: text('marked_by_name'),
  markedByRole: text('marked_by_role'),
  markedAt: timestamp('marked_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaStockLocalStatusesVinIdx: uniqueIndex('kia_stock_local_statuses_vin_idx').on(table.vinNumber),
  kiaStockLocalStatusesStatusMarkedIdx: index('kia_stock_local_statuses_status_marked_idx').on(table.localStatus, table.markedAt),
  kiaStockLocalStatusesDealerStatusIdx: index('kia_stock_local_statuses_dealer_status_idx').on(table.dealerCode, table.localStatus),
}))

export type PurchaseOrderVendorOption = {
  key: 'vendorA' | 'vendorB' | 'vendorC'
  label: string
  name: string
  images: string[]
}

// Purchase Orders table
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: text('order_number').unique().notNull(), // Auto-generated: PO-YYYYMMDD-XXX
  currentStage: purchaseOrderStageEnum('current_stage').default('initial_submission').notNull(),
  status: purchaseOrderStatusEnum('status').default('submitted').notNull(),
  
  // Stage 1: Initial Submission (Any User)
  reqType: text('req_type'),
  department: text('department'),
  subDepartment: text('sub_department'),
  specifyOther: text('specify_other'),
  requestedBy: text('requested_by'),
  specialInstructions: text('special_instructions'),
  quantityRequired: text('quantity_required'),
  estimateIfAny: text('estimate_if_any'),
  imagesRequired: boolean('images_required').default(false),
  supportingImages: jsonb('supporting_images').$type<string[]>().default([]),
  
  // Stage 2: Vendor Information (Purchase Manager)
  vendorName: text('vendor_name'),
  vendorImages: jsonb('vendor_images').$type<string[]>().default([]),
  vendorDetails: jsonb('vendor_details').$type<PurchaseOrderVendorOption[]>().default([]),
  billImages: jsonb('bill_images').$type<string[]>().default([]),
  quotation1Url: text('quotation_1_url'),
  quotation2Url: text('quotation_2_url'),
  quotation3Url: text('quotation_3_url'),
  
  // Stage 3: EA & MD Approvals
  eaApprovalStatus: text('ea_approval_status'), // 'pending', 'approved', 'denied'
  eaApprovedBy: uuid('ea_approved_by').references(() => users.id),
  eaApprovedAt: timestamp('ea_approved_at', { withTimezone: true }),
  eaApprovalRemarks: text('ea_approval_remarks'),
  eaHeldAt: timestamp('ea_held_at', { withTimezone: true }),
  eaHeldBy: uuid('ea_held_by').references(() => users.id),
  
  mdApprovalStatus: text('md_approval_status'), // 'pending', 'approved', 'denied'
  mdApprovedBy: uuid('md_approved_by').references(() => users.id),
  mdApprovedAt: timestamp('md_approved_at', { withTimezone: true }),
  mdApprovalRemarks: text('md_approval_remarks'),
  mdHeldAt: timestamp('md_held_at', { withTimezone: true }),
  mdHeldBy: uuid('md_held_by').references(() => users.id),
  
  // Hold management
  holdRemarks: text('hold_remarks'),
  
  // Stage 4: GRN (Purchase Manager)
  receivedDateTime: timestamp('received_date_time', { withTimezone: true }),
  handoverTo: text('handover_to'),
  remarksIfAny: text('remarks_if_any'),
  amount: decimal('amount', { precision: 12, scale: 2 }),
  grnImages: jsonb('grn_images').$type<string[]>().default([]),
  invoice1Url: text('invoice_1_url'),
  invoice2Url: text('invoice_2_url'),
  invoice3Url: text('invoice_3_url'),
  invoice4Url: text('invoice_4_url'),
  
  // Stage 5: Accounts Department
  paymentStatus: text('payment_status'),
  paymentMode: paymentModeEnum('payment_mode'),
  accountRemarks: text('account_remarks'),
  accountsImages: jsonb('accounts_images').$type<string[]>().default([]),
  paymentScreenshotUrl: text('payment_screenshot_url'),
  
  // Workflow Management
  assignedTo: uuid('assigned_to').references(() => users.id),
  workflowLocked: boolean('workflow_locked').default(false),
  
  // Metadata
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  brand: text('brand'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// Finance Orders table
export const financeOrders = pgTable('finance_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: text('order_number').unique().notNull(),
  currentStage: financeOrderStageEnum('current_stage').default('finance_head_submission').notNull(),
  status: financeOrderStatusEnum('status').default('draft').notNull(),
  totalPayoutReceived: decimal('total_payout_received', { precision: 14, scale: 2 }).notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  paymentReceivedDate: timestamp('payment_received_date', { withTimezone: true }).notNull(),
  dsePayout: decimal('dse_payout', { precision: 14, scale: 2 }).notNull(),
  hypBankName: text('hyp_bank_name').notNull(),
  dseName: text('dse_name').notNull(),
  dealer: text('dealer').notNull(),
  accountsVerificationStatus: text('accounts_verification_status'),
  accountsVerifiedBy: uuid('accounts_verified_by').references(() => users.id),
  accountsVerifiedAt: timestamp('accounts_verified_at', { withTimezone: true }),
  accountsVerificationRemarks: text('accounts_verification_remarks'),
  accountsHeldAt: timestamp('accounts_held_at', { withTimezone: true }),
  accountsHeldBy: uuid('accounts_held_by').references(() => users.id),
  eaApprovalStatus: text('ea_approval_status'),
  eaApprovedBy: uuid('ea_approved_by').references(() => users.id),
  eaApprovedAt: timestamp('ea_approved_at', { withTimezone: true }),
  eaApprovalRemarks: text('ea_approval_remarks'),
  eaHeldAt: timestamp('ea_held_at', { withTimezone: true }),
  eaHeldBy: uuid('ea_held_by').references(() => users.id),
  mdApprovalStatus: text('md_approval_status'),
  mdApprovedBy: uuid('md_approved_by').references(() => users.id),
  mdApprovedAt: timestamp('md_approved_at', { withTimezone: true }),
  mdApprovalRemarks: text('md_approval_remarks'),
  mdHeldAt: timestamp('md_held_at', { withTimezone: true }),
  mdHeldBy: uuid('md_held_by').references(() => users.id),
  holdRemarks: text('hold_remarks'),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  financeOrdersStatusIdx: index('finance_orders_status_idx').on(table.status),
  financeOrdersCreatedByIdx: index('finance_orders_created_by_idx').on(table.createdBy),
  financeOrdersInvoiceIdx: index('finance_orders_invoice_idx').on(table.invoiceNumber),
  financeOrdersCreatedAtIdx: index('finance_orders_created_at_idx').on(table.createdAt),
}))

export const financeOrderWorkflow = pgTable('finance_order_workflow', {
  id: uuid('id').primaryKey().defaultRandom(),
  financeOrderId: uuid('finance_order_id').references(() => financeOrders.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),
  stage: text('stage').notNull(),
  performedBy: uuid('performed_by').references(() => users.id).notNull(),
  userRole: text('user_role').notNull(),
  remarks: text('remarks'),
  previousStatus: text('previous_status'),
  newStatus: text('new_status'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  financeOrderWorkflowOrderIdx: index('finance_order_workflow_order_idx').on(table.financeOrderId),
  financeOrderWorkflowCreatedIdx: index('finance_order_workflow_created_idx').on(table.createdAt),
}))

export const financeOrderComments = pgTable('finance_order_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  financeOrderId: uuid('finance_order_id').references(() => financeOrders.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  comment: text('comment').notNull(),
  visibility: text('visibility').default('internal').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  financeOrderCommentsOrderIdx: index('finance_order_comments_order_idx').on(table.financeOrderId),
}))

export type PettyCashRequestFormData = {
  location?: string | null
  department?: string | null
  advanceType?: string | null
  typeOfPayment?: string | null
}

export type PettyCashExpenseFormData = {
  date?: string | null
  vendorName?: string | null
  receivedBy?: string | null
  purposeOfExpense?: string | null
  // Per-expense location: the location the money was actually spent for (may differ from the
  // originating allocation/request location). Captured on the expense form for spend tracking.
  location?: string | null
  uploadBillUrls?: string[]
}

export const pettyCashCategories = pgTable('petty_cash_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pettyCashCategoriesSlugIdx: uniqueIndex('petty_cash_categories_slug_idx').on(table.slug),
  pettyCashCategoriesActiveIdx: index('petty_cash_categories_active_idx').on(table.isActive, table.sortOrder),
}))

export const pettyCashRequests = pgTable('petty_cash_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestNumber: text('request_number').unique().notNull(),
  branchId: text('branch_id').notNull(),
  status: pettyCashRequestStatusEnum('status').default('draft').notNull(),
  currentStage: text('current_stage').default('draft').notNull(),
  requestedByName: text('requested_by_name').notNull(),
  requestedByEmail: text('requested_by_email').notNull(),
  department: text('department'),
  categoryId: uuid('category_id').references(() => pettyCashCategories.id, { onDelete: 'set null' }),
  requestedAmount: decimal('requested_amount', { precision: 14, scale: 2 }).notNull(),
  allocatedAmount: decimal('allocated_amount', { precision: 14, scale: 2 }),
  purpose: text('purpose').notNull(),
  requestForm: jsonb('request_form').$type<PettyCashRequestFormData>().default({}).notNull(),
  supportingFiles: jsonb('supporting_files').$type<string[]>().default([]).notNull(),
  edApprovedBy: uuid('ed_approved_by').references(() => users.id),
  edApprovedAt: timestamp('ed_approved_at', { withTimezone: true }),
  edRemarks: text('ed_remarks'),
  eaApprovedBy: uuid('ea_approved_by').references(() => users.id),
  eaApprovedAt: timestamp('ea_approved_at', { withTimezone: true }),
  eaRemarks: text('ea_remarks'),
  mdApprovedBy: uuid('md_approved_by').references(() => users.id),
  mdApprovedAt: timestamp('md_approved_at', { withTimezone: true }),
  mdRemarks: text('md_remarks'),
  accountsApprovedBy: uuid('accounts_approved_by').references(() => users.id),
  accountsApprovedAt: timestamp('accounts_approved_at', { withTimezone: true }),
  accountsRemarks: text('accounts_remarks'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  pettyCashRequestsBranchStatusCreatedIdx: index('petty_cash_requests_branch_status_created_idx').on(table.branchId, table.status, table.createdAt),
  pettyCashRequestsCreatedByIdx: index('petty_cash_requests_created_by_idx').on(table.createdBy, table.createdAt),
  pettyCashRequestsCategoryIdx: index('petty_cash_requests_category_idx').on(table.categoryId),
  pettyCashRequestsNumberIdx: uniqueIndex('petty_cash_requests_number_idx').on(table.requestNumber),
}))

export const pettyCashAllocations = pgTable('petty_cash_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  allocationNumber: text('allocation_number').unique().notNull(),
  requestId: uuid('request_id').references(() => pettyCashRequests.id, { onDelete: 'restrict' }).notNull(),
  branchId: text('branch_id').notNull(),
  allocatedTo: uuid('allocated_to').references(() => users.id).notNull(),
  allocatedBy: uuid('allocated_by').references(() => users.id).notNull(),
  allocatedAmount: decimal('allocated_amount', { precision: 14, scale: 2 }).notNull(),
  spentAmount: decimal('spent_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  status: pettyCashAllocationStatusEnum('status').default('active').notNull(),
  notes: text('notes'),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pettyCashAllocationsBranchStatusCreatedIdx: index('petty_cash_allocations_branch_status_created_idx').on(table.branchId, table.status, table.createdAt),
  pettyCashAllocationsAllocatedToStatusIdx: index('petty_cash_allocations_allocated_to_status_idx').on(table.allocatedTo, table.status),
  pettyCashAllocationsRequestIdx: uniqueIndex('petty_cash_allocations_request_idx').on(table.requestId),
  pettyCashAllocationsNumberIdx: uniqueIndex('petty_cash_allocations_number_idx').on(table.allocationNumber),
  pettyCashAllocationsOneActiveIdx: uniqueIndex('petty_cash_allocations_one_active_idx').on(table.branchId, table.allocatedTo).where(sql`${table.status} = 'active'`),
}))

export const pettyCashExpenses = pgTable('petty_cash_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseNumber: text('expense_number').unique().notNull(),
  allocationId: uuid('allocation_id').references(() => pettyCashAllocations.id, { onDelete: 'restrict' }).notNull(),
  branchId: text('branch_id').notNull(),
  status: pettyCashExpenseStatusEnum('status').default('pending').notNull(),
  currentStage: text('current_stage').default('ed_approval').notNull(),
  expenseDate: date('expense_date').notNull(),
  particulars: text('particulars').notNull(),
  department: text('department'),
  categoryId: uuid('category_id').references(() => pettyCashCategories.id, { onDelete: 'set null' }),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  vendorName: text('vendor_name'),
  receivedBy: text('received_by'),
  purpose: text('purpose').notNull(),
  expenseForm: jsonb('expense_form').$type<PettyCashExpenseFormData>().default({}).notNull(),
  billFiles: jsonb('bill_files').$type<string[]>().default([]).notNull(),
  edApprovedBy: uuid('ed_approved_by').references(() => users.id),
  edApprovedAt: timestamp('ed_approved_at', { withTimezone: true }),
  edRemarks: text('ed_remarks'),
  eaApprovedBy: uuid('ea_approved_by').references(() => users.id),
  eaApprovedAt: timestamp('ea_approved_at', { withTimezone: true }),
  eaRemarks: text('ea_remarks'),
  mdApprovedBy: uuid('md_approved_by').references(() => users.id),
  mdApprovedAt: timestamp('md_approved_at', { withTimezone: true }),
  mdRemarks: text('md_remarks'),
  accountsApprovedBy: uuid('accounts_approved_by').references(() => users.id),
  accountsApprovedAt: timestamp('accounts_approved_at', { withTimezone: true }),
  accountsRemarks: text('accounts_remarks'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  pettyCashExpensesBranchStatusCreatedIdx: index('petty_cash_expenses_branch_status_created_idx').on(table.branchId, table.status, table.createdAt),
  pettyCashExpensesAllocationStatusCreatedIdx: index('petty_cash_expenses_allocation_status_created_idx').on(table.allocationId, table.status, table.createdAt),
  pettyCashExpensesCreatedByIdx: index('petty_cash_expenses_created_by_idx').on(table.createdBy, table.createdAt),
  pettyCashExpensesRequestCategoryIdx: index('petty_cash_expenses_category_idx').on(table.categoryId),
  pettyCashExpensesNumberIdx: uniqueIndex('petty_cash_expenses_number_idx').on(table.expenseNumber),
}))

export const pettyCashExpenseAttachments = pgTable('petty_cash_expense_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').references(() => pettyCashExpenses.id, { onDelete: 'cascade' }).notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  fileUrl: text('file_url'),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pettyCashExpenseAttachmentsExpenseIdx: index('petty_cash_expense_attachments_expense_idx').on(table.expenseId, table.createdAt),
}))

export const pettyCashApprovalHistory = pgTable('petty_cash_approval_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type').notNull(),
  requestId: uuid('request_id').references(() => pettyCashRequests.id, { onDelete: 'cascade' }),
  expenseId: uuid('expense_id').references(() => pettyCashExpenses.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  stage: text('stage').notNull(),
  performedBy: uuid('performed_by').references(() => users.id).notNull(),
  userRole: text('user_role').notNull(),
  remarks: text('remarks'),
  previousStatus: text('previous_status'),
  newStatus: text('new_status'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pettyCashApprovalHistoryRequestIdx: index('petty_cash_approval_history_request_idx').on(table.requestId, table.createdAt),
  pettyCashApprovalHistoryExpenseIdx: index('petty_cash_approval_history_expense_idx').on(table.expenseId, table.createdAt),
  pettyCashApprovalHistoryActorIdx: index('petty_cash_approval_history_actor_idx').on(table.performedBy, table.createdAt),
}))

export const pettyCashLedgerEntries = pgTable('petty_cash_ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  allocationId: uuid('allocation_id').references(() => pettyCashAllocations.id, { onDelete: 'restrict' }).notNull(),
  requestId: uuid('request_id').references(() => pettyCashRequests.id, { onDelete: 'set null' }),
  expenseId: uuid('expense_id').references(() => pettyCashExpenses.id, { onDelete: 'set null' }),
  branchId: text('branch_id').notNull(),
  entryType: pettyCashLedgerEntryTypeEnum('entry_type').notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  balanceAfter: decimal('balance_after', { precision: 14, scale: 2 }).notNull(),
  description: text('description').notNull(),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pettyCashLedgerAllocationCreatedIdx: index('petty_cash_ledger_allocation_created_idx').on(table.allocationId, table.createdAt),
  pettyCashLedgerBranchCreatedIdx: index('petty_cash_ledger_branch_created_idx').on(table.branchId, table.createdAt),
  pettyCashLedgerExpenseIdx: uniqueIndex('petty_cash_ledger_expense_idx').on(table.expenseId).where(sql`${table.expenseId} IS NOT NULL`),
}))

export const financeSheet = pgTable('finance_sheet', {
  id: bigint('id', { mode: 'number' }).primaryKey().default(sql`nextval('finance_sheet_id_seq'::regclass)`),
  rowHash: text('row_hash').notNull(),
  deliveryDate: date('delivery_date'),
  customerName: text('customer_name'),
  mobileNo: text('mobile_no'),
  model: text('model'),
  salesExecutive: text('sales_executive'),
  mainDealer: text('main_dealer'),
  location: text('location'),
  tl: text('tl'),
  hyp: text('hyp'),
  branch: text('branch'),
  loanAmount: decimal('loan_amount', { precision: 14, scale: 2 }),
  panNumber: text('pan_number'),
  payoutStatus: text('payout_status'),
  reasonIfOuthouse: text('reason_if_outhouse'),
  dealerPayoutPercent: text('dealer_payout_percent'),
  payoutAmount: decimal('payout_amount', { precision: 14, scale: 2 }),
  status: text('status'),
  dsePayoutStatus: text('dse_payout_status'),
  dealerPayoutStatus: text('dealer_payout_status'),
  paymentReceivedDate: date('payment_received_date'),
  amountReceived: decimal('amount_received', { precision: 14, scale: 2 }),
  invoiceNumber: text('invoice_number'),
  bankVisitScheduled: text('bank_visit_scheduled'),
  dateOfBankVisit: date('date_of_bank_visit'),
  visitedBy: text('visited_by'),
  bankerRemarks: text('banker_remarks'),
  vehicleRegistrationNumberToSale: text('vehicle_registration_number_to_sale'),
  hypAsPerRc: text('hyp_as_per_rc'),
  startTime: text('start_time'),
  endTime: text('end_time'),
  loginUser: text('login_user'),
  bankIntRate: decimal('bank_int_rate', { precision: 8, scale: 2 }),
  bankLogin: text('bank_login'),
  bankInProforma: text('bank_in_proforma'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
}, (table) => ({
  financeSheetDeliveryDateIdx: index('finance_sheet_delivery_date_idx').on(table.deliveryDate),
  financeSheetMainDealerIdx: index('finance_sheet_main_dealer_idx').on(table.mainDealer),
  financeSheetLocationIdx: index('finance_sheet_location_idx').on(table.location),
  financeSheetStatusIdx: index('finance_sheet_status_idx').on(table.status),
  financeSheetPayoutStatusIdx: index('finance_sheet_payout_status_idx').on(table.payoutStatus),
  financeSheetHypIdx: index('finance_sheet_hyp_idx').on(table.hyp),
  financeSheetTlIdx: index('finance_sheet_tl_idx').on(table.tl),
  financeSheetSalesExecutiveIdx: index('finance_sheet_sales_executive_idx').on(table.salesExecutive),
  financeSheetBranchIdx: index('finance_sheet_branch_idx').on(table.branch),
  financeSheetBankLoginIdx: index('finance_sheet_bank_login_idx').on(table.bankLogin),
  financeSheetBankInProformaIdx: index('finance_sheet_bank_in_proforma_idx').on(table.bankInProforma),
}))

export const amFinanceAuditLogs = pgTable('am_finance_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  financeSheetId: bigint('finance_sheet_id', { mode: 'number' }).references(() => financeSheet.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),
  fieldName: text('field_name'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  performedBy: uuid('performed_by').references(() => users.id),
  performedByName: text('performed_by_name'),
  userRole: text('user_role').notNull(),
  module: text('module').default('am_finance').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  amFinanceAuditFinanceSheetIdx: index('am_finance_audit_finance_sheet_idx').on(table.financeSheetId, table.createdAt),
  amFinanceAuditActorIdx: index('am_finance_audit_actor_idx').on(table.performedBy, table.createdAt),
  amFinanceAuditActionIdx: index('am_finance_audit_action_idx').on(table.action),
}))

export const demoVehicleRemarks = pgTable('demo_vehicle_remarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  vin: text('vin').notNull(),
  remark: text('remark').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdByName: text('created_by_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  demoVehicleRemarksVinCreatedIdx: index('demo_vehicle_remarks_vin_created_idx').on(table.vin, table.createdAt),
  demoVehicleRemarksCreatedByIdx: index('demo_vehicle_remarks_created_by_idx').on(table.createdBy),
}))

export const hyundaiWarrantyClaimActions = pgTable('hyundai_warranty_claim_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: text('source_type').notNull(),
  recordKey: text('record_key').notNull(),
  requirementCode: text('requirement_code').notNull(),
  statusSnapshot: text('status_snapshot'),
  businessDateSnapshot: date('business_date_snapshot'),
  remark: text('remark').notNull(),
  docketNumber: text('docket_number'),
  createdBy: uuid('created_by').references(() => users.id),
  createdByName: text('created_by_name').notNull(),
  createdByEmail: text('created_by_email').notNull(),
  createdByRole: text('created_by_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  warrantyClaimActionsRecordIdx: index('hyundai_warranty_claim_actions_record_idx').on(table.sourceType, table.recordKey, table.createdAt),
  warrantyClaimActionsRequirementIdx: index('hyundai_warranty_claim_actions_requirement_idx').on(table.sourceType, table.recordKey, table.requirementCode, table.statusSnapshot),
  warrantyClaimActionsActorIdx: index('hyundai_warranty_claim_actions_actor_idx').on(table.createdBy, table.createdAt),
}))

export const hyundaiWarrantyClaimEvidence = pgTable('hyundai_warranty_claim_evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  actionId: uuid('action_id').references(() => hyundaiWarrantyClaimActions.id, { onDelete: 'cascade' }).notNull(),
  storagePath: text('storage_path').notNull(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  warrantyClaimEvidenceActionIdx: index('hyundai_warranty_claim_evidence_action_idx').on(table.actionId, table.createdAt),
}))

export const hyundaiWarrantyDealerMappings = pgTable('hyundai_warranty_dealer_mappings', {
  dealerCode: text('dealer_code').primaryKey(),
  dealerName: text('dealer_name').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  warrantyDealerMappingsNameIdx: index('hyundai_warranty_dealer_mappings_name_idx').on(table.dealerName),
}))

export const kiaUserProfiles = pgTable('kia_user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  authUserId: uuid('auth_user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').unique().notNull(),
  consultantName: text('consultant_name').notNull(),
  dealerLocation: text('dealer_location'),
  employeeCode: text('employee_code'),
  status: text('status').default('NEW USER').notNull(),
  approver: boolean('approver').default(false).notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaUserProfilesEmailIdx: uniqueIndex('kia_user_profiles_email_idx').on(table.email),
  kiaUserProfilesAuthUserIdx: index('kia_user_profiles_auth_user_idx').on(table.authUserId),
  kiaUserProfilesApproverIdx: index('kia_user_profiles_approver_idx').on(table.approver),
  kiaUserProfilesStatusIdx: index('kia_user_profiles_status_idx').on(table.status),
}))

export const kiaPriceDetails = pgTable('kia_price_details', {
  id: uuid('id').primaryKey().defaultRandom(),
  model: text('model').notNull(),
  trimDescription: text('trim_description').notNull(),
  hyp: text('hyp'),
  bankName: text('bank_name'),
  bankBranch: text('bank_branch'),
  exShowroomPrice: decimal('ex_showroom_price', { precision: 14, scale: 2 }).default('0').notNull(),
  tcs: decimal('tcs', { precision: 14, scale: 2 }).default('0').notNull(),
  registrationCharges: decimal('registration_charges', { precision: 14, scale: 2 }).default('0').notNull(),
  statutoryCharges: decimal('statutory_charges', { precision: 14, scale: 2 }).default('0').notNull(),
  insurance: decimal('insurance', { precision: 14, scale: 2 }).default('0').notNull(),
  fastag: decimal('fastag', { precision: 14, scale: 2 }).default('0').notNull(),
  accessoriesKit: decimal('accessories_kit', { precision: 14, scale: 2 }).default('0').notNull(),
  extendedWarranty4thYear: decimal('extended_warranty_4th_year', { precision: 14, scale: 2 }).default('0').notNull(),
  insuranceCompany: text('insurance_company'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaPriceDetailsModelTrimIdx: index('kia_price_details_model_trim_idx').on(table.model, table.trimDescription),
  kiaPriceDetailsBankIdx: index('kia_price_details_bank_idx').on(table.bankName, table.bankBranch),
  kiaPriceDetailsInsuranceIdx: index('kia_price_details_insurance_idx').on(table.insuranceCompany),
}))


export const kiaProformas = pgTable('kia_proformas', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryTime: timestamp('entry_time', { withTimezone: true }).defaultNow().notNull(),
  proformaDate: timestamp('proforma_date', { withTimezone: true }).notNull(),
  customerType: text('customer_type').notNull(),
  customerName: text('customer_name').notNull(),
  mobileNumber: text('mobile_number').notNull(),
  customerAddress: text('customer_address').notNull(),
  customerEmail: text('customer_email').notNull(),
  modelName: text('model_name').notNull(),
  trimDescription: text('trim_description').notNull(),
  fuelType: text('fuel_type').notNull(),
  vehicleColor: text('vehicle_color').notNull(),
  bankName: text('bank_name').notNull(),
  bankBranch: text('bank_branch'),
  vehicleStatus: text('vehicle_status').notNull(),
  loanAmount: decimal('loan_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  insuranceCompany: text('insurance_company'),
  exShowroom: decimal('ex_showroom', { precision: 14, scale: 2 }).default('0').notNull(),
  tcsValue: decimal('tcs_value', { precision: 14, scale: 2 }).default('0').notNull(),
  registrationCharges: decimal('registration_charges', { precision: 14, scale: 2 }).default('0').notNull(),
  insuranceValue: decimal('insurance_value', { precision: 14, scale: 2 }).default('0').notNull(),
  fastagValue: decimal('fastag_value', { precision: 14, scale: 2 }).default('0').notNull(),
  accessoriesKit: decimal('accessories_kit', { precision: 14, scale: 2 }).default('0').notNull(),
  extWarranty: decimal('ext_warranty', { precision: 14, scale: 2 }).default('0').notNull(),
  cashDiscount: decimal('cash_discount', { precision: 14, scale: 2 }).default('0').notNull(),
  exchangeValue: decimal('exchange_value', { precision: 14, scale: 2 }).default('0').notNull(),
  bookingAmount: decimal('booking_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  govtEmployeeDiscount: decimal('govt_employee_discount', { precision: 14, scale: 2 }).default('0').notNull(),
  additionalDiscount: decimal('additional_discount', { precision: 14, scale: 2 }).default('0').notNull(),
  totalCustomerCost: decimal('total_customer_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  grandTotalCost: decimal('grand_total_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  loginEmail: text('login_email').notNull(),
  consultant: text('consultant').notNull(),
  location: text('location'),
  empCode: text('emp_code'),
  approvalStatus: text('approval_status').default('PENDING').notNull(),
  approvedBy: text('approved_by'),
  linkPreview: text('link_preview'),
  financeStatus: text('finance_status').default('Pending'),
  financeRemarks: text('finance_remarks'),
  financeUpdatedTime: timestamp('finance_updated_time', { withTimezone: true }),
  addDiscApproval: jsonb('add_disc_approval').$type<Record<string, unknown>>().default({}).notNull(),
  importMetadata: jsonb('import_metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  kiaProformasLoginEmailIdx: index('kia_proformas_login_email_idx').on(table.loginEmail),
  kiaProformasProformaDateIdx: index('kia_proformas_proforma_date_idx').on(table.proformaDate),
  kiaProformasApprovalIdx: index('kia_proformas_approval_status_idx').on(table.approvalStatus),
  kiaProformasFinanceStatusIdx: index('kia_proformas_finance_status_idx').on(table.financeStatus),
  kiaProformasCustomerIdx: index('kia_proformas_customer_idx').on(table.customerName, table.mobileNumber),
}))

// Per-consultant monthly sales targets (bookings + deliveries) for the KIA Sales Performance page.
// Actuals come from kia_sales_report; this only holds the targets a manager sets.
export const kiaSalesTargets = pgTable('kia_sales_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealerCode: text('dealer_code').notNull(),
  consultantName: text('consultant_name').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(), // 1..12
  bookingTarget: integer('booking_target').default(0).notNull(),
  deliveryTarget: integer('delivery_target').default(0).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaSalesTargetsUniqueIdx: uniqueIndex('kia_sales_targets_unique_idx').on(table.dealerCode, table.consultantName, table.year, table.month),
}))

/**
 * MD-set monthly targets per brand + branch — sales units, sales revenue, service RO count,
 * service revenue. Backs the MD-only /targets section. Migration 0043.
 *
 * A different GRAIN from kiaSalesTargets above, not a superset of it: that table is per-CONSULTANT
 * and KIA-only and stays as the individual leaderboard's source. This one is per-BRANCH, per-brand,
 * and carries service as well as sales.
 *
 * ⚠️ Keyed on (brand, dealerCode) — never dealerCode alone. Dealer codes are NOT globally unique
 * across brands: N6828 is both a Hyundai Billawar sub-code and Platinum Poonch's primary code.
 *
 * ⚠️ Every metric is NULLABLE and NULL IS NOT ZERO. NULL means the MD set nothing for that month,
 * which is what lets the existing LY+10% fallback (lib/brands/sales-stock.ts) still apply; 0 is a
 * deliberate target of zero. Do not add `.default(0)` — it would erase that distinction.
 *
 * `dealerCode` carries the sentinel PETTY-style '__brand__' for a brand-level row. Hyundai and
 * Platinum sales cannot be split per outlet (their feeds file ~99% of deliveries under one dealer
 * code), so their sales target is stored once against the sentinel. See lib/targets/constants.ts.
 */
export const mdBranchTargets = pgTable('md_branch_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  brand: text('brand').notNull(),
  dealerCode: text('dealer_code').notNull(),
  year: integer('year').notNull(),   // CALENDAR year
  month: integer('month').notNull(), // CALENDAR month, 1..12
  salesUnits: integer('sales_units'),
  salesRevenue: decimal('sales_revenue', { precision: 14, scale: 2 }),
  serviceRoCount: integer('service_ro_count'),
  serviceRevenue: decimal('service_revenue', { precision: 14, scale: 2 }),
  note: text('note'),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mdBranchTargetsUniqueIdx: uniqueIndex('md_branch_targets_unique_idx').on(table.brand, table.dealerCode, table.year, table.month),
  mdBranchTargetsBrandPeriodIdx: index('md_branch_targets_brand_period_idx').on(table.brand, table.year, table.month),
}))

export const mgUserProfiles = pgTable('mg_user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  authUserId: uuid('auth_user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').unique().notNull(),
  consultantName: text('consultant_name').notNull(),
  dealerLocation: text('dealer_location'),
  employeeCode: text('employee_code'),
  status: text('status').default('NEW USER').notNull(),
  approver: boolean('approver').default(false).notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mgUserProfilesEmailIdx: uniqueIndex('mg_user_profiles_email_idx').on(table.email),
  mgUserProfilesAuthUserIdx: index('mg_user_profiles_auth_user_idx').on(table.authUserId),
  mgUserProfilesApproverIdx: index('mg_user_profiles_approver_idx').on(table.approver),
  mgUserProfilesStatusIdx: index('mg_user_profiles_status_idx').on(table.status),
}))

export const mgPriceDetails = pgTable('mg_price_details', {
  id: uuid('id').primaryKey().defaultRandom(),
  model: text('model').notNull(),
  trimDescription: text('trim_description').notNull(),
  colour: text('colour'),
  hyp: text('hyp'),
  bankName: text('bank_name'),
  bankBranch: text('bank_branch'),
  exShowroomPrice: decimal('ex_showroom_price', { precision: 14, scale: 2 }).default('0').notNull(),
  tcs: decimal('tcs', { precision: 14, scale: 2 }).default('0').notNull(),
  registrationCharges: decimal('registration_charges', { precision: 14, scale: 2 }).default('0').notNull(),
  statutoryCharges: decimal('statutory_charges', { precision: 14, scale: 2 }).default('0').notNull(),
  insurance: decimal('insurance', { precision: 14, scale: 2 }).default('0').notNull(),
  fastag: decimal('fastag', { precision: 14, scale: 2 }).default('0').notNull(),
  accessoriesKit: decimal('accessories_kit', { precision: 14, scale: 2 }).default('0').notNull(),
  extendedWarranty4thYear: decimal('extended_warranty_4th_year', { precision: 14, scale: 2 }).default('0').notNull(),
  insuranceCompany: text('insurance_company'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mgPriceDetailsModelTrimIdx: index('mg_price_details_model_trim_idx').on(table.model, table.trimDescription, table.colour),
  mgPriceDetailsBankIdx: index('mg_price_details_bank_idx').on(table.bankName, table.bankBranch),
  mgPriceDetailsInsuranceIdx: index('mg_price_details_insurance_idx').on(table.insuranceCompany),
}))

export const mgProformaLookupOptions = pgTable('mg_proforma_lookup_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').notNull(),
  value: text('value').notNull(),
  label: text('label'),
  sourceSheet: text('source_sheet'),
  sourceRow: integer('source_row'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mgProformaLookupOptionsCategoryIdx: index('mg_proforma_lookup_options_category_idx').on(table.category),
  mgProformaLookupOptionsValueIdx: index('mg_proforma_lookup_options_value_idx').on(table.value),
}))

export const mgProformas = pgTable('mg_proformas', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryTime: timestamp('entry_time', { withTimezone: true }).defaultNow().notNull(),
  proformaDate: timestamp('proforma_date', { withTimezone: true }).notNull(),
  customerType: text('customer_type').default('Customer').notNull(),
  customerName: text('customer_name').notNull(),
  mobileNumber: text('mobile_number').notNull(),
  customerAddress: text('customer_address').notNull(),
  customerEmail: text('customer_email').default('').notNull(),
  modelName: text('model_name').notNull(),
  trimDescription: text('trim_description').notNull(),
  fuelType: text('fuel_type').notNull(),
  vehicleColor: text('vehicle_color').notNull(),
  bankName: text('bank_name').notNull(),
  bankBranch: text('bank_branch'),
  vehicleStatus: text('vehicle_status').default('UNKNOWN').notNull(),
  loanAmount: decimal('loan_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  insuranceCompany: text('insurance_company'),
  exShowroom: decimal('ex_showroom', { precision: 14, scale: 2 }).default('0').notNull(),
  tcsValue: decimal('tcs_value', { precision: 14, scale: 2 }).default('0').notNull(),
  registrationCharges: decimal('registration_charges', { precision: 14, scale: 2 }).default('0').notNull(),
  insuranceValue: decimal('insurance_value', { precision: 14, scale: 2 }).default('0').notNull(),
  fastagValue: decimal('fastag_value', { precision: 14, scale: 2 }).default('0').notNull(),
  accessoriesKit: decimal('accessories_kit', { precision: 14, scale: 2 }).default('0').notNull(),
  extWarranty: decimal('ext_warranty', { precision: 14, scale: 2 }).default('0').notNull(),
  cashDiscount: decimal('cash_discount', { precision: 14, scale: 2 }).default('0').notNull(),
  exchangeValue: decimal('exchange_value', { precision: 14, scale: 2 }).default('0').notNull(),
  bookingAmount: decimal('booking_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  govtEmployeeDiscount: decimal('govt_employee_discount', { precision: 14, scale: 2 }).default('0').notNull(),
  additionalDiscount: decimal('additional_discount', { precision: 14, scale: 2 }).default('0').notNull(),
  totalCustomerCost: decimal('total_customer_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  grandTotalCost: decimal('grand_total_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  loginEmail: text('login_email').notNull(),
  consultant: text('consultant').notNull(),
  location: text('location'),
  empCode: text('emp_code'),
  approvalStatus: text('approval_status').default('PENDING').notNull(),
  approvedBy: text('approved_by'),
  checkedBy: text('checked_by'),
  emailSendStatus: text('email_send_status'),
  linkPreview: text('link_preview'),
  financeStatus: text('finance_status').default('Pending'),
  financeRemarks: text('finance_remarks'),
  financeUpdatedTime: timestamp('finance_updated_time', { withTimezone: true }),
  addDiscApproval: jsonb('add_disc_approval').$type<Record<string, unknown>>().default({}).notNull(),
  importMetadata: jsonb('import_metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  mgProformasLoginEmailIdx: index('mg_proformas_login_email_idx').on(table.loginEmail),
  mgProformasProformaDateIdx: index('mg_proformas_proforma_date_idx').on(table.proformaDate),
  mgProformasApprovalIdx: index('mg_proformas_approval_status_idx').on(table.approvalStatus),
  mgProformasFinanceStatusIdx: index('mg_proformas_finance_status_idx').on(table.financeStatus),
  mgProformasCustomerIdx: index('mg_proformas_customer_idx').on(table.customerName, table.mobileNumber),
}))

// User Preferences table
export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  preferenceKey: text('preference_key').notNull(),
  preferenceValue: jsonb('preference_value').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userPreferencesUniqueIdx: uniqueIndex('user_preferences_user_key_idx').on(table.userId, table.preferenceKey),
  userPreferencesUserIdIdx: index('user_preferences_user_id_idx').on(table.userId),
  userPreferencesKeyIdx: index('user_preferences_key_idx').on(table.preferenceKey),
}))

// Workflow History table
export const workflowHistory = pgTable('workflow_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),
  stage: text('stage').notNull(),
  performedBy: uuid('performed_by').references(() => users.id).notNull(),
  userRole: text('user_role').notNull(),
  remarks: text('remarks'),
  previousStatus: text('previous_status'),
  newStatus: text('new_status'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Purchase Order Approvals table
export const purchaseOrderApprovals = pgTable('purchase_order_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'cascade' }).notNull(),
  approverRole: text('approver_role').notNull(), // 'ea' or 'md'
  approverId: uuid('approver_id').references(() => users.id).notNull(),
  status: text('status').notNull(), // 'pending', 'approved', 'denied'
  remarks: text('remarks'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  workshopJobs: many(workshopJobs),
  reconWorkflows: many(reconWorkflows),
  tasksAssigned: many(tasks),
  tasksCreated: many(tasks),
  comments: many(comments),
  attachments: many(attachments),
  activityLogs: many(activityLogs),
  userActivityEvents: many(userActivityEvents),
  pettyCashRequests: many(pettyCashRequests),
  pettyCashAllocations: many(pettyCashAllocations),
  pettyCashExpenses: many(pettyCashExpenses),
}))

export const vehiclesRelations = relations(vehicles, ({ many }) => ({
  workshopJobs: many(workshopJobs),
  reconWorkflows: many(reconWorkflows),
}))

export const workshopJobsRelations = relations(workshopJobs, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [workshopJobs.vehicleId],
    references: [vehicles.id],
  }),
  assignedToUser: one(users, {
    fields: [workshopJobs.assignedTo],
    references: [users.id],
  }),
  comments: many(comments),
  attachments: many(attachments),
  tasks: many(tasks),
}))

export const reconWorkflowsRelations = relations(reconWorkflows, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [reconWorkflows.vehicleId],
    references: [vehicles.id],
  }),
  assignedToUser: one(users, {
    fields: [reconWorkflows.assignedTo],
    references: [users.id],
  }),
  comments: many(comments),
  attachments: many(attachments),
  tasks: many(tasks),
}))

export const inventoryItemsRelations = relations(inventoryItems, ({ many }) => ({
  transactions: many(inventoryTransactions),
}))

export const inventoryTransactionsRelations = relations(inventoryTransactions, ({ one }) => ({
  item: one(inventoryItems, {
    fields: [inventoryTransactions.itemId],
    references: [inventoryItems.id],
  }),
  performedByUser: one(users, {
    fields: [inventoryTransactions.performedBy],
    references: [users.id],
  }),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignedToUser: one(users, {
    fields: [tasks.assignedTo],
    references: [users.id],
  }),
  createdByUser: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
  }),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
}))

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  uploadedByUser: one(users, {
    fields: [attachments.uploadedBy],
    references: [users.id],
  }),
}))

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}))

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one }) => ({
  creator: one(users, {
    fields: [purchaseOrders.createdBy],
    references: [users.id],
  }),
  eaApprover: one(users, {
    fields: [purchaseOrders.eaApprovedBy],
    references: [users.id],
  }),
  mdApprover: one(users, {
    fields: [purchaseOrders.mdApprovedBy],
    references: [users.id],
  }),
  eaHolder: one(users, {
    fields: [purchaseOrders.eaHeldBy],
    references: [users.id],
  }),
  mdHolder: one(users, {
    fields: [purchaseOrders.mdHeldBy],
    references: [users.id],
  }),
}))

export const financeOrdersRelations = relations(financeOrders, ({ one, many }) => ({
  creator: one(users, {
    fields: [financeOrders.createdBy],
    references: [users.id],
  }),
  accountsVerifier: one(users, {
    fields: [financeOrders.accountsVerifiedBy],
    references: [users.id],
  }),
  eaApprover: one(users, {
    fields: [financeOrders.eaApprovedBy],
    references: [users.id],
  }),
  mdApprover: one(users, {
    fields: [financeOrders.mdApprovedBy],
    references: [users.id],
  }),
  eaHolder: one(users, {
    fields: [financeOrders.eaHeldBy],
    references: [users.id],
  }),
  mdHolder: one(users, {
    fields: [financeOrders.mdHeldBy],
    references: [users.id],
  }),
  accountsHolder: one(users, {
    fields: [financeOrders.accountsHeldBy],
    references: [users.id],
  }),
  workflow: many(financeOrderWorkflow),
  comments: many(financeOrderComments),
}))

export const financeOrderWorkflowRelations = relations(financeOrderWorkflow, ({ one }) => ({
  financeOrder: one(financeOrders, {
    fields: [financeOrderWorkflow.financeOrderId],
    references: [financeOrders.id],
  }),
  actor: one(users, {
    fields: [financeOrderWorkflow.performedBy],
    references: [users.id],
  }),
}))

export const financeOrderCommentsRelations = relations(financeOrderComments, ({ one }) => ({
  financeOrder: one(financeOrders, {
    fields: [financeOrderComments.financeOrderId],
    references: [financeOrders.id],
  }),
  user: one(users, {
    fields: [financeOrderComments.userId],
    references: [users.id],
  }),
}))

export const pettyCashCategoriesRelations = relations(pettyCashCategories, ({ many }) => ({
  requests: many(pettyCashRequests),
  expenses: many(pettyCashExpenses),
}))

export const pettyCashRequestsRelations = relations(pettyCashRequests, ({ one, many }) => ({
  creator: one(users, {
    fields: [pettyCashRequests.createdBy],
    references: [users.id],
  }),
  category: one(pettyCashCategories, {
    fields: [pettyCashRequests.categoryId],
    references: [pettyCashCategories.id],
  }),
  allocation: many(pettyCashAllocations),
  history: many(pettyCashApprovalHistory),
  ledgerEntries: many(pettyCashLedgerEntries),
}))

export const pettyCashAllocationsRelations = relations(pettyCashAllocations, ({ one, many }) => ({
  request: one(pettyCashRequests, {
    fields: [pettyCashAllocations.requestId],
    references: [pettyCashRequests.id],
  }),
  allocatedToUser: one(users, {
    fields: [pettyCashAllocations.allocatedTo],
    references: [users.id],
  }),
  allocatedByUser: one(users, {
    fields: [pettyCashAllocations.allocatedBy],
    references: [users.id],
  }),
  expenses: many(pettyCashExpenses),
  ledgerEntries: many(pettyCashLedgerEntries),
}))

export const pettyCashExpensesRelations = relations(pettyCashExpenses, ({ one, many }) => ({
  allocation: one(pettyCashAllocations, {
    fields: [pettyCashExpenses.allocationId],
    references: [pettyCashAllocations.id],
  }),
  creator: one(users, {
    fields: [pettyCashExpenses.createdBy],
    references: [users.id],
  }),
  category: one(pettyCashCategories, {
    fields: [pettyCashExpenses.categoryId],
    references: [pettyCashCategories.id],
  }),
  attachments: many(pettyCashExpenseAttachments),
  history: many(pettyCashApprovalHistory),
  ledgerEntries: many(pettyCashLedgerEntries),
}))

export const pettyCashExpenseAttachmentsRelations = relations(pettyCashExpenseAttachments, ({ one }) => ({
  expense: one(pettyCashExpenses, {
    fields: [pettyCashExpenseAttachments.expenseId],
    references: [pettyCashExpenses.id],
  }),
  uploader: one(users, {
    fields: [pettyCashExpenseAttachments.uploadedBy],
    references: [users.id],
  }),
}))

export const pettyCashApprovalHistoryRelations = relations(pettyCashApprovalHistory, ({ one }) => ({
  request: one(pettyCashRequests, {
    fields: [pettyCashApprovalHistory.requestId],
    references: [pettyCashRequests.id],
  }),
  expense: one(pettyCashExpenses, {
    fields: [pettyCashApprovalHistory.expenseId],
    references: [pettyCashExpenses.id],
  }),
  actor: one(users, {
    fields: [pettyCashApprovalHistory.performedBy],
    references: [users.id],
  }),
}))

export const pettyCashLedgerEntriesRelations = relations(pettyCashLedgerEntries, ({ one }) => ({
  allocation: one(pettyCashAllocations, {
    fields: [pettyCashLedgerEntries.allocationId],
    references: [pettyCashAllocations.id],
  }),
  request: one(pettyCashRequests, {
    fields: [pettyCashLedgerEntries.requestId],
    references: [pettyCashRequests.id],
  }),
  expense: one(pettyCashExpenses, {
    fields: [pettyCashLedgerEntries.expenseId],
    references: [pettyCashExpenses.id],
  }),
  creator: one(users, {
    fields: [pettyCashLedgerEntries.createdBy],
    references: [users.id],
  }),
}))

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userId],
    references: [users.id],
  }),
}))

// Kia Bookings Table
export const kiaBookings = pgTable('kia_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingNumber: text('booking_number').unique().notNull(),
  status: text('status').default('booking_created').notNull(),
  dealerCode: text('dealer_code').notNull(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  customerEmail: text('customer_email'),
  customerAddress: text('customer_address'),
  model: text('model').notNull(),
  variant: text('variant').notNull(),
  color: text('color'),
  fuelType: text('fuel_type'),
  consultantName: text('consultant_name').notNull(),
  consultantEmail: text('consultant_email'),
  source: text('source'),
  financeRequired: boolean('finance_required').default(false).notNull(),
  bankName: text('bank_name'),
  loanAmount: decimal('loan_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  deliveryTargetDate: text('delivery_target_date'), // text date representation, e.g. YYYY-MM-DD
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  proformaId: uuid('proforma_id').references(() => kiaProformas.id),
  financeOrderId: uuid('finance_order_id').references(() => financeOrders.id),
  allocatedVin: text('allocated_vin'),
  notes: text('notes'),
  idtRemark: text('idt_remark'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// Kia Booking Activity / Timeline Table
export const kiaBookingActivity = pgTable('kia_booking_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id).notNull(),
  activityType: text('activity_type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  beforeValue: jsonb('before_value').$type<Record<string, unknown>>(),
  afterValue: jsonb('after_value').$type<Record<string, unknown>>(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorName: text('actor_name'),
  actorRole: text('actor_role'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ── KIA customer-vehicle Finance Workflow (migration 0014) ──────────────────────────────────────
// Booking/proforma-scoped loan lifecycle — distinct from the dealer-payout finance_orders system.
export const kiaFinanceProcessing = pgTable('kia_finance_processing', {
  id: uuid('id').primaryKey().defaultRandom(),
  proformaId: uuid('proforma_id').references(() => kiaProformas.id).notNull().unique(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id),
  financeStatus: text('finance_status').default('pending').notNull(), // pending | in_progress | delayed | completed
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  expectedCompletionDate: timestamp('expected_completion_date', { withTimezone: true }).notNull(),
  baseHours: integer('base_hours').default(72).notNull(), // 72 or 120 (CSD) — snapshot so the countdown is stable
  delayCount: integer('delay_count').default(0).notNull(),
  lastDelayReasonCategory: text('last_delay_reason_category'),
  lastDelayReason: text('last_delay_reason'),
  currentBankName: text('current_bank_name'),
  currentBankBranch: text('current_bank_branch'),
  currentBankStatus: text('current_bank_status'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedBy: uuid('completed_by').references(() => users.id),
  completedByName: text('completed_by_name'),
  completedByRole: text('completed_by_role'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Append-only remark history — never overwritten.
export const kiaFinanceRemarks = pgTable('kia_finance_remarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  financeProcessingId: uuid('finance_processing_id').references(() => kiaFinanceProcessing.id).notNull(),
  remark: text('remark').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdByName: text('created_by_name').notNull(),
  createdByRole: text('created_by_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Append-only bank-attempt history. A new bank on rejection is a NEW row (higher attempt_no), never an overwrite.
export const kiaFinanceBankAttempts = pgTable('kia_finance_bank_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  financeProcessingId: uuid('finance_processing_id').references(() => kiaFinanceProcessing.id).notNull(),
  attemptNo: integer('attempt_no').notNull(),
  bankName: text('bank_name').notNull(),
  bankBranch: text('bank_branch').notNull(),
  status: text('status').default('Pending').notNull(), // Pending | Approved | Rejected
  rejectionReason: text('rejection_reason'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdByName: text('created_by_name').notNull(),
  createdByRole: text('created_by_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// IMMUTABLE audit log — a DB trigger blocks UPDATE/DELETE (migration 0014). Insert-only.
export const kiaFinanceActivity = pgTable('kia_finance_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  financeProcessingId: uuid('finance_processing_id').references(() => kiaFinanceProcessing.id).notNull(),
  proformaId: uuid('proforma_id').notNull(),
  activityType: text('activity_type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  beforeValue: jsonb('before_value').$type<Record<string, unknown>>(),
  afterValue: jsonb('after_value').$type<Record<string, unknown>>(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Finance Payouts — the post-delivery finance ledger (bank/dealer/DSE payouts, loan + bank-visit
 * activity). Deliberately INDEPENDENT of the booking workflow: a row here is created when a vehicle
 * is delivered, but nothing in this table ever changes a booking's status. It is not a booking stage.
 *
 * SNAPSHOT, not a live join. The booking-sourced columns below are copied at delivery rather than
 * joined on read, for two reasons: (1) imported/legacy rows have no booking to join to, and (2) a
 * finance ledger wants the state AS AT DELIVERY — later edits to the booking must not silently
 * rewrite finance history.
 *
 * `booking_id` is nullable (imports have none) and carries a PARTIAL UNIQUE index where not null, so
 * a delivered booking maps to exactly one payout row and auto-population is idempotent.
 */
export const kiaFinancePayouts = pgTable('kia_finance_payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Defaulted 'kia' — the only brand with a bookings module today. Present so a second brand is a
  // data change rather than a migration; no cross-brand plumbing is built yet.
  brand: text('brand').default('kia').notNull(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id),
  source: text('source').default('delivery').notNull(), // 'delivery' | 'import' | 'manual'

  // --- Snapshot: sourced from the delivered booking (or the legacy import). Read-only in the UI. ---
  deliveryDate: timestamp('delivery_date', { withTimezone: true }),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'), // PII — masked to everyone except md/developer, see lib/finance/payouts-access.ts
  model: text('model'),
  salesExecutive: text('sales_executive'),
  dealerCode: text('dealer_code'),
  tlName: text('tl_name'),
  hyp: text('hyp'), // hypothecation bank
  bankBranch: text('bank_branch'),
  loanAmount: decimal('loan_amount', { precision: 14, scale: 2 }),
  panNumber: text('pan_number'),
  vehicleRegistrationNo: text('vehicle_registration_no'),

  // --- Finance-specific: editable, audited in kia_finance_payout_activity ---
  payoutStatus: text('payout_status'), // 'in_house' | 'out_house' | 'cash' | 'staff'
  reasonIfOuthouse: text('reason_if_outhouse'),
  dealerPayoutPercent: decimal('dealer_payout_percent', { precision: 8, scale: 4 }),
  dealerPayoutAmount: decimal('dealer_payout_amount', { precision: 14, scale: 2 }),
  payoutReceiptStatus: text('payout_receipt_status'), // 'pending' | 'no_payout' | 'received'
  dsePayoutAmount: decimal('dse_payout_amount', { precision: 14, scale: 2 }),
  dsePayoutStatus: text('dse_payout_status'),
  dealerPayoutStatus: text('dealer_payout_status'),
  paymentReceivedDate: timestamp('payment_received_date', { withTimezone: true }),
  amountReceived: decimal('amount_received', { precision: 14, scale: 2 }),
  invoiceNumber: text('invoice_number'),
  bankVisitScheduled: boolean('bank_visit_scheduled').default(false).notNull(),
  dateOfBankVisit: timestamp('date_of_bank_visit', { withTimezone: true }),
  visitedBy: text('visited_by'),
  bankerRemarks: text('banker_remarks'),
  hypAsPerRc: text('hyp_as_per_rc'),
  loginUser: text('login_user'),
  bankInterestRate: decimal('bank_interest_rate', { precision: 5, scale: 2 }),
  bankLogin: boolean('bank_login'),
  bankInProforma: text('bank_in_proforma'),

  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // The dashboard's default sort + the delivered-date filters.
  kiaFinancePayoutsDeliveryIdx: index('kia_finance_payouts_delivery_idx').on(table.deliveryDate),
  kiaFinancePayoutsDealerIdx: index('kia_finance_payouts_dealer_idx').on(table.dealerCode),
  kiaFinancePayoutsStatusIdx: index('kia_finance_payouts_status_idx').on(table.payoutReceiptStatus),
  // NOTE the partial UNIQUE index on booking_id (WHERE booking_id IS NOT NULL) is created in
  // migration 0021 — Drizzle cannot express a partial unique index here.
}))

/**
 * IMMUTABLE per-field edit history for kia_finance_payouts. A DB trigger blocks UPDATE/DELETE
 * (migration 0021), so this is a true audit trail — insert-only, for app and admin alike.
 *
 * Deliberately NOT kia_finance_activity: that table is keyed on finance_processing_id + proforma_id,
 * and payout rows are frequently standalone (legacy imports with no proforma at all).
 */
export const kiaFinancePayoutActivity = pgTable('kia_finance_payout_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  payoutId: uuid('payout_id').references(() => kiaFinancePayouts.id).notNull(),
  field: text('field').notNull(),
  beforeValue: jsonb('before_value').$type<Record<string, unknown>>(),
  afterValue: jsonb('after_value').$type<Record<string, unknown>>(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaFinancePayoutActivityPayoutIdx: index('kia_finance_payout_activity_payout_idx').on(table.payoutId, table.createdAt),
}))

// Kia Vehicle Allocations Table
export const kiaVehicleAllocations = pgTable('kia_vehicle_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id).notNull(),
  vinNumber: text('vin_number').notNull(),
  dealerCode: text('dealer_code'),
  model: text('model'),
  variant: text('variant'),
  color: text('color'),
  engineNo: text('engine_no'),
  stockSource: text('stock_source').default('dms').notNull(),
  vehicleSnapshot: jsonb('vehicle_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  allocationStatus: text('allocation_status').default('temporary').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /**
   * The effective payment window for THIS allocation, in hours (migration 0035).
   *
   * NULL = "no explicit window recorded, policy default applies" (72h, or 120h for CSD). Written at
   * allotment and overwritten only when the MD approves an extension.
   *
   * ⚠️ TWO readers must stay in agreement, and one of them is raw SQL:
   *   - lib/kia/bookings.ts allotKiaBookingVehicle  (sets expires_at immediately)
   *   - lib/kia/bookings.ts startKiaArrivedAllocationCountdowns (opens the clock on arrival for
   *     in-transit cars — re-derives the window IN SQL, so it reads this column via COALESCE)
   * Without this column an extension approved while a car was in transit was silently discarded.
   */
  paymentWindowHours: integer('payment_window_hours'),
  paymentConfirmedAt: timestamp('payment_confirmed_at', { withTimezone: true }),
  paymentConfirmedBy: uuid('payment_confirmed_by').references(() => users.id),
  paymentReference: text('payment_reference'),
  allocatedBy: uuid('allocated_by').references(() => users.id).notNull(),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).defaultNow().notNull(),
  releasedBy: uuid('released_by').references(() => users.id),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releaseReason: text('release_reason'),
  // Stock-presence tracking: the vehicle is retained here even after it leaves the DMS feed.
  // stockStatus 'sold' + stockMissingAt are set when the VIN is no longer in kia_stock_management.
  stockLastSeenAt: timestamp('stock_last_seen_at', { withTimezone: true }),
  stockMissingAt: timestamp('stock_missing_at', { withTimezone: true }),
  stockStatus: text('stock_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Kia Vehicle Transfers Table
export const kiaVehicleTransfers = pgTable('kia_vehicle_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id).notNull(),
  vinNumber: text('vin_number'),
  fromDealerCode: text('from_dealer_code'),
  toDealerCode: text('to_dealer_code').notNull(),
  transferStatus: text('transfer_status').default('requested').notNull(),
  requestedBy: uuid('requested_by').references(() => users.id).notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  // Transfer retention primitive (#9, migration 0013) — mirrors kia_vehicle_allocations. The
  // destination dealer keeps the vehicle (from vehicle_snapshot) even after the VIN leaves the DMS feed.
  vehicleSnapshot: jsonb('vehicle_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
  stockLastSeenAt: timestamp('stock_last_seen_at', { withTimezone: true }),
  stockMissingAt: timestamp('stock_missing_at', { withTimezone: true }),
  stockStatus: text('stock_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Drizzle Relations for Bookings
export const kiaBookingsRelations = relations(kiaBookings, ({ one, many }) => ({
  proforma: one(kiaProformas, {
    fields: [kiaBookings.proformaId],
    references: [kiaProformas.id],
  }),
  financeOrder: one(financeOrders, {
    fields: [kiaBookings.financeOrderId],
    references: [financeOrders.id],
  }),
  creator: one(users, {
    fields: [kiaBookings.createdBy],
    references: [users.id],
  }),
  activities: many(kiaBookingActivity),
  allocations: many(kiaVehicleAllocations),
  transfers: many(kiaVehicleTransfers),
}))

export const kiaBookingActivityRelations = relations(kiaBookingActivity, ({ one }) => ({
  booking: one(kiaBookings, {
    fields: [kiaBookingActivity.bookingId],
    references: [kiaBookings.id],
  }),
  performer: one(users, {
    fields: [kiaBookingActivity.actorUserId],
    references: [users.id],
  }),
}))

export const kiaVehicleAllocationsRelations = relations(kiaVehicleAllocations, ({ one }) => ({
  booking: one(kiaBookings, {
    fields: [kiaVehicleAllocations.bookingId],
    references: [kiaBookings.id],
  }),
  allocator: one(users, {
    fields: [kiaVehicleAllocations.allocatedBy],
    references: [users.id],
  }),
}))

export const kiaVehicleTransfersRelations = relations(kiaVehicleTransfers, ({ one }) => ({
  booking: one(kiaBookings, {
    fields: [kiaVehicleTransfers.bookingId],
    references: [kiaBookings.id],
  }),
  performer: one(users, {
    fields: [kiaVehicleTransfers.requestedBy],
    references: [users.id],
  }),
}))

// Kia Quotes Table
export const kiaQuotes = pgTable('kia_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  customerEmail: text('customer_email').notNull(),
  vehicle: text('vehicle').notNull(),
  budget: decimal('budget', { precision: 14, scale: 2 }).default('0').notNull(),
  price: decimal('price', { precision: 14, scale: 2 }).default('0').notNull(),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const kiaQuotesRelations = relations(kiaQuotes, ({ one }) => ({
  creator: one(users, {
    fields: [kiaQuotes.createdBy],
    references: [users.id],
  }),
}))

// Delivery log for transactional customer emails (approved-proforma, quote, and
// future workflow notifications). Booking-less emails (e.g. quotes) leave
// booking_id null. Status: 'pending' | 'sent' | 'failed'.
export const kiaEmailLogs = pgTable('kia_email_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id'),
  customerEmail: text('customer_email').notNull(),
  subject: text('subject').notNull(),
  emailType: text('email_type'),
  status: text('status').default('pending').notNull(),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Customer callback requests raised from the "Request a Callback" button in the proforma email.
// Deliberately stores NO customer phone/email — only basic details — so PII never leaks to staff.
export const kiaCallbackRequests = pgTable('kia_callback_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id).notNull(),
  customerName: text('customer_name').notNull(),
  preferredTime: text('preferred_time'), // 'morning' | 'afternoon' | 'evening' | 'anytime'
  note: text('note'),
  status: text('status').default('pending').notNull(), // 'pending' | 'contacted' | 'closed'
  source: text('source').default('proforma_email').notNull(),
  contactedBy: uuid('contacted_by').references(() => users.id),
  contactedAt: timestamp('contacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaCallbackRequestsBookingIdx: index('kia_callback_requests_booking_idx').on(table.bookingId),
  kiaCallbackRequestsStatusIdx: index('kia_callback_requests_status_idx').on(table.status),
}))

// KIA Call Center — masked click-to-call. A call agent's OWN phone (what the system rings to
// connect them). The customer's number is never stored anywhere; it's looked up server-side only.
export const kiaCallAgentPhones = pgTable('kia_call_agent_phones', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  agentPhone: text('agent_phone').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// One row per masked call attempt. NO customer phone is stored (booking_id links the customer).
export const kiaCallLogs = pgTable('kia_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id),
  callbackRequestId: uuid('callback_request_id').references(() => kiaCallbackRequests.id),
  agentId: uuid('agent_id').references(() => users.id).notNull(),
  provider: text('provider').default('simulation').notNull(),
  providerCallId: text('provider_call_id'),
  status: text('status').default('initiated').notNull(),
  durationSec: integer('duration_sec').default(0).notNull(),
  disposition: text('disposition'),
  notes: text('notes'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaCallLogsAgentIdx: index('kia_call_logs_agent_idx').on(table.agentId, table.createdAt),
  kiaCallLogsBookingIdx: index('kia_call_logs_booking_idx').on(table.bookingId),
  kiaCallLogsProviderCallIdx: index('kia_call_logs_provider_call_idx').on(table.providerCallId),
  // Serves the call-analytics started_at range filters + the call-center recent-calls ORDER BY started_at.
  kiaCallLogsStartedAtIdx: index('kia_call_logs_started_at_idx').on(table.startedAt),
}))

// KIA Lead Follow-up pipeline — a staff-scheduled "next touch" on a booking so no lead goes cold.
// No customer phone stored (booking_id links the customer; number stays server-only / masked).
export const kiaLeadFollowups = pgTable('kia_lead_followups', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id).notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedName: text('assigned_name'),
  assignedEmail: text('assigned_email'),
  dealerCode: text('dealer_code'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'done' | 'cancelled'
  reason: text('reason').default('general').notNull(), // 'callback' | 'payment_pending' | 'document_pending' | 'delivery' | 'general'
  priority: text('priority').default('normal').notNull(), // 'low' | 'normal' | 'high'
  notes: text('notes'),
  source: text('source').default('manual').notNull(), // 'manual' | 'call' | 'callback_request'
  sourceCallId: uuid('source_call_id').references(() => kiaCallLogs.id),
  outcome: text('outcome'),
  // WHY THE CUSTOMER DECLINED — required when outcome='not_interested'. A preset code so the
  // analytics dashboard can rank reasons. NOT the same thing as `reason` above, which is why the
  // follow-up was SCHEDULED. Same word, opposite concept; the free-text detail lives in `notes`.
  notInterestedReason: text('not_interested_reason'),
  completedBy: uuid('completed_by').references(() => users.id),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kiaLeadFollowupsStatusDueIdx: index('kia_lead_followups_status_due_idx').on(table.status, table.dueAt),
  kiaLeadFollowupsAssignedIdx: index('kia_lead_followups_assigned_idx').on(table.assignedTo, table.status),
  kiaLeadFollowupsBookingIdx: index('kia_lead_followups_booking_idx').on(table.bookingId),
  // Serve the call-analytics created_at / completed_at date aggregations (unindexed before).
  kiaLeadFollowupsCreatedAtIdx: index('kia_lead_followups_created_at_idx').on(table.createdAt),
  kiaLeadFollowupsCompletedAtIdx: index('kia_lead_followups_completed_at_idx').on(table.completedAt),
}))

// Vehicle Tracker (Service floor): logs a vehicle leaving and returning, with an
// AI-verified, timestamped camera photo. status: 'out' | 'returned'.
// durationMinutes is computed on return (vehicle_in_at - vehicle_out_at).
export const kiaVehicleTracker = pgTable('kia_vehicle_tracker', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  entryDate: date('entry_date').notNull(),
  vehicleOutAt: timestamp('vehicle_out_at', { withTimezone: true }).notNull(),
  vehicleInAt: timestamp('vehicle_in_at', { withTimezone: true }),
  status: text('status').default('out').notNull(),
  durationMinutes: integer('duration_minutes'),
  outPhotoUrl: text('out_photo_url').notNull(),
  outPhotoPath: text('out_photo_path'),
  inPhotoUrl: text('in_photo_url'),
  inPhotoPath: text('in_photo_path'),
  dealerCode: text('dealer_code'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const kiaVehicleTrackerRelations = relations(kiaVehicleTracker, ({ one }) => ({
  creator: one(users, {
    fields: [kiaVehicleTracker.createdBy],
    references: [users.id],
  }),
}))

export const glAccounts = pgTable('gl_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  glCode: text('gl_code').notNull().unique(),
  glName: text('gl_name').notNull(),
  tallyGroup: text('tally_group').notNull(),
  accountNature: text('account_nature').notNull(),
  accountType: text('account_type').notNull(),
  appliesTo: text('applies_to').default('both').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  monthlyBudget: decimal('monthly_budget', { precision: 14, scale: 2 }).default('0.00'),
  quarterlyBudget: decimal('quarterly_budget', { precision: 14, scale: 2 }).default('0.00'),
  annualBudget: decimal('annual_budget', { precision: 14, scale: 2 }).default('0.00'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const kiaApprovalRequests = pgTable('kia_approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  employeeId: text('employee_id'),
  location: text('location'),
  dealerCode: text('dealer_code'),
  dealerName: text('dealer_name'),
  department: text('department'),
  specifyOtherDepartment: text('specify_other_department'),
  approvalType: text('approval_type'),
  vendorName: text('vendor_name'),
  specifyOtherApprovalType: text('specify_other_approval_type'),
  previousAdvance: text('previous_advance'),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  typeOfPayment: text('type_of_payment'),
  remarks: text('remarks'),
  vpApproval: text('vp_approval'),
  accountApproval: text('account_approval'),
  hrApproval: text('hr_approval'),
  eaApproval: text('ea_approval'),
  managementApproval: text('management_approval'),
  managementRemarks: text('management_remarks'),
  // Full ordered list of bills for this request (migration 0034). The two columns below are the
  // legacy first-two mirror, still written and still read by the approver UI, the emails and the
  // printed voucher — see the migration for why they stay.
  /**
   * Human-readable, per-brand request number — KIA_0001, HYUNDAI_0001 (migration 0039).
   * Allocated by lib/approvals/request-number.ts, unique-indexed. Nullable only so the column could
   * be added to 126 existing rows before the backfill ran; every new row gets one.
   */
  requestNo: text('request_no'),
  billUrls: jsonb('bill_urls').$type<string[]>().default([]).notNull(),
  uploadBillUrl1: text('upload_bill_url_1'),
  uploadBillUrl2: text('upload_bill_url_2'),
  uploadDocUrl: text('upload_doc_url'),
  emailSendStatus: text('email_send_status'),
  invoiceNumber: text('invoice_number'),
  invoiceDocUrl: text('invoice_doc_url'),
  paymentStatus: text('payment_status').default('PENDING').notNull(),
  utrNumber: text('utr_number'),
  paymentProofUrl: text('payment_proof_url'),
  paymentRemarks: text('payment_remarks'),
  paymentCompletedAt: timestamp('payment_completed_at', { withTimezone: true }),
  paymentCompletedBy: text('payment_completed_by'),
  sendBackReason: text('send_back_reason'),
  history: jsonb('history').$type<any[]>().default([]).notNull(),
  brand: text('brand').default('kia').notNull(),
  glAccountId: uuid('gl_account_id').references(() => glAccounts.id),
  gst: text('gst'),
  vehicleNumber: text('vehicle_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const kiaApprovalRequestsRelations = relations(kiaApprovalRequests, ({ one }) => ({
  glAccount: one(glAccounts, {
    fields: [kiaApprovalRequests.glAccountId],
    references: [glAccounts.id],
  }),
}))

// ── Vendors ──────────────────────────────────────────────────────────────────
// Central vendor / company registry — shared across all brands and modules.
// name + gstNumber are mandatory; email / phone / address are optional.
// Soft-delete via deletedAt so historical records on approval requests are preserved.
export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  gstNumber: text('gst_number'),
  vendorCode: text('vendor_code').unique(),
  bankAccountNumber: text('bank_account_number'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  vendorsGstIdx: index('vendors_gst_idx').on(table.gstNumber),
  vendorsNameIdx: index('vendors_name_idx').on(table.name),
}))

// ── Approvals Common Metadata ────────────────────────────────────────────────
export const approvalsCommonData = pgTable('approvals_common_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').notNull(), // 'vendor' or 'approval_type'
  value: text('value').notNull(),
  brand: text('brand').default('all').notNull(), // 'kia', 'hyundai', 'tata', 'mg', 'platinum', 'all'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ── Approvals Branches Config ────────────────────────────────────────────────
export const approvalsBranchesConfig = pgTable('approvals_branches_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  brand: text('brand').notNull(), // 'kia', 'hyundai', 'tata', 'mg', 'platinum'
  location: text('location').notNull(),
  dealerCode: text('dealer_code').notNull(),
  dealerName: text('dealer_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ── Delegation Tasks (cross-brand top-down task delegation) — migration 0024 ──
// A leader/manager delegates a task DOWN to a specific user and tracks it to completion. Generic
// (not tied to a booking or a brand). assigned_to is a real FK + a denormalized name/email snapshot
// (same reason kiaLeadFollowups does it). status/priority are validated in the lib layer, not a
// pgEnum. See lib/delegation/tasks.ts + lib/delegation/access.ts.
export const delegationContacts = pgTable('delegation_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const delegationTasks = pgTable('delegation_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  // Assignee (the delegatee)
  assignedTo: uuid('assigned_to').references(() => users.id),
  externalContactId: uuid('external_contact_id').references(() => delegationContacts.id),
  assignedName: text('assigned_name'),
  assignedEmail: text('assigned_email'),
  // Scheduling / classification
  dueAt: timestamp('due_at', { withTimezone: true }),
  followUpAt: timestamp('follow_up_at', { withTimezone: true }),
  status: text('status').default('assigned').notNull(), // 'assigned' | 'in_progress' | 'done' | 'cancelled'
  priority: text('priority').default('high').notNull(), // 'low' | 'normal' | 'high'
  // Optional cross-brand tagging (non-enforcing)
  brand: text('brand'),
  dealerCode: text('dealer_code'),
  // Close-out
  completionRemark: text('completion_remark'),
  completedBy: uuid('completed_by').references(() => users.id),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // Future email reminder (unused in v1)
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  // MD Ownership for strict EA/MD scoping (migration 0026)
  mdUserId: uuid('md_user_id').references(() => users.id),
  // Audit
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  delegationTasksAssignedIdx: index('delegation_tasks_assigned_idx').on(table.assignedTo, table.status),
  delegationTasksCreatorIdx: index('delegation_tasks_creator_idx').on(table.createdBy, table.status),
  delegationTasksStatusDueIdx: index('delegation_tasks_status_due_idx').on(table.status, table.dueAt),
  delegationTasksCreatedAtIdx: index('delegation_tasks_created_at_idx').on(table.createdAt),
  // Brand-scoped list filter + the group-MD per-branch rollup (migration 0025).
  delegationTasksBrandStatusIdx: index('delegation_tasks_brand_status_idx').on(table.brand, table.status),
  delegationTasksMdIdx: index('delegation_tasks_md_idx').on(table.mdUserId, table.status),
}))

// Append-only, human-readable timeline for a task. Made IMMUTABLE by a DB trigger (migration 0024,
// same pattern as kiaFinancePayoutActivity) — INSERT only; UPDATE/DELETE raise.
export const delegationTaskActivity = pgTable('delegation_task_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => delegationTasks.id).notNull(),
  type: text('type').notNull(), // 'assigned' | 'started' | 'completed' | 'reopened' | 'reassigned' | 'cancelled' | 'edited' | 'commented'
  message: text('message'),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  delegationTaskActivityTaskIdx: index('delegation_task_activity_task_idx').on(table.taskId, table.createdAt),
}))

// KIA Booking Discounts Table
export const kiaBookingDiscounts = pgTable('kia_booking_discounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id, { onDelete: 'cascade' }).notNull(),
  requestedAmount: decimal('requested_amount', { precision: 14, scale: 2 }).notNull(),
  approvedAmount: decimal('approved_amount', { precision: 14, scale: 2 }),
  reason: text('reason'),
  status: text('status').default('PENDING').notNull(), // 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedBy: uuid('requested_by').references(() => users.id).notNull(),
  requestedByName: text('requested_by_name').notNull(),
  actionBy: uuid('action_by').references(() => users.id),
  actionByName: text('action_by_name'),
  actionRemarks: text('action_remarks'),
  actionAt: timestamp('action_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  bookingIdIdx: index('kia_booking_discounts_booking_idx').on(table.bookingId),
  statusIdx: index('kia_booking_discounts_status_idx').on(table.status),
}))

/**
 * KIA payment-window extension requests (migration 0035).
 *
 * A consultant allotting a car may optionally ask for longer than the standard payment window
 * (72h, or 120h for CSD). The allotment still proceeds on the DEFAULT window — this request changes
 * nothing until the MD approves it, at which point the allocation's window is extended.
 *
 * Column names deliberately mirror kiaBookingDiscounts (requested_* / action_* / status) so the two
 * approval queues read the same way. `action_*` covers BOTH approve and reject.
 */
export const kiaPaymentWindowRequests = pgTable('kia_payment_window_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => kiaBookings.id, { onDelete: 'cascade' }).notNull(),
  // The subject of the approval. booking_id/vin_number are denormalised so the MD queue and the
  // booking drawer can filter without a join.
  allocationId: uuid('allocation_id').references(() => kiaVehicleAllocations.id, { onDelete: 'cascade' }).notNull(),
  vinNumber: text('vin_number').notNull(),
  requestedDays: integer('requested_days').notNull(),
  // The policy default in force when the request was raised, so the MD sees "was 3 days, wants 7".
  baseHours: integer('base_hours').notNull(),
  reason: text('reason').notNull(),
  status: text('status').default('PENDING').notNull(), // 'PENDING' | 'APPROVED' | 'REJECTED'
  approvedDays: integer('approved_days'), // what the MD actually granted; may differ from requested
  requestedBy: uuid('requested_by').references(() => users.id).notNull(),
  requestedByName: text('requested_by_name').notNull(),
  actionBy: uuid('action_by').references(() => users.id),
  actionByName: text('action_by_name'),
  actionRemarks: text('action_remarks'),
  actionAt: timestamp('action_at', { withTimezone: true }),
  // What was actually written to kia_vehicle_allocations.expires_at. NULL on an approved in-transit
  // allocation, where the extended window only begins when the vehicle arrives.
  appliedExpiresAt: timestamp('applied_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  bookingIdIdx: index('kia_payment_window_requests_booking_idx').on(table.bookingId),
  statusIdx: index('kia_payment_window_requests_status_idx').on(table.status),
  allocationIdx: index('kia_payment_window_requests_allocation_idx').on(table.allocationId),
  // A partial unique index (allocation_id) WHERE status = 'PENDING' also exists — declared in the
  // migration rather than here, because Drizzle cannot express a partial unique index.
}))

// ----------------------------------------------------
// SCRAP ERP TABLES
// ----------------------------------------------------

export const scrapLocations = pgTable('scrap_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapDepartments = pgTable('scrap_departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapTypes = pgTable('scrap_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  unit: text('unit').default('Kg').notNull(),
  defaultRatePerUnit: decimal('default_rate_per_unit', { precision: 12, scale: 2 }).default('0').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapDescriptions = pgTable('scrap_descriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scrapTypeId: uuid('scrap_type_id').references(() => scrapTypes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapEmployees = pgTable('scrap_employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  role: text('role').default('Staff').notNull(),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapPaymentModes = pgTable('scrap_payment_modes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isOnline: boolean('is_online').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapHandoverUsers = pgTable('scrap_handover_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  designation: text('designation'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const scrapTransactions = pgTable('scrap_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionNumber: text('transaction_number').notNull(),
  groupName: text('group_name').default('JAM'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  locationId: uuid('location_id').references(() => scrapLocations.id),
  locationName: text('location_name').notNull(),
  departmentId: uuid('department_id').references(() => scrapDepartments.id),
  departmentName: text('department_name').notNull(),
  scrapTypeId: uuid('scrap_type_id').references(() => scrapTypes.id),
  scrapTypeName: text('scrap_type_name').notNull(),
  description: text('description').notNull(),
  weightQty: decimal('weight_qty', { precision: 12, scale: 2 }).default('0').notNull(),
  ratePerUnit: decimal('rate_per_unit', { precision: 12, scale: 2 }).default('0').notNull(),
  calculatedTotal: decimal('calculated_total', { precision: 14, scale: 2 }).default('0').notNull(),
  amountReceived: decimal('amount_received', { precision: 14, scale: 2 }).default('0').notNull(),
  outstandingAmount: decimal('outstanding_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  soldById: uuid('sold_by_id').references(() => scrapEmployees.id),
  soldByName: text('sold_by_name').notNull(),
  soldTo: text('sold_to').notNull(),
  soldDate: timestamp('sold_date', { withTimezone: true }).defaultNow().notNull(),
  paymentModeId: uuid('payment_mode_id').references(() => scrapPaymentModes.id),
  paymentModeName: text('payment_mode_name').notNull(),
  paymentHandoverToId: uuid('payment_handover_to_id').references(() => scrapHandoverUsers.id),
  paymentHandoverToName: text('payment_handover_to_name').notNull(),
  remarks: text('remarks'),
  status: text('status').default('COMPLETED').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  scrapTransNoIdx: uniqueIndex('scrap_trans_no_idx').on(table.transactionNumber),
  scrapTransDateIdx: index('scrap_trans_date_idx').on(table.timestamp),
  scrapTransLocIdx: index('scrap_trans_loc_idx').on(table.locationName),
  scrapTransDeptIdx: index('scrap_trans_dept_idx').on(table.departmentName),
  scrapTransTypeIdx: index('scrap_trans_type_idx').on(table.scrapTypeName),
}))

export const scrapAttachments = pgTable('scrap_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id').references(() => scrapTransactions.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(),
  url: text('url').notNull(),
  fileName: text('file_name').notNull(),
  fileSize: decimal('file_size', { precision: 12, scale: 0 }),
  mimeType: text('mime_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  scrapAttTransIdx: index('scrap_att_trans_idx').on(table.transactionId),
}))

// ----------------------------------------------------
// SCRAP MASTER DATA TABLE (DYNAMIC STORE FOR ALL DROPDOWNS)
// ----------------------------------------------------

export const scrapMasterData = pgTable('scrap_master_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').notNull(), // 'location' | 'department' | 'scrap_type' | 'description' | 'sold_by' | 'payment_mode' | 'payment_handover_to' | 'group'
  name: text('name').notNull(),
  code: text('code'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: decimal('sort_order', { precision: 8, scale: 0 }).default('0').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  scrapMasterCategoryIdx: index('scrap_master_category_idx').on(table.category),
  scrapMasterNameCategoryIdx: uniqueIndex('scrap_master_name_category_idx').on(table.category, table.name),
}))

// Hyundai & Platinum Discount Approvals Table
export const discountApprovals = pgTable('discount_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterName: text('requester_name').notNull(),
  branch: text('branch').notNull(), // 'hyundai' or 'platinum'
  customerId: text('customer_id').notNull(),
  customerName: text('customer_name'),
  model: text('model'),
  variant: text('variant'),
  color: text('color'),
  discountAmount: decimal('discount_amount', { precision: 14, scale: 2 }).notNull(),
  accessoriesAmount: decimal('accessories_amount', { precision: 14, scale: 2 }),
  tlManager: text('tl_manager'),
  teleDate: date('tele_date'),
  insuranceType: text('insurance_type'), // 'In House' | 'Out House'
  deliveryDate: date('delivery_date'),
  reference: text('reference'),
  status: text('status').default('PENDING').notNull(), // 'PENDING_GSM' | 'PENDING_VP' | 'PENDING_MD' | 'APPROVED' | 'REJECTED'
  remarks: text('remarks'),
  history: jsonb('history').$type<any[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const discountApprovalsEmployees = pgTable('am_group_discount_approvals_employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  role: text('role').notNull(), // 'sales_executive' | 'team_leader'
  branch: text('branch').notNull(), // 'hyundai' | 'platinum'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Social Media Leads Table
export const socialMediaLeads = pgTable('social_media_leads', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  rowHash: text('row_hash'),
  conversationName: text('conversation_name'),
  customerName: text('customer_name'),
  customer: text('customer'),
  ownername: text('ownername'),
  phoneNum: text('phone_num'),
  phoneNo: text('phone_no'),
  fullPhoneNumber: text('full_phone_number'),
  userId: text('user_id'),
  source: text('source'),
  leadSource: text('lead_source'),
  enquirySource: text('enquiry_source'),
  model: text('model'),
  variant: text('variant'),
  colour: text('colour'),
  dealerCode: text('dealer_code'),
  city: text('city'),
  location: text('location'),
  creRemark: text('cre_remark'),
  kecRemark: text('kec_remark'),
  followupStatus: text('followup_status'),
  status: text('status'),
  contact: text('contact'),
  chatTranscript: text('chat_transcript'),
  messageCount: integer('message_count'),
  firstMessage: text('first_message'),
  lastMessage: text('last_message'),
  leadAge: text('lead_age'),
  assignedTo: text('assigned_to'),
  tags: text('tags'),
  notes: text('notes'),
  adUrl: text('ad_url'),
  createdAt: text('created_at'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

