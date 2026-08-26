import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type CrmDisposition =
  | 'PENDING'
  | 'INTERESTED'
  | 'FOLLOWUP_SCHEDULED'
  | 'RENEWED_WON'
  | 'LOST_COMPETITOR'
  | 'LOST_PRICE'
  | 'LOST_ONLINE'
  | 'SOLD_VEHICLE'
  | 'WRONG_NUMBER'
  | 'NOT_INTERESTED'

export type InsuranceCrmRecord = {
  id: number
  chassisNo: string
  policyNo: string | null
  customerName: string | null
  phone: string | null
  disposition: CrmDisposition
  lossReason: string | null
  competitorDestination: string | null
  remarks: string | null
  followUpDate: string | null
  calledBy: string | null
  updatedAt: string
}

let tableInitialized = false

export async function ensureInsuranceCrmTable() {
  if (tableInitialized) return
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS insurance_crm_followups (
        id SERIAL PRIMARY KEY,
        chassis_no TEXT NOT NULL,
        policy_no TEXT,
        customer_name TEXT,
        phone TEXT,
        disposition TEXT NOT NULL DEFAULT 'PENDING',
        loss_reason TEXT,
        competitor_destination TEXT,
        remarks TEXT,
        follow_up_date DATE,
        called_by TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS insurance_crm_followups_chassis_idx ON insurance_crm_followups (chassis_no);
    `)
    tableInitialized = true
  } catch (err) {
    console.error('Failed to ensure insurance_crm_followups table:', err)
  }
}

export async function getCrmRecords(): Promise<Record<string, InsuranceCrmRecord>> {
  await ensureInsuranceCrmTable()
  try {
    const res: any = await db.execute(sql`
      SELECT 
        id,
        chassis_no as "chassisNo",
        policy_no as "policyNo",
        customer_name as "customerName",
        phone,
        disposition,
        loss_reason as "lossReason",
        competitor_destination as "competitorDestination",
        remarks,
        to_char(follow_up_date, 'YYYY-MM-DD') as "followUpDate",
        called_by as "calledBy",
        to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') as "updatedAt"
      FROM insurance_crm_followups
    `)
    const records: Record<string, InsuranceCrmRecord> = {}
    const list = Array.isArray(res) ? res : res.rows || []
    for (const r of list) {
      if (r.chassisNo) {
        records[r.chassisNo] = r
      }
    }
    return records
  } catch (err) {
    console.error('Failed to fetch CRM records:', err)
    return {}
  }
}

export async function saveCrmRecord(payload: {
  chassisNo: string
  policyNo?: string | null
  customerName?: string | null
  phone?: string | null
  disposition: CrmDisposition
  lossReason?: string | null
  competitorDestination?: string | null
  remarks?: string | null
  followUpDate?: string | null
  calledBy?: string | null
}) {
  await ensureInsuranceCrmTable()
  const followUpDateSql = payload.followUpDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.followUpDate)
    ? sql`${payload.followUpDate}::date`
    : sql`NULL`

  await db.execute(sql`
    INSERT INTO insurance_crm_followups (
      chassis_no,
      policy_no,
      customer_name,
      phone,
      disposition,
      loss_reason,
      competitor_destination,
      remarks,
      follow_up_date,
      called_by,
      updated_at
    ) VALUES (
      ${payload.chassisNo},
      ${payload.policyNo || null},
      ${payload.customerName || null},
      ${payload.phone || null},
      ${payload.disposition},
      ${payload.lossReason || null},
      ${payload.competitorDestination || null},
      ${payload.remarks || null},
      ${followUpDateSql},
      ${payload.calledBy || null},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (chassis_no) DO UPDATE SET
      policy_no = COALESCE(EXCLUDED.policy_no, insurance_crm_followups.policy_no),
      customer_name = COALESCE(EXCLUDED.customer_name, insurance_crm_followups.customer_name),
      phone = COALESCE(EXCLUDED.phone, insurance_crm_followups.phone),
      disposition = EXCLUDED.disposition,
      loss_reason = EXCLUDED.loss_reason,
      competitor_destination = EXCLUDED.competitor_destination,
      remarks = EXCLUDED.remarks,
      follow_up_date = EXCLUDED.follow_up_date,
      called_by = EXCLUDED.called_by,
      updated_at = CURRENT_TIMESTAMP
  `)
}
