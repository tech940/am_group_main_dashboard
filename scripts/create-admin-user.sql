-- SQL Script to create an admin user directly in Supabase
-- Run this in your Supabase SQL Editor

-- Step 1: Create the auth user (this will be in auth.users table)
-- You need to do this through Supabase Dashboard > Authentication > Users > Add User
-- OR use the Supabase API/CLI

-- Step 2: After creating the auth user, insert the profile into your users table
-- Replace 'YOUR_SUPABASE_USER_ID' with the actual UUID from auth.users
-- Replace the email and other details as needed

INSERT INTO users (
  supabase_id,
  email,
  full_name,
  role,
  department,
  phone_number,
  is_active,
  created_at,
  updated_at
) VALUES (
  'YOUR_SUPABASE_USER_ID',  -- Get this from Supabase Dashboard > Authentication > Users
  'admin@amgroup.com',
  'Admin User',
  'admin',
  'Management',
  NULL,
  true,
  NOW(),
  NOW()
);

-- Verify the user was created
SELECT * FROM users WHERE email = 'admin@amgroup.com';

-- Made with Bob
