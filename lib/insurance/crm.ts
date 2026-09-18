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
  brand?: string | null
  policyNo: string | null
  customerName: string | null
  phone: string | null
  registrationNo?: string | null
  model?: string | null
  variant?: string | null
  insuranceCompany?: string | null
  dealerCode?: string | null
  expiryDate?: string | null
  lastPremium?: number | null
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
    // 1. Ensure master active status table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS insurance_crm_followups (
        id SERIAL PRIMARY KEY,
        chassis_no TEXT NOT NULL,
        brand TEXT,
        policy_no TEXT,
        customer_name TEXT,
        phone TEXT,
        registration_no TEXT,
        model TEXT,
        variant TEXT,
        insurance_company TEXT,
        dealer_code TEXT,
        expiry_date DATE,
        last_premium NUMERIC,
        disposition TEXT NOT NULL DEFAULT 'PENDING',
        loss_reason TEXT,
        competitor_destination TEXT,
        remarks TEXT,
        follow_up_date DATE,
        called_by TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS insurance_crm_followups_chassis_idx ON insurance_crm_followups (UPPER(TRIM(chassis_no)));
      
      -- Schema migrations for existing tables
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS brand TEXT;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS registration_no TEXT;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS model TEXT;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS variant TEXT;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS insurance_company TEXT;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS dealer_code TEXT;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS expiry_date DATE;
      ALTER TABLE insurance_crm_followups ADD COLUMN IF NOT EXISTS last_premium NUMERIC;

      -- 2. Ensure immutable historical call log table (permanent audit trail)
      CREATE TABLE IF NOT EXISTS insurance_crm_call_logs (
        id SERIAL PRIMARY KEY,
        chassis_no TEXT NOT NULL,
        brand TEXT,
        policy_no TEXT,
        customer_name TEXT,
        phone TEXT,
        disposition TEXT NOT NULL,
        loss_reason TEXT,
        competitor_destination TEXT,
        remarks TEXT,
        follow_up_date DATE,
        called_by TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS insurance_crm_call_logs_chassis_idx ON insurance_crm_call_logs (UPPER(TRIM(chassis_no)));
      CREATE INDEX IF NOT EXISTS insurance_crm_call_logs_created_idx ON insurance_crm_call_logs (created_at DESC);
    `)
    tableInitialized = true
  } catch (err) {
    console.error('Failed to ensure insurance CRM tables:', err)
  }
}

export async function getCrmRecords(): Promise<Record<string, InsuranceCrmRecord>> {
  await ensureInsuranceCrmTable()
  try {
    const res: any = await db.execute(sql`
      SELECT 
        id,
        UPPER(TRIM(chassis_no)) as "chassisNo",
        brand,
        policy_no as "policyNo",
        customer_name as "customerName",
        phone,
        registration_no as "registrationNo",
        model,
        variant,
        insurance_company as "insuranceCompany",
        dealer_code as "dealerCode",
        to_char(expiry_date, 'YYYY-MM-DD') as "expiryDate",
        last_premium as "lastPremium",
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
        const key = String(r.chassisNo).trim().toUpperCase()
        records[key] = {
          ...r,
          lastPremium: r.lastPremium !== null && r.lastPremium !== undefined ? Number(r.lastPremium) : null,
        }
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
  brand?: string | null
  policyNo?: string | null
  customerName?: string | null
  phone?: string | null
  registrationNo?: string | null
  model?: string | null
  variant?: string | null
  insuranceCompany?: string | null
  dealerCode?: string | null
  expiryDate?: string | null
  lastPremium?: number | null
  disposition: CrmDisposition
  lossReason?: string | null
  competitorDestination?: string | null
  remarks?: string | null
  followUpDate?: string | null
  calledBy?: string | null
}) {
  await ensureInsuranceCrmTable()
  const cleanChassis = payload.chassisNo.trim().toUpperCase()
  const followUpDateSql = payload.followUpDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.followUpDate)
    ? sql`${payload.followUpDate}::date`
    : sql`NULL`
  const expiryDateSql = payload.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.expiryDate)
    ? sql`${payload.expiryDate}::date`
    : sql`NULL`

  // 1. Upsert active follow-up state (with full snapshot so it is never orphaned)
  await db.execute(sql`
    INSERT INTO insurance_crm_followups (
      chassis_no,
      brand,
      policy_no,
      customer_name,
      phone,
      registration_no,
      model,
      variant,
      insurance_company,
      dealer_code,
      expiry_date,
      last_premium,
      disposition,
      loss_reason,
      competitor_destination,
      remarks,
      follow_up_date,
      called_by,
      updated_at
    ) VALUES (
      ${cleanChassis},
      ${payload.brand || null},
      ${payload.policyNo || null},
      ${payload.customerName || null},
      ${payload.phone || null},
      ${payload.registrationNo || null},
      ${payload.model || null},
      ${payload.variant || null},
      ${payload.insuranceCompany || null},
      ${payload.dealerCode || null},
      ${expiryDateSql},
      ${payload.lastPremium ?? null},
      ${payload.disposition},
      ${payload.lossReason || null},
      ${payload.competitorDestination || null},
      ${payload.remarks || null},
      ${followUpDateSql},
      ${payload.calledBy || null},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (UPPER(TRIM(chassis_no))) DO UPDATE SET
      brand = COALESCE(EXCLUDED.brand, insurance_crm_followups.brand),
      policy_no = COALESCE(EXCLUDED.policy_no, insurance_crm_followups.policy_no),
      customer_name = COALESCE(EXCLUDED.customer_name, insurance_crm_followups.customer_name),
      phone = COALESCE(EXCLUDED.phone, insurance_crm_followups.phone),
      registration_no = COALESCE(EXCLUDED.registration_no, insurance_crm_followups.registration_no),
      model = COALESCE(EXCLUDED.model, insurance_crm_followups.model),
      variant = COALESCE(EXCLUDED.variant, insurance_crm_followups.variant),
      insurance_company = COALESCE(EXCLUDED.insurance_company, insurance_crm_followups.insurance_company),
      dealer_code = COALESCE(EXCLUDED.dealer_code, insurance_crm_followups.dealer_code),
      expiry_date = COALESCE(EXCLUDED.expiry_date, insurance_crm_followups.expiry_date),
      last_premium = COALESCE(EXCLUDED.last_premium, insurance_crm_followups.last_premium),
      disposition = EXCLUDED.disposition,
      loss_reason = EXCLUDED.loss_reason,
      competitor_destination = EXCLUDED.competitor_destination,
      remarks = EXCLUDED.remarks,
      follow_up_date = EXCLUDED.follow_up_date,
      called_by = EXCLUDED.called_by,
      updated_at = CURRENT_TIMESTAMP
  `)

  // 2. Append to immutable history log
  try {
    await db.execute(sql`
      INSERT INTO insurance_crm_call_logs (
        chassis_no,
        brand,
        policy_no,
        customer_name,
        phone,
        disposition,
        loss_reason,
        competitor_destination,
        remarks,
        follow_up_date,
        called_by
      ) VALUES (
        ${cleanChassis},
        ${payload.brand || null},
        ${payload.policyNo || null},
        ${payload.customerName || null},
        ${payload.phone || null},
        ${payload.disposition},
        ${payload.lossReason || null},
        ${payload.competitorDestination || null},
        ${payload.remarks || null},
        ${followUpDateSql},
        ${payload.calledBy || null}
      )
    `)
  } catch (err) {
    console.error('Failed to append to insurance_crm_call_logs:', err)
  }
}

