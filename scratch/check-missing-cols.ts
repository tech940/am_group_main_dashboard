import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
  connect_timeout: 15,
  max: 1,
  prepare: false,
})

async function main() {
  // Check for Drizzle schema columns that are MISSING from actual DB tables
  const drizzleMgPriceCols = ['id','model','trim_description','colour','hyp','bank_name','bank_branch','ex_showroom_price','tcs','registration_charges','statutory_charges','insurance','fastag','accessories_kit','extended_warranty_4th_year','insurance_company','metadata','created_at','updated_at']
  const dbMgPriceCols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'mg_price_details'`).map(c => c.column_name)
  const missingPrice = drizzleMgPriceCols.filter(c => !dbMgPriceCols.includes(c))
  console.log('Missing from mg_price_details:', missingPrice.join(', ') || 'NONE')

  const drizzleMgProfCols = ['id','entry_time','proforma_date','customer_type','customer_name','mobile_number','customer_address','customer_email','model_name','trim_description','fuel_type','vehicle_color','bank_name','bank_branch','vehicle_status','loan_amount','insurance_company','ex_showroom','tcs_value','registration_charges','insurance_value','fastag_value','accessories_kit','ext_warranty','cash_discount','exchange_value','booking_amount','govt_employee_discount','additional_discount','total_customer_cost','grand_total_cost','login_email','consultant','location','emp_code','approval_status','approved_by','checked_by','email_send_status','link_preview','finance_status','finance_remarks','finance_updated_time','add_disc_approval','import_metadata','created_by','created_at','updated_at','deleted_at']
  const dbMgProfCols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'mg_proformas'`).map(c => c.column_name)
  const missingProf = drizzleMgProfCols.filter(c => !dbMgProfCols.includes(c))
  console.log('Missing from mg_proformas:', missingProf.join(', ') || 'NONE')

  await sql.end()
}
main()
