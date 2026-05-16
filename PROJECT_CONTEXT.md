# Project Context & Documentation

## Project Overview
This is a **Main Dashboard** application built with Next.js 14+ (App Router), TypeScript, and Tailwind CSS. It provides business analytics and reporting for automotive dealerships, specifically for the Kia brand, along with a comprehensive Purchase Orders Management System.

## Tech Stack
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Shadcn/ui
- **Database**: Supabase (PostgreSQL) with Drizzle ORM
- **Authentication**: Supabase Auth
- **State Management**: React Context API
- **Icons**: Lucide React
- **File Storage**: Supabase Storage

## Project Structure

```
Main_Dashboard/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── admin/               # Admin-related APIs
│   │   ├── auth/                # Authentication APIs
│   │   └── brands/              # Brand-specific APIs
│   │       └── kia/
│   │           └── business-excellence/
│   ├── admin/                    # Admin pages
│   │   ├── roles/               # Role management (NEW)
│   │   ├── settings/
│   │   └── users/
│   ├── auth/                     # Authentication pages
│   ├── brands/                   # Brand-specific pages
│   │   └── kia/
│   │       ├── business-excellence/
│   │       └── ro-billing/      # RO Billing Report pages
│   ├── dashboard/               # Main dashboard
│   ├── purchase-orders/         # Purchase Orders main page (NEW)
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Home page
├── components/                   # Reusable components
│   ├── analytics/               # Analytics components
│   ├── layout/                  # Layout components (Header, Sidebar)
│   ├── purchase-orders/         # Purchase Orders components (NEW)
│   │   ├── stage1-initial-submission.tsx
│   │   ├── stage2-vendor-information.tsx
│   │   ├── stage3-ea-approval.tsx
│   │   ├── stage3-md-approval.tsx
│   │   ├── stage4-grn.tsx
│   │   ├── stage5-accounts.tsx
│   │   ├── multiple-image-upload.tsx
│   │   └── workflow-timeline.tsx
│   ├── shared/                  # Shared components
│   └── ui/                      # Shadcn UI components
├── features/                     # Feature-specific components
│   ├── dashboard/
│   └── kia/
├── lib/                         # Utility libraries
│   ├── auth/                    # Auth helpers
│   ├── db/                      # Database schema & config
│   ├── hooks/                   # Custom React hooks
│   └── supabase/                # Supabase clients
├── context/                     # React Context providers
├── config/                      # Configuration files
├── scripts/                     # Database scripts
└── public/                      # Static assets
```

## Design System & Conventions

### Color Palette
- **Primary**: Teal (teal-500, teal-600, teal-700)
- **Secondary**: Slate (slate-50 to slate-900)
- **Accent Colors**:
  - Blue: Labour/Revenue metrics
  - Purple: Parts/Components
  - Emerald: Growth/Success indicators
  - Red: Negative growth/errors

### Typography
- **Headings**: 
  - Main sections: `text-xl font-semibold text-slate-800 tracking-tight`
  - Subsections: `text-lg font-black`
  - Small labels: `text-[9px] font-semibold text-slate-400 uppercase tracking-widest`
- **Body**: `text-sm text-slate-700`
- **Font Family**: System fonts (default Tailwind)

### Component Patterns

#### Section Headers
```tsx
<div className="flex items-center gap-4">
  <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center border border-slate-200 shadow-sm">
    <Icon className="h-5 w-5 text-slate-700" />
  </div>
  <div>
    <h2 className="text-xl font-semibold text-slate-800 tracking-tight">Title</h2>
    <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
      Subtitle
    </p>
  </div>
</div>
```

#### Cards
```tsx
<Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
  <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white p-5">
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-lg bg-[color]-50 flex items-center justify-center border border-[color]-100/50">
        <Icon className="h-4 w-4 text-[color]-600" />
      </div>
      <CardTitle className="text-xl font-black">Title</CardTitle>
    </div>
  </CardHeader>
  <CardContent className="p-0">
    {/* Content */}
  </CardContent>
</Card>
```

#### Buttons
- **Primary**: `bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg`
- **Secondary**: `bg-slate-100 text-slate-600 hover:bg-slate-200`
- **Shape**: `rounded-xl font-bold transition-all`

#### Tables
- **Header Row**: `bg-slate-100` with `text-sm font-bold text-slate-700`
- **Sub-header**: `bg-slate-50` with `text-xs font-semibold text-slate-600`
- **Body Rows**: `hover:bg-slate-50 transition-colors`
- **Borders**: `border-slate-200` for column separators
- **Cell Padding**: `px-4 py-3` or `px-6 py-4` for larger tables

### Icon Usage
- **Main Headers**: White background, dark icon (slate-700)
- **Card Headers**: Colored background (e.g., blue-50), colored icon (e.g., blue-600)
- **Size**: 
  - Main sections: `h-10 w-10` container, `h-5 w-5` icon
  - Card headers: `h-8 w-8` container, `h-4 w-4` icon

## Key Features

### 1. Business Excellence Dashboard
- **Location**: `app/brands/kia/business-excellence/`
- **Purpose**: Display and manage Excel sheet data for business metrics
- **Features**:
  - Upload Excel files (multiple sheets)
  - View data in paginated tables

### 3. Purchase Orders Management System (UPDATED - 2026-05-16)
- **Location**: `app/purchase-orders/`
- **Purpose**: Complete workflow management for purchase orders with role-based access
- **Status**: Production Ready
- **Last Updated**: 2026-05-16

#### Key Features:
- **5-Stage Sequential Workflow**: Initial Submission → Vendor Info → EA Approval → MD Approval → GRN → Accounts
- **8 Role-Based Access Levels**: Admin, Purchase Manager, EA, MD, Accounts, Manager, Technician, Viewer
- **Separate Approval Processes**: Independent EA and MD approval stages with mandatory denial remarks
- **Multiple Image Upload**: Each stage supports up to 10 images/PDFs with toggle visibility
- **Complete Audit Trail**: Workflow timeline tracks all actions, users, timestamps, and status changes
- **12 Status Transitions**: Comprehensive status tracking from submission to completion
- **Admin Override**: Admin role can access and modify any stage
- **Role Management Panel**: `/admin/roles` for assigning user roles

#### Workflow Stages:

**Stage 1: Initial Submission** (Manager/Technician/Viewer)
- Item details, department, quantity, estimate, special instructions
- Optional supporting documents with toggle visibility
- Next: Purchase Manager (Vendor Info)

**Stage 2: Vendor Information** (Purchase Manager)
- Vendor name entry (supports multiple vendors)
- Vendor quotation uploads
- Next: EA Approval

**Stage 3a: EA Approval** (Executive Assistant)
- Review all order details
- Approve or Deny with mandatory remarks for denial
- Next: MD Approval (if approved) or Back to Requester (if denied)

**Stage 3b: MD Approval** (Managing Director)
- Final approval with EA remarks visible
- Approve or Deny with mandatory remarks for denial
- Next: GRN (if approved) or Back to Requester (if denied)

**Stage 4: GRN** (Purchase Manager)
- GRN number and received quantity entry
- Warning if received quantity differs from ordered
- GRN document uploads
- Next: Accounts Department

**Stage 5: Accounts Processing** (Accounts Department)
- Invoice details (number, date, amount)
- Payment details (mode, date, reference)
- Warning if actual amount differs from estimate
- Payment document uploads
- Next: Completed ✅

#### Database Tables:
- **purchase_orders**: Main order records with all stage data
- **workflow_history**: Complete audit trail of all actions
- **purchase_order_approvals**: Approval tracking

#### API Endpoints:
- `POST /api/purchase-orders/workflow`: Handle stage transitions
- `GET /api/purchase-orders/workflow?orderId={id}`: Fetch order with history
- `GET /api/purchase-orders`: List all orders (role-filtered)
- `PATCH /api/admin/users`: Update user roles

#### Components:
- `stage1-initial-submission.tsx`: Initial request form
- `stage2-vendor-information.tsx`: Vendor info form
- `stage3-ea-approval.tsx`: EA approval interface
- `stage3-md-approval.tsx`: MD approval interface
- `stage4-grn.tsx`: GRN entry form
- `stage5-accounts.tsx`: Accounts processing form
- `multiple-image-upload.tsx`: Reusable image upload with toggle
- `workflow-timeline.tsx`: Visual audit trail component


### Purchase Orders Tables (NEW - 2026-05-16)

**purchase_orders**
- Main purchase order records with complete workflow data
- Columns: id, user_id, item_name, department, sub_department, quantity, estimated_cost, special_instructions, vendor_name, grn_number, received_quantity, invoice_number, invoice_date, actual_amount, payment_mode, payment_date, transaction_reference, accounts_remarks, current_stage, status, supporting_images (JSONB), vendor_images (JSONB), grn_images (JSONB), accounts_images (JSONB), ea_approved_at, ea_remarks, md_approved_at, md_remarks, completed_at, created_at, updated_at

**workflow_history**
- Complete audit trail for all workflow actions
- Columns: id, order_id, user_id, action, from_stage, to_stage, from_status, to_status, remarks, metadata (JSONB), created_at

**purchase_order_approvals**
- Approval tracking for EA and MD
- Columns: id, order_id, approver_id, approval_type, status, remarks, created_at

### Enums (Updated 2026-05-16)

**role** (8 values)
- admin, purchase_manager, ea, md, accounts, manager, technician, viewer

**purchase_order_stage** (6 values)
- initial_submission, vendor_information, ea_approval, md_approval, grn, accounts

**purchase_order_status** (12 values)
- submitted, vendor_info_pending, awaiting_ea_approval, ea_approved, ea_denied, awaiting_md_approval, md_approved, md_denied, awaiting_grn, awaiting_accounts, completed, cancelled

#### Status Flow:
1. `submitted` → 2. `vendor_info_pending` → 3. `awaiting_ea_approval` → 4. `ea_approved` / `ea_denied` → 5. `awaiting_md_approval` → 6. `md_approved` / `md_denied` → 7. `awaiting_grn` → 8. `awaiting_accounts` → 9. `completed`

  - Add/edit rows dynamically
  - Pin columns for better navigation
  - Sheet selection dropdown

### 2. RO Billing Report (Revenue Performance)
- **Location**: `app/brands/kia/ro-billing/`
- **Purpose**: Analyze revenue performance from RO Billing data
- **Features**:
  - Three tabbed views: Labour Revenue, Part Revenue, Growth Contribution
  - MTD/QTD/YTD metrics with CY vs LY comparison
  - Growth percentage calculations
  - Currency formatting (INR)
  - Only shows when "RO Billing Report March 25" sheet is selected

### 3. Authentication & Authorization
- **System**: Supabase Auth
- **Roles**: Admin, User
- **Access Control**: Brand-based permissions
- **Protected Routes**: Middleware-based route protection

## Data Flow

### Excel Upload Flow
1. User uploads Excel file via Business Excellence page
2. File parsed using `xlsx` library
3. Data sent to `/api/brands/kia/business-excellence` (POST)
4. Stored in Supabase database
5. Metadata saved with sheet name, headers, brand

### Data Retrieval Flow
1. Fetch sheet metadata: `GET /api/brands/kia/business-excellence?brand=kia`
2. Fetch sheet rows: `GET /api/brands/kia/business-excellence?sheetId={id}&page={page}&limit={limit}`
3. Display in paginated tables
4. Process data for analytics (Revenue Performance section)

## Database Schema

### Tables
- **users**: User authentication and profiles
- **settings**: Application settings
- **kia_business_excellence_sheets**: Sheet metadata
- **kia_business_excellence_rows**: Sheet row data

### Key Columns
- `brand`: Brand identifier (e.g., 'kia')
- `sheet_name`: Name of the Excel sheet
- `headers`: Array of column headers
- `data`: JSONB column storing row data

## API Conventions

### Endpoints
- **Pattern**: `/api/brands/{brand}/{feature}`
- **Methods**: GET, POST, PUT, DELETE
- **Response Format**: JSON
- **Error Handling**: Try-catch with appropriate HTTP status codes

### Query Parameters
- `brand`: Filter by brand
- `sheetId`: Specific sheet identifier
- `page`: Pagination page number
- `limit`: Items per page

## Common Utilities

### Currency Formatting
```typescript
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(value)
}
```

### Growth Percentage
```typescript
const formatGrowth = (value: number) => {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

const calculateGrowth = (cy: number, ly: number) => {
  return ly > 0 ? ((cy - ly) / ly) * 100 : 0
}
```

### Conditional Styling
```typescript
import { cn } from '@/lib/utils'

<div className={cn(
  "base-classes",
  condition && "conditional-classes"
)} />
```

## Development Guidelines

### File Naming
- **Components**: PascalCase (e.g., `DataTable.tsx`)
- **Pages**: kebab-case (e.g., `ro-billing/page.tsx`)
- **Utilities**: camelCase (e.g., `formatCurrency.ts`)

### Component Structure
1. Imports
2. Type definitions/interfaces
3. Component function
4. Helper functions (if small)
5. Export

### State Management
- **Local State**: `useState` for component-specific state
- **Server State**: Direct API calls with loading states
- **Global State**: React Context (e.g., `SidebarContext`)

### Error Handling
- Try-catch blocks for async operations
- User-friendly error messages
- Console logging for debugging
- Loading states for async operations

## Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Testing Approach
- Manual testing in development
- Check responsive design
- Verify data calculations
- Test error scenarios

## Deployment
- Platform: Vercel (recommended for Next.js)
- Build command: `npm run build`
- Environment variables configured in platform

## Common Tasks

### Adding a New Table
1. Create interface for data structure
2. Fetch data from API
3. Use Card component with proper header styling
4. Build table with consistent classes
5. Add loading and error states

### Adding a New Page
1. Create folder in `app/brands/{brand}/`
2. Add `page.tsx` with metadata export
3. Implement component with proper layout
4. Add API route if needed
5. Update navigation/sidebar if required

### Modifying Calculations
1. Locate data processing function (e.g., `processRevenueData`)
2. Update calculation logic
3. Ensure proper null/zero handling
4. Test with various data scenarios
5. Update TypeScript types if needed

## AI Assistant Guidelines

When working with this project:
1. **Always** match existing design patterns (colors, spacing, typography)
2. **Use** Tailwind utility classes, avoid custom CSS
3. **Follow** the component structure shown in examples
4. **Include** proper TypeScript types
5. **Add** loading and error states
6. **Maintain** consistent icon usage patterns
7. **Test** calculations with edge cases (zero, negative, null values)
8. **Keep** code DRY - extract reusable components
9. **Use** existing utilities (formatCurrency, formatGrowth, cn)
10. **Document** complex logic with comments

## Quick Reference

### Import Paths
```typescript
// Components
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Utilities
import { cn } from '@/lib/utils'

// Icons
import { TrendingUp, DollarSign } from 'lucide-react'

// Hooks
import { useState, useEffect, useCallback } from 'react'
```

### Common Patterns
- **Conditional Rendering**: `{condition && <Component />}`
- **Loading State**: `{loading ? <Loader /> : <Content />}`
- **Empty State**: `{!data ? <EmptyMessage /> : <DataDisplay />}`
- **Tab System**: State-based view switching with buttons

## Recent Bug Fixes & Issues

### Issue: MTD Target Showing Same Value as Month Target (Fixed: 2026-05-14)

**Problem Description:**
In both the Revenue Performance section and Trendwise analysis, the "Month Target" and "MTD Target" KPIs were displaying identical values (e.g., both showing ₹12.01 L), when they should have been different.

**Root Cause:**
The `currentDay` variable was being calculated as the maximum date present in the dataset rather than using the actual current date:
```typescript
const currentDay = currentMonthDates.length > 0
  ? Math.max(...currentMonthDates.map(d => d.getDate()))
  : new Date().getDate()
```

When the dataset contained entries for the entire month (e.g., up to day 31), this caused:
- `currentDay` = 31 (from data)
- `daysInMonth` = 31
- `mtdTarget = monthTarget * (31/31) = monthTarget`
- Result: Both KPIs showed the same value

**Files Affected:**
1. `features/kia/business-excellence-page.tsx` (Line 1278-1284)
   - Trendwise section KPI calculations
   - Also fixed undefined variable `baseTarget` → `monthTarget` (Line 1349)

2. `app/brands/kia/ro-billing/page.tsx` (Line 159-165)
   - Revenue Performance section KPI calculations

**Solution Implemented:**
Changed the `currentDay` calculation to use the actual current date when viewing the current month:
```typescript
// Use actual current date, not max date from data
const today = new Date()
const currentDay = (today.getFullYear() === currentYear && today.getMonth() === currentMonth)
  ? today.getDate()
  : (currentMonthDates.length > 0
      ? Math.max(...currentMonthDates.map(d => d.getDate()))
      : new Date().getDate())
```

**KPI Calculation Logic:**
- **Month Target**: Full monthly target based on YTD average with 10% growth
  - Formula: `(ytdTotal / monthsElapsed) * 1.1`
- **MTD Target**: Proportional target based on actual days elapsed
  - Formula: `monthTarget * (currentDay / daysInMonth)`
- **Ach Till Date**: Actual achievement from data up to current day
- **Shortfall T.D**: Difference between MTD target and achievement
- **Monthly Shortfall**: Difference between month target and projected closing
- **Projected Closing**: Projected month-end value based on current pace
- **Asking Rate**: Required daily rate to meet target in remaining days

**Testing Notes:**
- Month Target and MTD Target now show different values correctly
- MTD Target is proportional to days elapsed in the current month
- Historical months still use max date from data (correct behavior)
- Both Revenue Performance and Trendwise sections fixed

**Related TypeScript Error Fixed:**
- Line 1349 in `business-excellence-page.tsx`: Changed undefined `baseTarget` to `monthTarget`

---

### Issue: TypeScript Error and Formatting Issues (Fixed: 2026-05-14)

**Problem Description:**
Multiple issues were identified in the Business Excellence page:
1. TypeScript error: `Cannot find name 'filteredData'` (Error 2304)
2. Value formatting: 6-figure values displayed as "500K" instead of "5.0L"
3. Flat target line: Target reference line was hardcoded to y=35

**Root Causes:**

1. **Undefined Variable (`filteredData`):**
   - Lines 1208, 1210, 1217 in `business-excellence-page.tsx` referenced `filteredData`
   - Variable was never defined in the `trendData` useMemo scope
   - Should have been using `data` parameter instead

2. **Incorrect Value Formatting:**
   - `formatValue` function (line 819) always showed per-vehicle values in thousands (K)
   - Indian numbering convention requires values ≥100,000 to be shown in Lakhs (L)
   - Example: 500,000 was displayed as "₹500.00 K" instead of "₹5.0 L"

3. **Hardcoded Target Line:**
   - ReferenceLine component (line 1892) had hardcoded `y={35}`
   - Target should be dynamic based on calculated daily target
   - Caused flat horizontal line that didn't match actual data scale

**Files Affected:**
- `features/kia/business-excellence-page.tsx`
  - Lines 1208-1217: Variable reference fix
  - Lines 819-828: Value formatting logic
  - Lines 1513-1540: Daily target calculation
  - Line 1892: ReferenceLine update

**Solutions Implemented:**

1. **Fixed Undefined Variable:**
```typescript
// Before
console.log('🔍 DEBUG - First 3 rows of filtered data:', filteredData.slice(0, 3))
filteredData.forEach((row, index) => { ... })

// After
console.log('🔍 DEBUG - First 3 rows of filtered data:', data.slice(0, 3))
data.forEach((row, index) => { ... })
```

2. **Updated Value Formatting:**
```typescript

---

## Purchase Orders System - Complete Documentation (2026-05-16)

### Database Schema Details

#### Complete purchase_orders Table Structure
```
- id: uuid (Primary Key)
- orderNumber: text (Unique, Format: PO-YYYYMMDD-XXX)
- currentStage: enum (6 values)
- status: enum (12 values)

Stage 1 Fields:
- reqType, department, subDepartment, specifyOther
- requestedBy, specialInstructions, quantityRequired, estimateIfAny
- imagesRequired (boolean), supportingImages (jsonb array)

Stage 2 Fields:
- vendorName, vendorImages (jsonb array)
- quotation1Url, quotation2Url, quotation3Url

Stage 3 Fields (Approvals):
- eaApprovalStatus, eaApprovedBy, eaApprovedAt, eaApprovalRemarks
- mdApprovalStatus, mdApprovedBy, mdApprovedAt, mdApprovalRemarks

Stage 4 Fields (GRN):
- receivedDateTime, handoverTo, remarksIfAny, amount
- grnImages (jsonb array)
- invoice1Url, invoice2Url, invoice3Url, invoice4Url

Stage 5 Fields (Accounts):
- actualAmount, paymentStatus, paymentMode, accountRemarks
- accountsImages (jsonb array), paymentScreenshotUrl

Metadata:
- createdBy, assignedTo, brand, workflowLocked
- createdAt, updatedAt, completedAt, deletedAt
```

### Recent Enhancements (2026-05-16)

#### 1. MD Grid View with Bulk Operations
- Custom grid layout for MD users
- Individual approve/deny buttons per card
- Bulk approve/deny all functionality
- Single API call for bulk operations (`/api/purchase-orders/bulk-approve`)
- Compact card design with teal color scheme
- Hidden header section for cleaner interface

#### 2. Loading States & UX Improvements
- Loading overlay on card click
- Spinner during bulk operations
- Immediate visual feedback
- Prevents double-clicks and frozen UI feeling

#### 3. Completed Orders Management
- "Show Completed" toggle button
- Separate view for completed orders
- Read-only completion summary with:
  - Payment status and mode
  - Final amount
  - Completion timestamp
  - Remarks
- Green success theme
- Cannot be modified after completion

#### 4. Form Field Corrections
- Stage 1: Removed image upload (not required)
- Stage 4 (GRN): Updated fields to match requirements
  - Received Date & Time (separate pickers)
  - Handover To
  - Remarks If Any
  - Amount
  - GRN Images
- Stage 5 (Accounts): Updated fields and options
  - Status: "No gap payment released" / "Gap observed need clarification"
  - Payment Mode: "Online transfer" (bank_transfer) / "Cash" / "Credit card" / "Cheque"
  - Remarks
  - Payment Screenshot (single file)

#### 5. Image Gallery Enhancements
- Glassmorphism overlay with "View Image" text
- Eye icon on hover
- Fullscreen image dialog
- Proper accessibility (VisuallyHidden DialogTitle)

#### 6. Data Handling Improvements
- Support for both snake_case (database) and camelCase (TypeScript)
- Proper enum value mapping (bank_transfer vs online_transfer)
- White background for dropdowns
- Currency and date formatting

### API Endpoints Summary

```
GET    /api/purchase-orders              # List/Get orders
POST   /api/purchase-orders              # Create order
PUT    /api/purchase-orders              # Update order
DELETE /api/purchase-orders              # Soft delete
POST   /api/purchase-orders/workflow     # Stage transitions
GET    /api/purchase-orders/workflow     # Get order with history
POST   /api/purchase-orders/upload       # File uploads
POST   /api/purchase-orders/bulk-approve # Bulk operations (NEW)
```

### Component Architecture

```
app/purchase-orders/page.tsx (Main orchestrator)
├── Role detection & view switching
├── MD Grid View (for MD users)
│   ├── Compact cards
│   ├── Individual approve/deny
│   └── Bulk operations
├── List View (for other users)
│   ├── Professional cards
│   ├── Show Completed toggle
│   └── Loading states
└── Stage Components (conditional rendering)
    ├── Stage1InitialSubmission
    ├── Stage2VendorInformation
    ├── Stage3EAApproval
    ├── Stage3MDApproval
    ├── Stage4GRN
    ├── Stage5Accounts
    └── Completed Summary (read-only)

Supporting Components:
├── ImageGallery (glassmorphism, fullscreen)
├── MultipleImageUpload (drag-drop, preview)
└── WorkflowTimeline (audit trail)
```

### Status Badge Colors

```typescript
submitted: 'bg-blue-500 text-white'
vendor_info_pending: 'bg-yellow-500 text-white'
awaiting_ea_approval: 'bg-purple-500 text-white'
awaiting_md_approval: 'bg-indigo-500 text-white'
ea_denied: 'bg-red-500 text-white'
md_denied: 'bg-red-500 text-white'
awaiting_grn: 'bg-teal-500 text-white'
awaiting_accounts: 'bg-emerald-500 text-white'
completed: 'bg-green-500 text-white'
```

## Purchase Orders System - Recent Implementation (2026-05-16)

### Implementation Summary

**Status**: 95% Complete - Ready for Testing

**What Was Built** (in ~10 minutes):
1. ✅ Complete database schema redesign with 3 new tables
2. ✅ All 6 stage components (Stage 1-5 + Timeline)
3. ✅ Workflow API with role-based access control
4. ✅ Main orchestration page with dynamic routing
5. ✅ Admin role management panel
6. ✅ Multiple image upload component with toggle
7. ✅ Workflow timeline/audit trail component
8. ✅ Comprehensive documentation

**Files Created** (15 new files):
- **Components** (9): All stage forms, image upload, timeline in `components/purchase-orders/`
- **Pages** (2): Main page (`app/purchase-orders/page.tsx`), Admin roles (`app/admin/roles/page.tsx`)
- **API** (1): Workflow endpoint (`app/api/purchase-orders/workflow/route.ts`)
- **Database** (1): Migration script (`scripts/update-purchase-orders-workflow.sql`)
- **Schema** (1): Updated `lib/db/schema.ts` with new tables and enums
- **Documentation** (1): Complete guide (`PURCHASE_ORDERS_COMPLETE.md`)

### Database Migration

**File**: `scripts/update-purchase-orders-workflow.sql`

**Key Features**:
- Dynamic policy dropping using pg_policies query (prevents enum dependency errors)
- Updates 3 enums: role (8 values), purchase_order_stage (6 values), purchase_order_status (12 values)
- Creates 2 new tables: workflow_history, purchase_order_approvals
- Adds JSONB columns for images at each stage
- Implements comprehensive RLS policies
- Re-enables RLS after migration

**Migration Issues Fixed**:
- **Problem**: Policies depending on enum columns blocked ALTER TYPE operations
- **Solution**: Implemented dynamic policy dropping that queries pg_policies and drops ALL policies before enum changes
- **Result**: Migration now handles any policy dependencies automatically

**To Run**:
```bash
psql -h your-db-host -U postgres -d postgres -f scripts/update-purchase-orders-workflow.sql
```

### Key Technical Decisions

1. **Single Workflow API**: All stage transitions handled by one endpoint (`/api/purchase-orders/workflow`) for consistency
2. **Role-Based Routing**: Main page automatically shows correct stage based on user role and order stage
3. **Mandatory Denial Remarks**: Enforced at form validation level, not just database constraint
4. **Separate EA/MD Components**: Two distinct approval components for clarity and maintainability
5. **Image Toggle**: Optional visibility for each stage's images to reduce clutter
6. **Automatic Audit Logging**: Every action automatically logged to workflow_history table
7. **Admin Override**: Admin role can access and modify any stage for testing/troubleshooting

### Workflow Color Coding

- **Blue** (teal-500): Purchase Manager stages (Vendor Info, GRN)
- **Purple** (purple-500): EA Approval
- **Indigo** (indigo-500): MD Approval
- **Teal** (teal-500): GRN stage
- **Emerald** (emerald-500): Accounts stage
- **Green**: Approved/Success states
- **Red**: Denied/Error states
- **Amber**: Warnings (quantity/amount differences)

### Pending Tasks

**Critical** (Must do before production):
1. ⏳ Run database migration script
2. ⏳ Assign roles to users via `/admin/roles`
3. ⏳ Test complete workflow from submission to completion
4. ⏳ Verify role-based access control works correctly
5. ⏳ Test file uploads at each stage
6. ⏳ Test approval/denial flows with mandatory remarks

**Optional** (Future enhancements):
- Email notifications for stage transitions
- Search/filter functionality on main page
- Export to PDF/Excel
- Dashboard analytics for purchase orders
- Bulk operations support

### Testing Checklist

- [ ] Create order as Manager/Technician (Stage 1)
- [ ] Add vendor info as Purchase Manager (Stage 2)
- [ ] Approve as EA (Stage 3a)
- [ ] Approve as MD (Stage 3b)
- [ ] Add GRN as Purchase Manager (Stage 4)
- [ ] Complete as Accounts (Stage 5)
- [ ] Test denial flow with mandatory remarks
- [ ] Test role-based access restrictions
- [ ] Test image upload at each stage
- [ ] Verify workflow timeline shows all actions
- [ ] Test admin override capabilities

### Related Documentation

- **Complete Implementation Guide**: `PURCHASE_ORDERS_COMPLETE.md`
- **Database Migration Script**: `scripts/update-purchase-orders-workflow.sql`
- **TypeScript Schema**: `lib/db/schema.ts`

const formatValue = (val: number, trend: string) => {
  if (trend === 'Labour Per Vehicle Trend' || trend === 'Parts Per Vehicle Trend') {
    // Show in Lakhs if value is 6 figures or more (100,000+)
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(1)} L`
    } else {
      return `₹${(val / 1000).toFixed(2)} K`
    }
  } else if (trend === 'Labour Trend' || trend === 'Parts Trend') {
    return `₹${(val / 100000).toFixed(2)} L`
  }
  return Math.floor(val).toLocaleString()
}
```

3. **Dynamic Target Line Calculation:**
```typescript
// Calculate daily target for the trend chart reference line
const dailyTarget = useMemo(() => {
  if (!trendData || trendData.length === 0) return 0
  
  // Extract month target from KPI stats
  const monthTargetKpi = kpiStats.find(kpi => kpi.label === 'Month Target')
  if (!monthTargetKpi) return 0
  
  // Parse formatted value (handles both "L" and "K" units)
  const valueStr = monthTargetKpi.value.toString()
  const numMatch = valueStr.match(/[\d.]+/)
  if (!numMatch) return 0
  
  let monthTargetValue = parseFloat(numMatch[0])
  
  // Convert back to actual value based on unit
  if (valueStr.includes(' L')) {
    monthTargetValue *= 100000 // Lakhs to actual value
  } else if (valueStr.includes(' K')) {
    monthTargetValue *= 1000 // Thousands to actual value
  }
  
  // Calculate daily target
  const daysInMonth = trendData.length
  return daysInMonth > 0 ? monthTargetValue / daysInMonth : 0
}, [kpiStats, trendData])

// Updated ReferenceLine
<ReferenceLine y={dailyTarget} stroke="#f43f5e" strokeDasharray="5 5" ... />
```

**Value Formatting Examples:**
- 500,000 → ₹5.0 L (was ₹500.00 K)
- 150,000 → ₹1.5 L (was ₹150.00 K)
- 50,000 → ₹50.00 K (unchanged, below threshold)
- 5,000 → ₹5.00 K (unchanged, below threshold)

**Target Line Behavior:**
- Dynamically calculates based on Month Target ÷ Days in Month
- Example: Month Target = ₹5.0 L (500,000), 30 days → Daily Target = 16,666.67
- Target line now properly reflects business targets at correct scale
- Adapts to different trend types and data ranges

**Testing Notes:**
- TypeScript compilation now succeeds without errors
- Values display correctly in Indian numbering format (Lakhs/Thousands)
- Target line shows meaningful reference aligned with data scale
- All three issues resolved in single update

---

**Last Updated**: 2026-05-14
**Version**: 1.2
**Maintained By**: Development Team