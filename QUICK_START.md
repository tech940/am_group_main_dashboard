# Quick Start Guide - Brand Access Control

## Step 1: Add Brand Column to Database

Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand TEXT;
```

## Step 2: Setup Admin User

### If admin user doesn't exist yet:
```bash
npx tsx scripts/create-admin-user.ts
```

### If admin user already exists (update existing):
```bash
npx tsx scripts/update-admin-user.ts
```

This will setup an admin user with:
- **Email**: `admin@amgroup.com`
- **Password**: `Admin@123456`
- **Role**: Admin
- **Brand**: NULL (can access all brands)

## Step 3: Login and Test

1. Go to http://localhost:3000/auth/login
2. Login with the admin credentials above
3. You should see all brands accessible in the sidebar
4. Go to Admin Panel > User Management

## Step 4: Create Test Users

### Create a Kia User:
1. Click "Create New User"
2. Fill in:
   - Full Name: `Kia Manager`
   - Email: `kia@amgroup.com`
   - Password: `Kia@123`
   - Role: `Manager`
   - **Assigned Brand**: `AM Kia` ← Important!
   - Department: `Operations` (optional)
3. Click "Create User"

### Create a Tata User:
1. Click "Create New User"
2. Fill in:
   - Full Name: `Tata Manager`
   - Email: `tata@amgroup.com`
   - Password: `Tata@123`
   - Role: `Manager`
   - **Assigned Brand**: `AM Tata` ← Important!
   - Department: `Operations` (optional)
3. Click "Create User"

## Step 5: Test Brand Access

### Test as Admin:
- Login as `admin@amgroup.com`
- ✅ All brands should be accessible
- ✅ Admin Panel accessible
- ✅ No lock icons

### Test as Kia User:
1. Logout
2. Login as `kia@amgroup.com` / `Kia@123`
3. Check sidebar:
   - ✅ AM Kia: Accessible (no lock)
   - 🔒 All other brands: Locked (lock icon, dimmed)
   - 🔒 Admin Panel: Locked

### Test as Tata User:
1. Logout
2. Login as `tata@amgroup.com` / `Tata@123`
3. Check sidebar:
   - ✅ AM Tata: Accessible (no lock)
   - 🔒 All other brands: Locked (lock icon, dimmed)
   - 🔒 Admin Panel: Locked

## Troubleshooting

### "Column brand does not exist"
Run the SQL from Step 1 in your Supabase dashboard.

### Admin can't access brands
Make sure admin user's brand is NULL:
```sql
UPDATE users SET brand = NULL WHERE role = 'admin';
```

### User can't access their assigned brand
Check the brand value is lowercase and matches exactly:
```sql
SELECT email, role, brand FROM users;
```

Brand values should be: `kia`, `tata`, `hyundai`, `honda`, `ktm`, `triumph`, `bajaj`, `mg`

## Summary

✅ **Admin users** (brand = NULL): Access all brands
✅ **Brand users** (brand = 'kia'): Access only their brand
✅ **Visual feedback**: Lock icons on restricted brands
✅ **Secure**: Backend validation in API routes

## Next Steps

- Create more users with different brand assignments
- Test data entry forms (should work for all users)
- Test table access control (locked for non-admins)
- Customize brand assignments as needed

For detailed documentation, see `BRAND_ACCESS_SETUP.md`