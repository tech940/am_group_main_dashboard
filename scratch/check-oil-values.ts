import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { advWiseDealerFilter, tableExists } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'

  const hasInvoiceWise = await tableExists('adv_wise_lubricants_vas')
  console.log('adv_wise_lubricants_vas exists:', hasInvoiceWise)
  
  if (hasInvoiceWise) {
    const result = await db.execute(sql`
      SELECT 
        COALESCE(SUM(CASE WHEN COALESCE(gst_invoice_date, ro_close_date::date) = ${EXPORT_DATE}::date THEN qty_hrs ELSE 0 END), 0)::float AS engine_today,
        COALESCE(SUM(qty_hrs), 0)::float AS engine_mtd
      FROM adv_wise_lubricants_vas
      WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= ${MONTH_START}::date
        AND COALESCE(gst_invoice_date, ro_close_date::date) <= ${EXPORT_DATE}::date
        ${advWiseDealerFilter(DEALER_CODE)}
    `)
    console.log('Invoice wise oil sums (no description filter yet):', result)
  }
}

main().catch(console.error)
