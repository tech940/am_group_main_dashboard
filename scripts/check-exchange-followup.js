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
  
  const { data: enqData } = await supabase
    .from('hyundai_enquiry_report')
    .select('exchange_opted, next_followup_date, test_drive, enquiry_status, enquiry_date')
    .gte('enquiry_date', '2026-08-01')
    .limit(50)

  console.log('Sample August Enquiry data:')
  console.log(enqData.slice(0, 10))

  const { data: distinctExchange } = await supabase
    .from('hyundai_enquiry_report')
    .select('exchange_opted')
    .limit(500)
  console.log('Distinct exchange_opted:', Array.from(new Set(distinctExchange.map(r => r.exchange_opted))))

  const { count: missedCount } = await supabase
    .from('hyundai_enquiry_report')
    .select('*', { count: 'exact', head: true })
    .gte('enquiry_date', '2026-08-01')
    .lt('next_followup_date', new Date().toISOString().slice(0, 10))
    .not('enquiry_status', 'ilike', '%lost%')
    .not('enquiry_status', 'ilike', '%close%')
    .not('enquiry_status', 'ilike', '%book%')
    .not('enquiry_status', 'ilike', '%retail%')

  console.log('Missed followups count (August):', missedCount)
}

main().catch(console.error)
