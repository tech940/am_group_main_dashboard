# Purchase Orders System Setup Guide

This guide will help you set up the Purchase Orders system in your application.

## Prerequisites

- Supabase project with authentication enabled
- Database access (SQL Editor in Supabase Dashboard)
- Storage access (Storage section in Supabase Dashboard)

## Step 1: Create Database Table and Functions

Run the SQL script to create the purchase orders table, enums, and functions:

```bash
# Navigate to Supabase Dashboard > SQL Editor
# Copy and paste the contents of scripts/create-purchase-orders-table.sql
# Click "Run" to execute
```

Or run it directly from your terminal if you have Supabase CLI:

```bash
supabase db push
```

The script will create:
- `purchase_order_stage` enum
- `purchase_order_status` enum  
- `payment_mode` enum
- `purchase_orders` table with all required columns
- `generate_order_number()` function for auto-generating order numbers (PO-YYYYMMDD-XXX)
- `update_purchase_orders_updated_at()` trigger function
- Indexes for better query performance

## Step 2: Create Storage Bucket

1. Go to Supabase Dashboard > Storage
2. Click "Create a new bucket"
3. Name it: `purchase-orders`
4. Set it as **Public** (so uploaded files can be accessed via public URLs)
5. Click "Create bucket"

### Configure Bucket Policies

After creating the bucket, set up the following policies:

#### Policy 1: Allow authenticated users to upload files
```sql
CREATE POLICY "Allow authenticated users to upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'purchase-orders');
```

#### Policy 2: Allow authenticated users to read files
```sql
CREATE POLICY "Allow authenticated users to read files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'purchase-orders');
```

#### Policy 3: Allow authenticated users to delete their own files
```sql
CREATE POLICY "Allow authenticated users to delete files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'purchase-orders');
```

## Step 3: Verify Setup

### Test Database Connection

1. Navigate to `/purchase-orders` in your application
2. Try creating a new purchase order
3. Fill in the required fields and submit
4. Check if the order appears in "My Orders" tab

### Test File Upload

1. Create a new purchase order
2. Upload files in Stage 2 (Vendor Information) or Stage 3 (GRN)
3. Submit the form
4. Verify files are uploaded to Supabase Storage:
   - Go to Supabase Dashboard > Storage > purchase-orders
   - Check for folders: `quotations/`, `invoices/`, `payments/`
   - Verify files are present with correct naming format

## Step 4: Configure User Roles

The Purchase Orders system uses role-based access:

- **Admin/Manager**: Can approve at management level
- **EA (Executive Assistant)**: Can approve at EA level
- **Other roles**: Can create and view their own orders

To set user roles, update the `users` table:

```sql
UPDATE users 
SET role = 'admin' 
WHERE email = 'admin@example.com';

UPDATE users 
SET role = 'manager' 
WHERE email = 'manager@example.com';
```

## Troubleshooting

### Error: "Failed to generate order number"

**Solution**: The `generate_order_number()` function might not exist. Re-run the SQL script from Step 1.

### Error: "Failed to upload file"

**Solutions**:
1. Verify the `purchase-orders` bucket exists in Supabase Storage
2. Check bucket policies are correctly set
3. Ensure the bucket is set to **Public**
4. Verify file size is under 10MB limit

### Error: "Unauthorized" when creating orders

**Solution**: Ensure the user is authenticated and has a record in the `users` table with a valid `supabase_id`.

### Files not appearing in Storage

**Solutions**:
1. Check browser console for upload errors
2. Verify network requests to `/api/purchase-orders/upload`
3. Check Supabase Storage logs in the dashboard
4. Ensure bucket policies allow INSERT operations

## File Organization

Files are organized in the storage bucket as follows:

```
purchase-orders/
├── quotations/
│   └── {orderId}_{timestamp}_{random}.{ext}
├── invoices/
│   └── {orderId}_{timestamp}_{random}.{ext}
└── payments/
    └── {orderId}_{timestamp}_{random}.{ext}
```

## Features

### Multi-Stage Form
- **Stage 1**: Order Request (Department, Quantity, Instructions)
- **Stage 2**: Vendor Information (Vendor name, Quotations)
- **Stage 3**: GRN (Received date/time, Amount, Invoices)
- **Stage 4**: Account Details (Payment status, Mode, Screenshot)

### Approval Workflow
1. User creates purchase order → Status: `pending_ea_approval`
2. EA approves → Status: `pending_management_approval`
3. Management approves → Status: `approved`
4. Either can reject → Status: `rejected`

### Order Number Format
- Format: `PO-YYYYMMDD-XXX`
- Example: `PO-20260516-001`
- Auto-increments daily (resets to 001 each day)

## API Endpoints

- `GET /api/purchase-orders` - List all orders
- `GET /api/purchase-orders?id={id}` - Get single order
- `POST /api/purchase-orders` - Create new order
- `PUT /api/purchase-orders` - Update order
- `DELETE /api/purchase-orders?id={id}` - Soft delete order
- `POST /api/purchase-orders/approve` - Approve/reject order
- `POST /api/purchase-orders/upload` - Upload file

## Security Notes

1. All API endpoints require authentication
2. Users can only see orders they created (unless admin/manager)
3. File uploads are validated for size (max 10MB) and type
4. Soft delete is used (deleted_at timestamp) to maintain audit trail
5. All actions are logged with timestamps and user IDs

## Support

For issues or questions, refer to:
- Main documentation: `PROJECT_CONTEXT.md`
- Database schema: `lib/db/schema.ts`
- SQL migration: `scripts/create-purchase-orders-table.sql`

---

Made with Bob