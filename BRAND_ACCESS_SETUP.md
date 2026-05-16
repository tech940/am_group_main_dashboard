# Brand-Based Access Control Setup Guide

## Database Migration

### Step 1: Add Brand Column to Database

Run this SQL command in your Supabase SQL Editor or database client:

```sql
-- Add brand column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN users.brand IS 'Brand/Branch assignment: kia, tata, hyundai, honda, ktm, triumph, bajaj, mg';
```

Or run the migration file:
```bash
# If using Supabase CLI
supabase db execute -f scripts/add-brand-column.sql

# Or manually execute the SQL in Supabase Dashboard > SQL Editor
```

## Test Credentials

### Admin User (Full Access)
- **Email**: `admin@amgroup.com`
- **Password**: `Admin@123`
- **Role**: Admin
- **Brand**: None (can access all brands)
- **Access**: All brands + Admin Panel

### Kia Brand User
- **Email**: `kia.user@amgroup.com`
- **Password**: `Kia@123`
- **Role**: Manager
- **Brand**: kia
- **Access**: Only AM Kia brand

### Tata Brand User
- **Email**: `tata.user@amgroup.com`
- **Password**: `Tata@123`
- **Role**: Manager
- **Brand**: tata
- **Access**: Only AM Tata brand

## Creating Test Users

### Option 1: Using Admin Panel UI
1. Login as admin
2. Go to Admin Panel > User Management
3. Click "Create New User"
4. Fill in details and select brand from dropdown
5. Click "Create User"

### Option 2: Using SQL (Quick Setup)

```sql
-- Note: You'll need to create Supabase auth users first, then link them
-- This is a simplified example - actual implementation requires Supabase auth setup

-- Example: Update existing user to assign brand
UPDATE users 
SET brand = 'kia' 
WHERE email = 'kia.user@amgroup.com';

UPDATE users 
SET brand = 'tata' 
WHERE email = 'tata.user@amgroup.com';

-- Admin users should have brand = NULL to access all brands
UPDATE users 
SET brand = NULL 
WHERE role = 'admin';
```

## How It Works

### For Admin Users (role = 'admin')
- `brand` field can be NULL or any value
- Can access ALL brands in sidebar
- Can access Admin Panel
- No restrictions

### For Non-Admin Users
- Must have a `brand` value assigned
- Can ONLY access their assigned brand
- Other brands show lock icon and are disabled
- Cannot access Admin Panel (shows lock icon)

### Brand Values
- `kia` → AM Kia
- `tata` → AM Tata
- `hyundai` → AM Hyundai
- `honda` → AM Diamond Honda
- `ktm` → AM KTM
- `triumph` → AM Triumph
- `bajaj` → AM Bajaj
- `mg` → AM MG

## Verification Steps

1. **Login as Admin**
   - All brands should be accessible (no locks)
   - Admin Panel accessible
   
2. **Login as Kia User**
   - Only AM Kia accessible
   - All other brands show lock icons
   - Admin Panel shows lock icon

3. **Login as Tata User**
   - Only AM Tata accessible
   - All other brands show lock icons
   - Admin Panel shows lock icon

## Troubleshooting

### Issue: Admin can't access any brands
**Solution**: Ensure admin user's `brand` field is NULL in database
```sql
UPDATE users SET brand = NULL WHERE role = 'admin';
```

### Issue: User can't access their assigned brand
**Solution**: Check brand value matches exactly (lowercase)
```sql
SELECT email, role, brand FROM users WHERE email = 'user@example.com';
```

### Issue: "Column brand does not exist" error
**Solution**: Run the migration script to add the column
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand TEXT;
```

## Security Notes

- Brand assignment is stored in database and validated server-side
- Frontend checks are for UX only - backend should also validate
- Admin role bypasses all brand restrictions
- Users without assigned brand cannot access any brand sections

## Future Enhancements

- Multi-brand access (array of brands)
- Brand-specific permissions within each brand
- Brand hierarchy (regional managers)
- Audit logs for brand access