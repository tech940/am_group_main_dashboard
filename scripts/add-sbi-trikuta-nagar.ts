import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import postgres from 'postgres'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL is not set in environment!')
  process.exit(1)
}

const sql = postgres(dbUrl, { prepare: false })

async function run() {
  console.log('Inserting SBI Trikuta Nagar into kia_price_details & mg_price_details...')

  // Check if exists
  const existingKia = await sql`
    SELECT id, bank_name, bank_branch 
    FROM kia_price_details 
    WHERE (bank_name ILIKE 'SBI%' OR hyp ILIKE 'SBI%') 
      AND (bank_branch ILIKE '%Trikuta%' OR bank_branch ILIKE '%Trikuta Nagar%')
  `

  if (existingKia.length > 0) {
    console.log('Already exists in kia_price_details:', existingKia)
  } else {
    const insertedKia = await sql`
      INSERT INTO kia_price_details (
        model, trim_description, bank_name, hyp, bank_branch, ex_showroom_price, statutory_charges, insurance_company, created_at, updated_at
      ) VALUES (
        '__BANK_OPTION__', '__BANK_OPTION__', 'SBI', 'SBI', 'SBI Trikuta Nagar', 0, 0, 'ICICI LOMBARD', NOW(), NOW()
      )
      RETURNING id, model, bank_name, bank_branch
    `
    console.log('Inserted into kia_price_details:', insertedKia)
  }

  // Also check mg_price_details
  try {
    const existingMg = await sql`
      SELECT id, bank_name, bank_branch 
      FROM mg_price_details 
      WHERE (bank_name ILIKE 'SBI%' OR hyp ILIKE 'SBI%') 
        AND (bank_branch ILIKE '%Trikuta%' OR bank_branch ILIKE '%Trikuta Nagar%')
    `
    if (existingMg.length > 0) {
      console.log('Already exists in mg_price_details:', existingMg)
    } else {
      const insertedMg = await sql`
        INSERT INTO mg_price_details (
          model, trim_description, bank_name, hyp, bank_branch, ex_showroom_price, statutory_charges, insurance_company, created_at, updated_at
        ) VALUES (
          '__BANK_OPTION__', '__BANK_OPTION__', 'SBI', 'SBI', 'SBI Trikuta Nagar', 0, 0, 'ICICI LOMBARD', NOW(), NOW()
        )
        RETURNING id, model, bank_name, bank_branch
      `
      console.log('Inserted into mg_price_details:', insertedMg)
    }
  } catch (e: any) {
    console.log('Note on mg_price_details:', e.message)
  }

  await sql.end()
  process.exit(0)
}

run().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
