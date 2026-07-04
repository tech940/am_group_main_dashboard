import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    await db.execute(sql`SELECT * FROM non_existent_table`);
  } catch (err: any) {
    console.error('--- ERROR OBJECT ---');
    console.error(err);
    console.error('--- ERROR STACK ---');
    console.error(err.stack);
  }
  process.exit(0);
}
main();
