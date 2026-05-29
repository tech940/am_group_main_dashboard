import { pgTable, uuid, text, timestamp, boolean, integer, decimal, jsonb, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Enums
export const roleEnum = pgEnum('role', ['admin', 'ceo', 'purchase_manager', 'finance_head', 'ea', 'md', 'accounts', 'manager', 'technician', 'viewer'])
export const statusEnum = pgEnum('status', ['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'])
export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'urgent'])
export const vehicleStatusEnum = pgEnum('vehicle_status', ['available', 'in_use', 'maintenance', 'retired'])
export const inventoryStatusEnum = pgEnum('inventory_status', ['in_stock', 'out_of_stock', 'low_stock', 'discontinued'])
export const purchaseOrderStageEnum = pgEnum('purchase_order_stage', ['initial_submission', 'vendor_information', 'ea_approval', 'md_approval', 'grn', 'accounts'])
export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', ['submitted', 'vendor_info_pending', 'awaiting_ea_approval', 'ea_approved', 'ea_denied', 'awaiting_md_approval', 'md_approved', 'md_denied', 'awaiting_grn', 'awaiting_accounts', 'completed', 'cancelled', 'on_hold', 'ea_on_hold', 'md_on_hold'])
export const financeOrderStageEnum = pgEnum('finance_order_stage', ['finance_head_submission', 'accounts_verification', 'ea_approval', 'md_approval', 'completed'])
export const financeOrderStatusEnum = pgEnum('finance_order_status', ['draft', 'awaiting_accounts_verification', 'accounts_verified', 'accounts_denied', 'accounts_on_hold', 'awaiting_ea_approval', 'ea_approved', 'ea_denied', 'ea_on_hold', 'awaiting_md_approval', 'md_approved', 'md_denied', 'md_on_hold', 'completed', 'cancelled'])
export const paymentModeEnum = pgEnum('payment_mode', ['cash', 'cheque', 'bank_transfer', 'upi', 'credit_card', 'other'])

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
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// Permissions table
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  description: text('description'),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Role permissions junction table
export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: roleEnum('role').notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

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

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userId],
    references: [users.id],
  }),
}))
