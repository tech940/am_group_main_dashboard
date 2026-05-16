-- Quick setup script for Purchase Orders
-- Run this to ensure your user exists in the users table

-- Check if your user exists (replace with your actual email)
SELECT id, supabase_id, email, role, brand 
FROM users 
WHERE email = 'YOUR_EMAIL_HERE';

-- If user doesn't exist, insert them (REPLACE VALUES BELOW)
-- Uncomment and modify this section:

/*
INSERT INTO users (
  supabase_id,
  email,
  full_name,
  role,
  brand,
  is_active
) VALUES (
  'YOUR_SUPABASE_AUTH_UID',  -- Get this from auth.users table or Supabase Dashboard
  'your.email@example.com',
  'Your Full Name',
  'admin',  -- or 'manager', 'viewer', etc.
  'kia',    -- or your brand
  true
)
ON CONFLICT (supabase_id) DO UPDATE
SET 
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  brand = EXCLUDED.brand;
*/

-- To get your Supabase Auth UID, run this:
-- SELECT id, email FROM auth.users WHERE email = 'your.email@example.com';

-- Made with Bob