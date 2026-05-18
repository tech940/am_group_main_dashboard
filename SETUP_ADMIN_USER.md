# 🔐 Create Your First Admin User

## Step-by-Step Guide

### Option 1: Using Supabase Dashboard (Recommended)

#### Step 1: Create Auth User
1. Go to your Supabase project dashboard: https://supabase.com/dashboard
2. Click on your project
3. In the left sidebar, click **"Authentication"**
4. Click **"Users"** tab
5. Click the **"Add User"** button (top right)
6. Fill in the form:
   - **Email**: `admin@amgroup.com`
   - **Password**: `Admin@123456`
   - **Auto Confirm User**: ✅ Check this box (important!)
7. Click **"Create User"**
8. **IMPORTANT**: Copy the **User ID** (it's a UUID like `a1b2c3d4-...`)

#### Step 2: Create Database Profile
1. In Supabase, click **"SQL Editor"** in the left sidebar
2. Click **"New Query"**
3. Copy and paste this SQL (replace `PASTE_USER_ID_HERE` with the UUID you copied):

```sql
INSERT INTO users (
  supabase_id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  updated_at
) VALUES (
  'PASTE_USER_ID_HERE',  -- Replace this with the UUID from Step 1
  'admin@amgroup.com',
  'Admin User',
  'admin',
  true,
  NOW(),
  NOW()
);
```

4. Click **"Run"** button
5. You should see: "Success. No rows returned"

#### Step 3: Verify
Run this query to verify:
```sql
SELECT * FROM users WHERE email = 'admin@amgroup.com';
```

You should see your user record!

#### Step 4: Login
1. Go to: `http://localhost:3000/auth/login`
2. Enter:
   - Email: `admin@amgroup.com`
   - Password: `Admin@123456`
3. Click "Sign In"
4. You should be redirected to the dashboard! 🎉

---

### Option 2: Using Supabase CLI

If you have Supabase CLI installed:

```bash
# Create auth user
supabase auth users create admin@amgroup.com --password Admin@123456

# Copy the user ID from the output, then run:
supabase db execute "INSERT INTO users (supabase_id, email, full_name, role, is_active, created_at, updated_at) VALUES ('PASTE_USER_ID_HERE', 'admin@amgroup.com', 'Admin User', 'admin', true, NOW(), NOW());"
```

---

### Option 3: Using the TypeScript Script

**Prerequisites:**
- Make sure you have `SUPABASE_SERVICE_ROLE_KEY` in your `.env.local`
- Install tsx: `npm install -D tsx`

**Steps:**
1. Open `scripts/create-admin-user.ts`
2. Edit the credentials at the top if needed:
   ```typescript
   const email = 'admin@amgroup.com'
   const password = 'Admin@123456'
   const fullName = 'Admin User'
   const role = 'admin'
   ```
3. Run the script:
   ```bash
   npx tsx scripts/create-admin-user.ts
   ```
4. The script will create both the auth user and database profile
5. Use the credentials shown to log in

---

## 🔍 Troubleshooting

### "Invalid credentials" error
This means the user doesn't exist in Supabase Auth. Make sure you:
1. Created the user in **Authentication → Users** in Supabase Dashboard
2. Checked the **"Auto Confirm User"** box
3. Used the exact same email and password when logging in

### "User not found" in database
This means you created the auth user but didn't create the database profile. Run the SQL query in Step 2.

### Check if user exists in Auth
Go to Supabase Dashboard → Authentication → Users
You should see your user listed there.

### Check if user exists in Database
Run this SQL in Supabase SQL Editor:
```sql
SELECT * FROM users WHERE email = 'admin@amgroup.com';
```

---

## 📝 After Successful Login

Once logged in, you can:
1. ✅ Access the dashboard
2. ✅ See your name and role in the header
3. ✅ Go to Admin → User Management
4. ✅ Create more users through the UI (no need for manual SQL!)

---

## 🆘 Still Having Issues?

1. **Check your .env.local file** - Make sure Supabase credentials are correct:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

2. **Restart your dev server** after creating the user:
   ```bash
   npm run dev
   ```

3. **Clear browser cache** and try again

4. **Check Supabase logs** in Dashboard → Logs to see authentication attempts