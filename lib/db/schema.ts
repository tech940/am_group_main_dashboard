import { pgTable, uuid, text, timestamp, boolean, integer, decimal, jsonb, pgEnum, index, uniqueIndex, bigint, date } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Enums
export const roleEnum = pgEnum('role', ['admin', 'super_admin', 'branch_admin', 'ceo', 'purchase_manager', 'finance_head', 'ea', 'md', 'accounts', 'manager', 'technician', 'viewer'])
export const statusEnum = pgEnum('status', ['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'])
export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'urgent'])
export const vehicleStatusEnum = pgEnum('vehicle_status', ['available', 'in_use', 'maintenance', 'retired'])
export const inventoryStatusEnum = pgEnum('inventory_status', ['in_stock', 'out_of_stock', 'low_stock', 'discontinued'])
export const purchaseOrderStageEnum = pgEnum('purchase_order_stage', ['initial_submission', 'vendor_information', 'ea_approval', 'md_approval', 'grn', 'accounts'])
export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', ['submitted', 'vendor_info_pending', 'awaiting_ea_approval', 'ea_approved', 'ea_denied', 'awaiting_md_approval', 'md_approved', 'md_denied', 'awaiting_grn', 'awaiting_accounts', 'completed', 'cancelled', 'on_hold', 'ea_on_hold', 'md_on_hold'])
export const financeOrderStageEnum = pgEnum('finance_order_stage', ['finance_head_submission', 'accounts_verification', 'ea_approval', 'md_approval', 'completed'])
export const financeOrderStatusEnum = pgEnum('finance_order_status', ['draft', 'awaiting_accounts_verification', 'accounts_verified', 'accounts_denied', 'accounts_on_hold', 'awaiting_ea_approval', 'ea_approved', 'ea_denied', 'ea_on_hold', 'awaiting_md_approval', 'md_approved', 'md_denied', 'md_on_hold', 'completed', 'cancelled'])
export const paymentModeEnum = pgEnum('payment_mode', ['cash', 'cheque', 'bank_transfer', 'upi', 'credit_card', 'other'])
export const pettyCashRequestStatusEnum = pgEnum('petty_cash_request_status', ['draft', 'submitted', 'ea_pending', 'ea_approved', 'ea_on_hold', 'ea_rejected', 'md_pending', 'md_approved', 'md_on_hold', 'md_rejected', 'accounts_pending', 'accounts_on_hold', 'approved', 'rejected', 'cancelled'])
export const pettyCashExpenseStatusEnum = pgEnum('petty_cash_expense_status', ['pending', 'ea_approved', 'ea_rejected', 'md_approved', 'md_rejected', 'accounts_pending', 'approved', 'rejected', 'cancelled'])
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
  department: text('department'),
  phoneNumber: text('phone_number'),
  avatarUrl: text('avatar_url'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

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

// Notifications table
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(), // 'info', 'success', 'warning', 'error'
  actionUrl: text('action_url'),
  purchaseOrderId: uuid('purchase_order_id'),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  referenceNumber: text('reference_number'),
  workflowStage: text('workflow_stage'),
  targetRole: roleEnum('target_role'),
  dedupeKey: text('dedupe_key').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => ({
  notificationsUserReadCreatedIdx: index('notifications_user_read_created_idx').on(table.userId, table.isRead, table.createdAt),
  notificationsPurchaseOrderIdx: index('notifications_purchase_order_idx').on(table.purchaseOrderId),
  notificationsEntityIdx: index('notifications_entity_idx').on(table.entityType, table.entityId),
  notificationsUserDedupeIdx: uniqueIndex('notifications_user_dedupe_idx').on(table.userId, table.dedupeKey),
}))

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
  employeeId?: string | null
  location?: string | null
  dealerCode?: string | null
  dealerName?: string | null
  department?: string | null
  advanceType?: string | null
  previousAdvance?: string | null
  typeOfPayment?: string | null
  remarks?: string | null
  uploadBillUrls?: string[]
  uploadDocumentUrls?: string[]
}

export type PettyCashExpenseFormData = {
  date?: string | null
  particulars?: string | null
  department?: string | null
  vendorName?: string | null
  receivedBy?: string | null
  purposeOfExpense?: string | null
  balanceEntered?: string | null
  remarks?: string | null
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
  currentStage: text('current_stage').default('ea_approval').notNull(),
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

export const kiaProformaLookupOptions = pgTable('kia_proforma_lookup_options', {
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
  kiaProformaLookupOptionsCategoryIdx: index('kia_proforma_lookup_options_category_idx').on(table.category),
  kiaProformaLookupOptionsValueIdx: index('kia_proforma_lookup_options_value_idx').on(table.value),
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
  notifications: many(notifications),
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

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
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
