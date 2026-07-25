import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function findOrder() {
  console.log('--- FINDING PETTY CASH ORDERS APPROVED YESTERDAY BY GENERAL SALES MANAGER ---')

  const history = await db.execute(sql`
    SELECT h.id, h.request_id, h.action, h.stage, h.previous_status, h.new_status, h.performed_by, h.created_at,
           u.full_name as actor_name, u.role as actor_role, u.email as actor_email,
           r.request_number, r.requested_by_name, r.status as current_status, r.current_stage as current_stage,
           r.requested_amount, r.purpose, r.created_at as request_created_at
    FROM petty_cash_approval_history h
    LEFT JOIN users u ON u.id = h.performed_by
    LEFT JOIN petty_cash_requests r ON r.id = h.request_id
    WHERE h.created_at >= '2026-07-24 00:00:00+00'
    ORDER BY h.created_at DESC
  `)

  console.log('History entries found:', (history as any[]).length)
  console.log(JSON.stringify(history, null, 2))

  process.exit(0)
}

findOrder().catch((err) => {
  console.error(err)
  process.exit(1)
})
