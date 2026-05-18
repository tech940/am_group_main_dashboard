-- Add brand column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN users.brand IS 'Brand/Branch assignment: kia, tata, hyundai, honda, ktm, triumph, bajaj, mg';

-- Update existing admin users to have no brand restriction (they can access all)
-- Non-admin users will need to be assigned a brand through the UI

-- Made with Bob
