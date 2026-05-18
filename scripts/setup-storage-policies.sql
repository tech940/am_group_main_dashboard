-- Storage Policies for purchase-orders bucket
-- Run this in Supabase SQL Editor after creating the bucket

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates" ON storage.objects;

-- Policy 1: Allow authenticated users to upload files to purchase-orders bucket
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'purchase-orders');

-- Policy 2: Allow authenticated users to read files from purchase-orders bucket
CREATE POLICY "Allow authenticated reads"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'purchase-orders');

-- Policy 3: Allow authenticated users to update files in purchase-orders bucket
CREATE POLICY "Allow authenticated updates"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'purchase-orders');

-- Policy 4: Allow authenticated users to delete files from purchase-orders bucket
CREATE POLICY "Allow authenticated deletes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'purchase-orders');

-- Verify policies were created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'objects' AND policyname LIKE '%authenticated%';

-- Made with Bob