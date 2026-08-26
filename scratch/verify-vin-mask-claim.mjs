import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from '../scripts/bigquery/db-url.js'
const url = await pickDatabaseUrl(postgres, '[vin-mask-verify]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 })
async function q(text) { const r = await db.unsafe(`SET statement_timeout TO '240000ms'; ${text}`); return r[1] || r }
const p=(l,r)=>{console.log('\n### '+l);console.table(r)}

p('purchase feed depth (hyundai)', await q(`
 SELECT MIN(substring(hmi_invoice_date from 7 for 4)) min_yr, MAX(substring(hmi_invoice_date from 7 for 4)) max_yr, COUNT(*)::int rows FROM hyundai_purchase_report`))
p('sales feed depth (hyundai)', await q(`
 SELECT MIN(substring(invoice_date from 7 for 4)) min_yr, MAX(substring(invoice_date from 7 for 4)) max_yr, COUNT(*)::int rows FROM hyundai_sales_report`))

p('hmi bypass coverage, sales invoiced 2022+', await q(`
 WITH s AS (SELECT DISTINCT TRIM(hmi_invoice_no) k FROM hyundai_sales_report
   WHERE NULLIF(TRIM(hmi_invoice_no),'') IS NOT NULL AND substring(invoice_date from 7 for 4) >= '2022'),
  pu AS (SELECT DISTINCT TRIM(hmi_invoice_no) k FROM hyundai_purchase_report WHERE vin_no IS NOT NULL)
 SELECT (SELECT COUNT(*)::int FROM s) sales_2022plus, (SELECT COUNT(*)::int FROM s JOIN pu USING (k)) resolved`))

// UNION of both bridges at customer level (hyundai)
p('HYUNDAI union coverage of sold customers', await q(`
 WITH sale AS (SELECT DISTINCT TRIM(customerid) c, TRIM(hmi_invoice_no) k FROM hyundai_sales_report WHERE NULLIF(TRIM(customerid),'') IS NOT NULL),
 viaVin AS (SELECT DISTINCT s.c FROM sale s JOIN hyundai_purchase_report p ON TRIM(p.hmi_invoice_no)=s.k
            JOIN hyundai_ro_billing_report r ON r.vin=p.vin_no),
 ph AS (SELECT DISTINCT TRIM(e.customer_id) c, regexp_replace(e.contact_number,'\D','','g') p FROM hyundai_enquiry_report e
        WHERE regexp_replace(COALESCE(e.contact_number,''),'\D','','g') ~ '^[6-9][0-9]{9}$'),
 viaPhone AS (SELECT DISTINCT s.c FROM sale s JOIN ph ON ph.c=s.c
              JOIN hyundai_ro_billing_report r ON regexp_replace(COALESCE(r.mobile_no,''),'\D','','g')=ph.p)
 SELECT (SELECT COUNT(DISTINCT c)::int FROM sale) sold,
        (SELECT COUNT(*)::int FROM viaVin) via_exact_vin,
        (SELECT COUNT(*)::int FROM viaPhone) via_phone,
        (SELECT COUNT(*)::int FROM (SELECT c FROM viaVin UNION SELECT c FROM viaPhone) u) union_reach`))
await db.end()
