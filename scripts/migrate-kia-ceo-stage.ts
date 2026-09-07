import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('1. Adding ceo_approval column to kia_approval_requests if not exists...')
  await analyticsExecute(sql`
    ALTER TABLE kia_approval_requests 
    ADD COLUMN IF NOT EXISTS ceo_approval text DEFAULT '';
  `)
  console.log('Column added or already exists.')

  console.log('2. Backfilling historical requests that have reached EA or beyond...')
  await analyticsExecute(sql`
    UPDATE kia_approval_requests
    SET ceo_approval = 'APPROVED'
    WHERE (ea_approval = 'APPROVED' 
       OR management_approval = 'APPROVED' 
       OR account_approval = 'APPROVED' 
       OR payment_status = 'PAID')
      AND (ceo_approval IS NULL OR ceo_approval = '');
  `)
  console.log('Backfill completed.')

  const check = await analyticsExecute<{ request_no: string; brand: string; department: string; vp_approval: string; ceo_approval: string; ea_approval: string }>(sql`
    SELECT request_no, brand, department, vp_approval, ceo_approval, ea_approval
    FROM kia_approval_requests
    WHERE brand = 'kia'
    ORDER BY created_at DESC
    LIMIT 10;
  `)
  console.log('Sample KIA rows:')
  for (const r of check) {
    console.log(`  ${r.request_no} dept=${r.department} vp=${r.vp_approval} ceo=${r.ceo_approval} ea=${r.ea_approval}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })
