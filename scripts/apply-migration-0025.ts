import 'dotenv/config'
import postgres from 'postgres'
import * as XLSX from 'xlsx'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('[0025] Creating gl_accounts table...')
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS gl_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gl_code text NOT NULL UNIQUE,
        gl_name text NOT NULL,
        tally_group text NOT NULL,
        account_nature text NOT NULL,
        account_type text NOT NULL,
        applies_to text NOT NULL DEFAULT 'both',
        is_active boolean NOT NULL DEFAULT true,
        monthly_budget decimal(14,2) DEFAULT 0.00,
        quarterly_budget decimal(14,2) DEFAULT 0.00,
        annual_budget decimal(14,2) DEFAULT 0.00,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    console.log('[0025] Reading AM_Vendor_Master_4.xlsx suggested GL accounts...')
    const filePath = 'C:\\Users\\sahil\\Downloads\\AM_Vendor_Master_4.xlsx'
    const workbook = XLSX.readFile(filePath)
    const sheet = workbook.Sheets['Suggested GL Accounts']
    const rows = XLSX.utils.sheet_to_json(sheet) as any[]

    const glRecords = rows.filter((r: any) => r['#'] !== undefined && r['#'] !== '')

    console.log(`[0025] Seeding ${glRecords.length} GL accounts...`)
    for (const r of glRecords) {
      const glCode = 'GL-' + String(r['#']).padStart(3, '0')
      const glName = String(r['GL Ledger Account'] || '').trim()
      const tallyGroup = String(r['Tally Group (Under)'] || '').trim()
      const accountNature = String(r['Nature'] || '').trim()
      const accountType = String(r['Nature'] || '').trim()
      const appliesTo = String(r['Applies to'] || 'Both').toLowerCase()

      if (!glName || !tallyGroup || !accountNature) continue

      await sql`
        INSERT INTO gl_accounts (gl_code, gl_name, tally_group, account_nature, account_type, applies_to)
        VALUES (${glCode}, ${glName}, ${tallyGroup}, ${accountNature}, ${accountType}, ${appliesTo})
        ON CONFLICT (gl_code) DO UPDATE 
        SET gl_name = EXCLUDED.gl_name,
            tally_group = EXCLUDED.tally_group,
            account_nature = EXCLUDED.account_nature,
            account_type = EXCLUDED.account_type,
            applies_to = EXCLUDED.applies_to
      `
    }

    console.log('[0025] Altering kia_approval_requests to add gl_account_id and gst...')
    await sql.unsafe(`
      ALTER TABLE kia_approval_requests 
      ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES gl_accounts(id),
      ADD COLUMN IF NOT EXISTS gst text
    `)

    console.log('[0025] Creating gl_accounts indexes...')
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS idx_gl_accounts_code ON gl_accounts (gl_code);
      CREATE INDEX IF NOT EXISTS idx_gl_accounts_name ON gl_accounts (gl_name);
      CREATE INDEX IF NOT EXISTS idx_kia_approval_requests_gl_account ON kia_approval_requests (gl_account_id);
    `)

    console.log('Successfully completed migration 0025.')
    process.exit(0)
  } catch (error) {
    console.error('Migration 0025 failed:', error)
    process.exit(1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('Migration 0025 failed:', error)
  process.exit(1)
})
