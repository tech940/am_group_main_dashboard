import { pgTable, uuid, text, timestamp, boolean, integer, decimal, jsonb, pgEnum } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Enums
export const roleEnum = pgEnum('role', ['admin', 'manager', 'technician', 'viewer'])
export const statusEnum = pgEnum('status', ['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'])
export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'urgent'])
export const vehicleStatusEnum = pgEnum('vehicle_status', ['available', 'in_use', 'maintenance', 'retired'])
export const inventoryStatusEnum = pgEnum('inventory_status', ['in_stock', 'out_of_stock', 'low_stock', 'discontinued'])

// Users table (extends Supabase auth.users)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  supabaseId: text('supabase_id').unique().notNull(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  role: roleEnum('role').default('viewer').notNull(),
  department: text('department'),
  phoneNumber: text('phone_number'),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
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
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  readAt: timestamp('read_at'),
})

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

// Business Excellence Data table
export const businessExcellenceData = pgTable('business_excellence_am_kia_new', {
  id: uuid('id').primaryKey().defaultRandom(),
  brand: text('brand').notNull(), // 'kia', 'tata', etc.
  sheetName: text('sheet_name').notNull(),
  headers: jsonb('headers').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
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
