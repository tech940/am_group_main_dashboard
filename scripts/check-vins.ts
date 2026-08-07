import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

const vins = [
  'MZBEA812LTN062243',
  'MZBEA812LTN071847',
  'MZBFB812LTN675477',
  'MZBFB812LTN676731',
  'MZBEB812LTN040281',
  'MZBGB814LTN324331',
  'MZBEA812LTN073365',
  'MZBEB812LTN052773',
  'MZBGB815LTN334138',
  'MZBFB812LTN676691',
  'MZBFB812LTN668504',
  'MZBFB812LTN677286',
  'MZBEA812LTN068521',
  'MZBEB812TTN072246',
  'MZBFB812LTN666221',
  'MZBGB814LTN321467',
  'MZBEB812LTN072817',
  'MZBEA812LTN071889',
  'MZBEA812LTN077367',
  'MZBEA812LTN068883',
  'MZBEA812LTN077310',
]

async function run() {
  console.log('--- INSPECTING KIA PROFORMAS COLUMNS ---')
  const proformaCols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'kia_proformas'`)
  console.log('kia_proformas columns:', proformaCols.map((c: any) => c.column_name).join(', '))
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
