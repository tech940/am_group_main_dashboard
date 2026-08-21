const fs = require('node:fs')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')

function loadEnv() {
  const envFiles = ['.env.local', '.env']
  for (const file of envFiles) {
    const p = path.resolve(process.cwd(), file)
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim()
          let val = trimmed.slice(idx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          if (!process.env[key]) {
            process.env[key] = val
          }
        }
      }
    }
  }
}

loadEnv()

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  
  const { data: enqSample } = await supabase.from('hyundai_enquiry_report').select('*').limit(1)
  const { data: bookSample } = await supabase.from('hyundai_booking_report').select('*').limit(1)
  const { data: salesSample } = await supabase.from('hyundai_sales_report').select('*').limit(1)

  console.log('=== Enquiry columns ===')
  console.log(Object.keys(enqSample?.[0] || {}))

  console.log('=== Booking columns ===')
  console.log(Object.keys(bookSample?.[0] || {}))

  console.log('=== Sales columns ===')
  console.log(Object.keys(salesSample?.[0] || {}))
}

main().catch(console.error)
