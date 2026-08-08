import 'dotenv/config'
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require' })

const p = (t, r) => { console.log('\n=== ' + t + ' ==='); console.table(r) }

p('role ENUM values', await sql`
  SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='role' ORDER BY e.enumsortorder`)

p('isAccountsUser MATCHES', await sql`
  SELECT full_name, email, role::text AS role, is_active, brand, department
  FROM users
  WHERE role::text IN ('accounts','accounts_head','accounts_team','finance_head','finance_team','assistant_manager','manager')
     OR lower(role::text) LIKE '%account%' OR lower(role::text) LIKE '%finance%'
  ORDER BY role::text, full_name`)

p('isHrUser MATCHES', await sql`
  SELECT full_name, email, role::text AS role, is_active FROM users
  WHERE role::text IN ('hr','hr_head','hr_team','hr_manager') OR lower(role::text) LIKE '%hr%'`)

p('sales_manager-stage approvers', await sql`
  SELECT full_name, email, role::text AS role, is_active FROM users
  WHERE role::text = 'ed'
     OR lower(role::text) IN ('gsm','general_sales_manager','sales_manager','sales_head','general_manager')
     OR lower(role::text) LIKE '%sales_manager%' OR lower(role::text) LIKE '%general_sales%'
     OR lower(role::text) IN ('vp','vice_president','vice_pres','vp_service','service_vp')
     OR lower(role::text) LIKE '%vp%' OR lower(role::text) LIKE '%vice_president%'
  ORDER BY role::text`)

p('EA/EBA/MD/CEO/dev/admin', await sql`
  SELECT full_name, email, role::text AS role, is_active FROM users
  WHERE role::text IN ('ea','eba','md','ceo','developer','admin') ORDER BY role::text`)

await sql.end()
