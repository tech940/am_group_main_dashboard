import 'dotenv/config';
process.env.SQL_QUERY_LOGS = 'true'; // Enable SQL query logs in development db client
import { db } from '../lib/db';
import { sql, count, desc, isNull } from 'drizzle-orm';
import { kiaBookings } from '../lib/db/schema';
import { expireKiaTemporaryAllocations, getKiaBookingsList } from '../lib/kia/bookings';

// Trace individual query execution details and time limit
async function runWithTimeout<T>(promise: Promise<T>, ms: number, description: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${description} took longer than ${ms}ms`));
    }, ms);
  });
  try {
    const res = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return res;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

async function testSequential() {
  console.log('\n--- STARTING SEQUENTIAL TESTS ---');
  const where = isNull(kiaBookings.deletedAt);
  const pageSize = 10;
  const offset = 0;

  const queries = [
    {
      name: 'Query 1: count total rows',
      fn: () => db.select({ value: count() }).from(kiaBookings).where(where)
    },
    {
      name: 'Query 2: select booking rows',
      fn: () => db.select().from(kiaBookings).where(where).orderBy(desc(kiaBookings.updatedAt), desc(kiaBookings.createdAt)).limit(pageSize).offset(offset)
    },
    {
      name: 'Query 3: status count query',
      fn: () => db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM kia_bookings
        WHERE deleted_at IS NULL
        GROUP BY status
        ORDER BY status
      `)
    },
    {
      name: 'Query 4: SELECT DISTINCT dealer_code',
      fn: () => db.execute(sql`SELECT DISTINCT dealer_code AS value FROM kia_bookings WHERE deleted_at IS NULL AND dealer_code IS NOT NULL ORDER BY dealer_code`)
    },
    {
      name: 'Query 5: SELECT DISTINCT model',
      fn: () => db.execute(sql`SELECT DISTINCT model AS value FROM kia_bookings WHERE deleted_at IS NULL AND model IS NOT NULL ORDER BY model`)
    },
    {
      name: 'Query 6: SELECT DISTINCT consultant_name',
      fn: () => db.execute(sql`SELECT DISTINCT consultant_name AS value FROM kia_bookings WHERE deleted_at IS NULL AND consultant_name IS NOT NULL ORDER BY consultant_name`)
    }
  ];

  for (const q of queries) {
    console.log(`Executing ${q.name}...`);
    const start = Date.now();
    try {
      await runWithTimeout(q.fn(), 10000, q.name);
      console.log(`  Finished ${q.name} in ${Date.now() - start}ms`);
    } catch (err: any) {
      console.error(`  FAILED ${q.name}:`, err.stack || err);
    }
  }
}

async function testConcurrent() {
  console.log('\n--- STARTING CONCURRENT TESTS (Promise.all) ---');
  const where = isNull(kiaBookings.deletedAt);
  const pageSize = 10;
  const offset = 0;

  const start = Date.now();
  try {
    const p1 = db.select({ value: count() }).from(kiaBookings).where(where);
    const p2 = db.select().from(kiaBookings).where(where).orderBy(desc(kiaBookings.updatedAt), desc(kiaBookings.createdAt)).limit(pageSize).offset(offset);
    const p3 = db.execute(sql`
      SELECT status, count(*)::int AS count
      FROM kia_bookings
      WHERE deleted_at IS NULL
      GROUP BY status
      ORDER BY status
    `);
    const p4 = db.execute(sql`SELECT DISTINCT dealer_code AS value FROM kia_bookings WHERE deleted_at IS NULL AND dealer_code IS NOT NULL ORDER BY dealer_code`);
    const p5 = db.execute(sql`SELECT DISTINCT model AS value FROM kia_bookings WHERE deleted_at IS NULL AND model IS NOT NULL ORDER BY model`);
    const p6 = db.execute(sql`SELECT DISTINCT consultant_name AS value FROM kia_bookings WHERE deleted_at IS NULL AND consultant_name IS NOT NULL ORDER BY consultant_name`);

    console.log('Dispatched all 6 queries concurrently. Waiting for results...');
    
    const trace = async (name: string, p: Promise<any>) => {
      const s = Date.now();
      try {
        await runWithTimeout(p, 10000, name);
        console.log(`  [concurrent] ${name} resolved in ${Date.now() - s}ms`);
      } catch (err: any) {
        console.error(`  [concurrent] ${name} FAILED:`, err.stack || err);
      }
    };

    await Promise.all([
      trace('Query 1 (count)', p1),
      trace('Query 2 (rows)', p2),
      trace('Query 3 (statuses)', p3),
      trace('Query 4 (dealers)', p4),
      trace('Query 5 (models)', p5),
      trace('Query 6 (consultants)', p6)
    ]);
    console.log(`All queries completed in ${Date.now() - start}ms`);
  } catch (error: any) {
    console.error('Promise.all execution failed:', error.stack || error);
  }
}

async function main() {
  console.log('Testing expireKiaTemporaryAllocations()...');
  const startAlloc = Date.now();
  try {
    await runWithTimeout(expireKiaTemporaryAllocations(), 10000, 'expireKiaTemporaryAllocations');
    console.log(`expireKiaTemporaryAllocations completed in ${Date.now() - startAlloc}ms`);
  } catch (err: any) {
    console.error('expireKiaTemporaryAllocations FAILED:', err.stack || err);
  }

  await testSequential();
  await testConcurrent();

  console.log('\nTesting full getKiaBookingsList()...');
  const startFull = Date.now();
  try {
    const listResult = await runWithTimeout(getKiaBookingsList({}), 20000, 'getKiaBookingsList');
    console.log(`getKiaBookingsList completed in ${Date.now() - startFull}ms. Returned ${listResult.rows?.length ?? 0} rows.`);
  } catch (err: any) {
    console.error('getKiaBookingsList FAILED:', err.stack || err);
  }

  process.exit(0);
}

main();
