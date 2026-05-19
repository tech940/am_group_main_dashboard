# Purchase Orders Enhancements - Implementation Guide

**Date**: 2026-05-18  
**Status**: Phase 1 Complete - Ready for Integration  
**Migration**: ✅ Completed

---

## 🎉 What's Been Completed

### 1. Database Layer ✅

#### Files Created:
- `scripts/add-purchase-order-enhancements.sql` - Migration script (EXECUTED)
- `lib/db/schema.ts` - Updated with new tables and fields

#### New Database Features:
- ✅ `user_preferences` table for storing UI preferences
- ✅ Added `on_hold`, `ea_on_hold`, `md_on_hold` status enums
- ✅ Added `rejected_at` timestamp field
- ✅ Added hold tracking: `ea_held_at`, `ea_held_by`, `md_held_at`, `md_held_by`, `hold_remarks`
- ✅ RLS policies for user preferences
- ✅ Indexes for performance

### 2. API Layer ✅

#### Files Created:
- `app/api/user-preferences/route.ts` - User preferences CRUD API

#### Files Modified:
- `app/api/purchase-orders/workflow/route.ts` - Added HOLD action support
- `lib/purchase-orders/access.ts` - Updated status arrays and visibility filters
- `lib/db/index.ts` - Fixed connection pooling (ECONNRESET fix)

#### API Features:
- ✅ GET/POST/DELETE endpoints for user preferences
- ✅ HOLD action for EA and MD approval stages
- ✅ Optional remarks for Deny and Hold actions
- ✅ `rejected_at` timestamp on denial
- ✅ Updated access control for hold statuses

### 3. React Hooks & Utilities ✅

#### Files Created:
- `lib/hooks/use-user-preferences.ts` - Custom hook for preferences management
  - Generic `useUserPreferences<T>` hook
  - Specialized `usePurchaseOrdersViewPreference` hook

### 4. UI Components ✅

#### Files Created:
- `components/purchase-orders/remarks-dialog.tsx` - Reusable remarks dialog
- `components/purchase-orders/md-table-view.tsx` - Comprehensive MD table view
- `components/ui/checkbox.tsx` - Checkbox component

#### MD Table View Features:
- ✅ Dynamic column rendering (hides null columns)
- ✅ Sticky right-side action column (Approve/Deny/Hold buttons)
- ✅ Row-level action buttons with loading states
- ✅ Checkbox selection for rows
- ✅ "Select All" functionality
- ✅ Bulk approve selected orders
- ✅ Sticky/pin header toggle
- ✅ Column hide/show functionality
- ✅ Hide icon on each column header
- ✅ "Restore Columns" button
- ✅ Persists preferences per user in database
- ✅ Remarks dialog for all actions (optional remarks)

---

## 📋 Integration Steps

### Step 1: Update Main Purchase Orders Page

You need to integrate the new MD Table View into your main purchase orders page. Here's how:

```typescript
// app/purchase-orders/page.tsx

import { MDTableView } from '@/components/purchase-orders/md-table-view'
import { usePurchaseOrdersViewPreference } from '@/lib/hooks/use-user-preferences'

// Inside your component:
const { value: preferences, savePreference } = usePurchaseOrdersViewPreference()
const userRole = // ... get user role

// Add view mode toggle
const toggleViewMode = async () => {
  await savePreference({
    ...preferences,
    viewMode: preferences.viewMode === 'table' ? 'card' : 'table',
  })
}

// Render based on role and view mode
{userRole === 'md' && (
  <>
    {/* View Mode Toggle Button */}
    <Button onClick={toggleViewMode}>
      {preferences.viewMode === 'table' ? 'Card View' : 'Table View'}
    </Button>

    {/* Render appropriate view */}
    {preferences.viewMode === 'table' ? (
      <MDTableView
        orders={orders}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onHold={handleHold}
        onBulkApprove={handleBulkApprove}
        onOrderClick={handleOrderClick}
        loading={loading}
      />
    ) : (
      <MDGridView {...existingProps} />
    )}
  </>
)}
```

### Step 2: Implement Handler Functions

Add these handler functions to your purchase orders page:

```typescript
const handleApprove = async (orderId: string, remarks?: string) => {
  const response = await fetch('/api/purchase-orders/workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      action: 'approve',
      stage: 'md_approval',
      data: { remarks },
    }),
  })
  
  if (response.ok) {
    // Refresh orders
    await fetchOrders()
  }
}

const handleDeny = async (orderId: string, remarks?: string) => {
  const response = await fetch('/api/purchase-orders/workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      action: 'deny',
      stage: 'md_approval',
      data: { remarks },
    }),
  })
  
  if (response.ok) {
    await fetchOrders()
  }
}

const handleHold = async (orderId: string, remarks?: string) => {
  const response = await fetch('/api/purchase-orders/workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      action: 'hold',
      stage: 'md_approval',
      data: { remarks },
    }),
  })
  
  if (response.ok) {
    await fetchOrders()
  }
}

const handleBulkApprove = async (orderIds: string[]) => {
  const response = await fetch('/api/purchase-orders/bulk-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderIds,
      action: 'approve',
      stage: 'md_approval',
    }),
  })
  
  if (response.ok) {
    await fetchOrders()
  }
}
```

### Step 3: Update Bulk Approve API

Modify `app/api/purchase-orders/bulk-approve/route.ts` to handle selected orders:

```typescript
// The API should accept an array of orderIds
const { orderIds, action, stage } = await request.json()

// Process only the selected orders
for (const orderId of orderIds) {
  // ... existing approval logic
}
```

---

## 🎯 What Still Needs to Be Done

### EA Dashboard Enhancements (Next Phase)

1. **Rejected Orders Section**
   - Create separate tab for rejected orders
   - Implement re-approval flow
   - Update workflow to move re-approved orders to MD stage

2. **Status Filters**
   - Add filter buttons: All, Pending, Rejected, Hold, Completed
   - Implement filter logic (All excludes Rejected)
   - Add filter UI components

3. **HOLD Buttons for EA**
   - Add HOLD button to EA approval interface
   - Use the same RemarksDialog component

### Analytics & Reporting (Future Phase)

1. **Date Range Filters**
   - Add date pickers for completed orders
   - Calculate total spend for selected range
   - Display spending analytics

2. **Export Functionality**
   - Export to Excel/PDF
   - Include filtered data

---

## 🔧 Testing Checklist

### MD Table View
- [ ] Table displays correctly with dynamic columns
- [ ] Null columns are hidden automatically
- [ ] Sticky header toggle works
- [ ] Column hide/show icons appear on hover
- [ ] Hidden columns persist after page reload
- [ ] Restore columns button works
- [ ] Checkbox selection works
- [ ] Select all checkbox works
- [ ] Bulk approve processes selected orders
- [ ] Individual action buttons work (Approve/Deny/Hold)
- [ ] Remarks dialog opens and submits correctly
- [ ] Loading states show during actions
- [ ] Sticky right-side actions column stays visible during scroll

### Workflow API
- [ ] HOLD action creates correct status
- [ ] Hold timestamps are recorded
- [ ] Remarks are optional for deny/hold
- [ ] rejected_at timestamp is set on denial

### User Preferences
- [ ] Preferences save to database
- [ ] Preferences load on page refresh
- [ ] Multiple users have separate preferences

---

## 📊 Database Connection Fix

The ECONNRESET errors have been fixed by:
- Increasing connection pool from 3 to 10
- Extending idle timeout from 20s to 60s
- Adding connection keep-alive
- Adding connection recycling (30 min lifetime)

**This should resolve the database connection issues you were experiencing.**

---

## 🚀 Performance Optimizations

The table view includes:
- Memoized column calculations
- Optimized re-renders with useCallback
- Efficient state management
- Lazy loading ready (can be added)
- Virtual scrolling ready (can be added for 1000+ rows)

---

## 📝 Notes

1. **Default View Mode**: Table view is set as default for MD users
2. **Remarks**: All remarks are now optional for deny/hold actions
3. **Status Colors**: Consistent color scheme across all views
4. **Responsive**: Table is horizontally scrollable on mobile
5. **Accessibility**: Proper ARIA labels and keyboard navigation

---

## 🎨 UI/UX Features

- **Smooth Transitions**: All state changes have smooth animations
- **Loading States**: Clear feedback during async operations
- **Error Handling**: Graceful error messages
- **Confirmation Dialogs**: Prevent accidental actions
- **Tooltips**: Helpful hints on hover
- **Status Badges**: Color-coded for quick identification

---

## 📞 Support

If you encounter any issues:
1. Check browser console for errors
2. Verify database migration completed successfully
3. Ensure all environment variables are set
4. Check network tab for API errors

---

**Ready for Production**: Yes, after integration testing  
**Breaking Changes**: None  
**Migration Required**: ✅ Already completed