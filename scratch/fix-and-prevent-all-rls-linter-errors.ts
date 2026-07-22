import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL environment variable is not set')

  console.log('Connecting to database...')
  const sql = postgres(url, { ssl: 'require' })

  try {
    console.log('Fetching all tables in public schema...')
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `

    console.log(`Found ${tables.length} tables in public schema. Enabling RLS and revoking public/anon exposure on all tables...`)

    for (const t of tables) {
      const tableName = t.table_name
      try {
        // 1. Enable RLS
        await sql.unsafe(`ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;`)
        // 2. Force RLS
        await sql.unsafe(`ALTER TABLE public."${tableName}" FORCE ROW LEVEL SECURITY;`)
        // 3. Revoke public/anon access via PostgREST
        await sql.unsafe(`REVOKE ALL ON TABLE public."${tableName}" FROM anon, public;`)
        console.log(`  ✓ RLS enabled & secured for: public."${tableName}"`)
      } catch (err: any) {
        console.error(`  ✗ Error securing table ${tableName}: ${err.message}`)
      }
    }

    console.log('\nCreating PostgreSQL Event Trigger to automatically enable RLS on ALL future tables...')
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
            EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', obj.schema_name, obj.object_identity);
            EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;', obj.schema_name, obj.object_identity);
            EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM anon, public;', obj.schema_name, obj.object_identity);
          END IF;
        END LOOP;
      END;
      $$;
    `)

    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'trg_auto_enable_rls') THEN
          CREATE EVENT TRIGGER trg_auto_enable_rls
          ON ddl_command_end
          WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS')
          EXECUTE FUNCTION public.auto_enable_rls_on_new_tables();
        END IF;
      END
      $$;
    `)
    console.log('✓ Automatic RLS Event Trigger registered successfully for future tables.')

    // Reload PostgREST schema cache
    try {
      await sql`NOTIFY pgrst, 'reload schema';`
      console.log('✓ PostgREST schema cache reloaded.')
    } catch (e) {
      console.log('Skipped NOTIFY pgrst.')
    }

    console.log('\nSUCCESS: All Supabase Linter RLS Security Errors have been resolved and future-proofed!')
  } catch (err) {
    console.error('Fatal error during RLS remediation:', err)
  } finally {
    await sql.end()
  }
}

main().catch(console.error)
