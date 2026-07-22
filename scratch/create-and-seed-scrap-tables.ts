import 'dotenv/config'
import postgres from 'postgres'
import { INITIAL_SCRAP_TRANSACTIONS, DEFAULT_SCRAP_LOCATIONS, DEFAULT_SCRAP_DEPARTMENTS, DEFAULT_SCRAP_TYPES, DEFAULT_SCRAP_DESCRIPTIONS, DEFAULT_SCRAP_EMPLOYEES, DEFAULT_SCRAP_PAYMENT_MODES, DEFAULT_SCRAP_HANDOVER_USERS, DEFAULT_SCRAP_GROUPS } from '../lib/scrap-erp/mock-data'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  console.log('Replacing event trigger to handle schema cleanly...')
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.auto_enable_rls_on_new_tables()
    RETURNS event_trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      obj record;
    BEGIN
      FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS')
      LOOP
        IF obj.schema_name = 'public' THEN
          EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', obj.object_identity);
          EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY;', obj.object_identity);
          EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, public;', obj.object_identity);
        END IF;
      END LOOP;
    END;
    $$;
  `)

  console.log('Creating Scrap ERP database tables...')

  // 1. Auxiliary Master Tables
  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      group_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_departments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL DEFAULT 'Kg',
      default_rate_per_unit NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_descriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      scrap_type_id UUID REFERENCES public.scrap_types(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_employees (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      role TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_payment_modes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_handover_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      department TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  // 2. Main Transactions Table
  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_number TEXT NOT NULL UNIQUE,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      group_id TEXT,
      group_name TEXT,
      location_id UUID REFERENCES public.scrap_locations(id),
      location_name TEXT NOT NULL,
      department_id UUID REFERENCES public.scrap_departments(id),
      department_name TEXT NOT NULL,
      scrap_type_id UUID REFERENCES public.scrap_types(id),
      scrap_type_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'Kg',
      description TEXT,
      weight_qty NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rate_per_unit NUMERIC(12, 2) NOT NULL DEFAULT 0,
      calculated_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
      amount_received NUMERIC(12, 2) NOT NULL DEFAULT 0,
      outstanding_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      sold_by_id UUID REFERENCES public.scrap_employees(id),
      sold_by_name TEXT NOT NULL,
      sold_to TEXT NOT NULL,
      sold_date DATE,
      payment_mode_id UUID REFERENCES public.scrap_payment_modes(id),
      payment_mode_name TEXT NOT NULL,
      payment_handover_to_id UUID REFERENCES public.scrap_handover_users(id),
      payment_handover_to_name TEXT NOT NULL,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  // 3. Attachments Table
  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id UUID NOT NULL REFERENCES public.scrap_transactions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  // 4. Dynamic Master Data Table
  await sql`
    CREATE TABLE IF NOT EXISTS public.scrap_master_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT,
      default_rate NUMERIC(12, 2),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `

  // Create Indexes
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS scrap_trans_no_idx ON public.scrap_transactions(transaction_number);`
  await sql`CREATE INDEX IF NOT EXISTS scrap_trans_date_idx ON public.scrap_transactions(timestamp);`
  await sql`CREATE INDEX IF NOT EXISTS scrap_trans_loc_idx ON public.scrap_transactions(location_name);`
  await sql`CREATE INDEX IF NOT EXISTS scrap_trans_dept_idx ON public.scrap_transactions(department_name);`
  await sql`CREATE INDEX IF NOT EXISTS scrap_trans_type_idx ON public.scrap_transactions(scrap_type_name);`
  await sql`CREATE INDEX IF NOT EXISTS scrap_master_category_idx ON public.scrap_master_data(category);`

  // Enable and force RLS on all scrap tables
  const scrapTables = [
    'scrap_locations',
    'scrap_departments',
    'scrap_types',
    'scrap_descriptions',
    'scrap_employees',
    'scrap_payment_modes',
    'scrap_handover_users',
    'scrap_transactions',
    'scrap_attachments',
    'scrap_master_data',
  ]

  for (const table of scrapTables) {
    await sql.unsafe(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`)
    await sql.unsafe(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;`)
    await sql.unsafe(`REVOKE ALL ON TABLE public."${table}" FROM anon, public;`)
  }

  console.log('✓ All 10 Scrap ERP database tables successfully created and RLS secured!')

  // Seed Master Data into scrap_master_data
  console.log('Seeding scrap_master_data table...')
  let masterCount = 0

  for (const g of DEFAULT_SCRAP_GROUPS) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('group', ${g.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const l of DEFAULT_SCRAP_LOCATIONS) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('location', ${l.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const d of DEFAULT_SCRAP_DEPARTMENTS) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('department', ${d.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const t of DEFAULT_SCRAP_TYPES) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name, unit, default_rate)
      VALUES ('scrap_type', ${t.name}, ${t.unit}, ${t.defaultRatePerUnit})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const desc of DEFAULT_SCRAP_DESCRIPTIONS) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('description', ${desc.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const emp of DEFAULT_SCRAP_EMPLOYEES) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('sold_by', ${emp.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const pm of DEFAULT_SCRAP_PAYMENT_MODES) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('payment_mode', ${pm.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  for (const ho of DEFAULT_SCRAP_HANDOVER_USERS) {
    await sql`
      INSERT INTO public.scrap_master_data (category, name)
      VALUES ('payment_handover_to', ${ho.name})
      ON CONFLICT DO NOTHING;
    `
    masterCount++
  }

  console.log(`✓ Seeded ${masterCount} master records into public.scrap_master_data`)

  // Seed Historical Transactions into scrap_transactions
  console.log(`Seeding ${INITIAL_SCRAP_TRANSACTIONS.length} historical scrap transactions...`)
  let insertedTxns = 0

  for (const t of INITIAL_SCRAP_TRANSACTIONS) {
    await sql`
      INSERT INTO public.scrap_transactions (
        transaction_number,
        timestamp,
        group_name,
        location_name,
        department_name,
        scrap_type_name,
        unit,
        description,
        weight_qty,
        rate_per_unit,
        calculated_total,
        amount_received,
        outstanding_amount,
        sold_by_name,
        sold_to,
        sold_date,
        payment_mode_name,
        payment_handover_to_name,
        remarks,
        status
      ) VALUES (
        ${t.transactionNumber},
        ${t.timestamp},
        ${t.groupName || 'JAM'},
        ${t.locationName},
        ${t.departmentName},
        ${t.scrapTypeName},
        ${t.unit || 'Kg'},
        ${t.description || ''},
        ${t.weightQty},
        ${t.ratePerUnit},
        ${t.calculatedTotal},
        ${t.amountReceived},
        ${t.outstandingAmount},
        ${t.soldByName},
        ${t.soldTo},
        ${t.soldDate || t.timestamp.slice(0, 10)},
        ${t.paymentModeName},
        ${t.paymentHandoverToName},
        ${t.remarks || ''},
        ${t.status}
      )
      ON CONFLICT (transaction_number) DO UPDATE SET
        calculated_total = EXCLUDED.calculated_total,
        amount_received = EXCLUDED.amount_received,
        outstanding_amount = EXCLUDED.outstanding_amount;
    `
    insertedTxns++
  }

  console.log(`✓ Successfully populated ${insertedTxns} records into public.scrap_transactions!`)

  try {
    await sql`NOTIFY pgrst, 'reload schema';`
    console.log('✓ PostgREST schema cache reloaded.')
  } catch (e) {
    console.log('Skipped NOTIFY pgrst.')
  }

  await sql.end()
}

main().catch(console.error)
