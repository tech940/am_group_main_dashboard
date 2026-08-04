const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODkyNSwiZXhwIjoyMDkyNTg0OTI1fQ.nynYDrFDHiyn74UykpX4A3sjyfNXp5A_7Uy6auKWdZI'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function testStorage() {
  console.log('[Storage-Test] Querying call_recordings with storage_path...')
  const { data: recordings, error } = await supabase
    .from('call_recordings')
    .select('*')
    .not('storage_path', 'is', null)
    .limit(3)

  if (error) {
    console.error('Error fetching recordings:', error)
    return
  }

  console.log(`Found ${recordings.length} recordings with storage_path:`)
  for (const rec of recordings) {
    console.log(`\nRecording ID: ${rec.id}`)
    console.log(`Storage Path: ${rec.storage_path}`)

    // Create signed URL for 1 hour (3600s)
    const { data: signedData, error: signedErr } = await supabase
      .storage
      .from('recordings')
      .createSignedUrl(rec.storage_path, 3600)

    if (signedErr) {
      console.log('Signed URL error:', signedErr.message)
      // Try public URL
      const { data: pubData } = supabase.storage.from('recordings').getPublicUrl(rec.storage_path)
      console.log('Public URL:', pubData.publicUrl)
    } else {
      console.log('Signed URL:', signedData.signedUrl)
    }
  }
}

testStorage().catch(console.error)
