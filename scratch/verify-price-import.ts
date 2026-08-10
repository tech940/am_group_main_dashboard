import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

// Hand-picked cells from the workbook, one per sheet, checked against what the DB now holds.
const SPOT_CHECKS = [
  { model: 'New Seltos Petrol', trim: 'Seltos G1.5 6MT HTE', ex: 1099900, tcs: 10999, reg: 98991, ins: 48436 },
  { model: 'New Seltos Diesel', trim: 'Seltos D1.5 6MT HTE', ex: 1293900, tcs: 12939, reg: 116451, ins: 54265 },
  { model: 'Sonet Petrol', trim: 'Sonet G1.2 5MT HTE', ex: 740900, tcs: 0, reg: 66681, ins: 36323 },
  { model: 'Sonet Diesel', trim: 'Sonet D1.5 6AT HTE(O)', ex: 999900, tcs: 0, reg: 89991, ins: 43642 },
  { model: 'Carens', trim: 'Carens Clavis G1.5 6MT HTE7', ex: 1126900, tcs: 11269, reg: 101421, ins: 46022 },
  { model: 'Syros Petrol', trim: 'Syros G1.0T 6MT HTE', ex: 841900, tcs: 0, reg: 75771, ins: 32323 },
  { model: 'Syros Diesel', trim: 'Syros D1.5 6AT HTX', ex: 1481900, tcs: 14819, reg: 133371, ins: 55671 },
  { model: 'Carnival', trim: 'Kia Carnival D2.2 8AT Limousine Plus', ex: 5964900, tcs: 59649, reg: 536841, ins: 210682 },
  { model: 'CARENS CLAVIS EV', trim: 'Carens Clavis EV ER GTX 7', ex: 2300500, tcs: 23005, reg: 650, ins: 77503.64 },
]

async function main() {
  let fails = 0
  for (const c of SPOT_CHECKS) {
    const [row] = rows(await db.execute(sql`
      SELECT ex_showroom_price::float AS ex, tcs::float AS tcs, registration_charges::float AS reg, insurance::float AS ins
      FROM kia_price_details WHERE model = ${c.model} AND trim_description = ${c.trim} LIMIT 1`))
    if (!row) { console.log(`[FAIL] ${c.model} | ${c.trim} — row missing`); fails++; continue }
    const near = (a: number, b: number) => Math.abs(a - b) < 1
    const ok = near(Number(row.ex), c.ex) && near(Number(row.tcs), c.tcs) && near(Number(row.reg), c.reg) && near(Number(row.ins), c.ins)
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.model} | ${c.trim} ex=${row.ex} tcs=${row.tcs} reg=${row.reg} ins=${row.ins}`)
    if (!ok) fails++
  }

  // Change summary vs the pre-import backup
  const backup = JSON.parse(readFileSync('scratch/price-details-backup-2026-08-10.json', 'utf8')) as Record<string, unknown>[]
  const oldMap = new Map(backup.map((r) => [`${r.model}|${r.trim_description}|${(r.metadata as Record<string, unknown>)?.colour ?? ''}`, Number(r.ex_showroom_price)]))
  const current = rows(await db.execute(sql`
    SELECT model, trim_description, metadata->>'colour' AS colour, ex_showroom_price::float AS ex
    FROM kia_price_details WHERE model NOT LIKE '\\_\\_%'`))
  let changed = 0, added = 0, same = 0
  for (const r of current) {
    const key = `${r.model}|${r.trim_description}|${r.colour ?? ''}`
    const old = oldMap.get(key)
    if (old === undefined) added++
    else if (Math.abs(old - Number(r.ex)) >= 1) changed++
    else same++
  }
  const removed = backup.length - (current.length - added)
  console.log(`\nchange summary (by ex-showroom): unchanged=${same} changed=${changed} newTrims=${added} removedTrims=${removed}`)
  if (fails) process.exit(1)
  console.log('ALL SPOT CHECKS PASSED')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
