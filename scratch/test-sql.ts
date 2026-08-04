import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function run() {
  try {
    const q = `
      SELECT 
        id,
        COALESCE(
          NULLIF(TRIM(conversation_name), ''),
          NULLIF(TRIM(customer_name), ''),
          NULLIF(TRIM(customer), ''),
          NULLIF(TRIM(ownername), ''),
          'Customer'
        ) AS "customerName",
        COALESCE(
          NULLIF(TRIM(phone_num), ''),
          NULLIF(TRIM(phone_no), ''),
          NULLIF(TRIM(full_phone_number), ''),
          NULLIF(TRIM(user_id), ''),
          '—'
        ) AS "mobileNumber",
        COALESCE(
          NULLIF(TRIM(source), ''),
          NULLIF(TRIM(lead_source), ''),
          NULLIF(TRIM(enquiry_source), ''),
          'Social Media'
        ) AS "source",
        COALESCE(NULLIF(TRIM(model), ''), '—') AS "model",
        COALESCE(NULLIF(TRIM(variant), ''), '—') AS "variant",
        COALESCE(NULLIF(TRIM(colour), ''), '—') AS "colour",
        COALESCE(NULLIF(TRIM(fuel_type), ''), '—') AS "fuelType",
        COALESCE(NULLIF(TRIM(location), ''), NULLIF(TRIM(city), ''), '—') AS "location",
        COALESCE(NULLIF(TRIM(address), ''), '—') AS "address",
        COALESCE(NULLIF(TRIM(whatsapp_opted), ''), '—') AS "whatsappOpted",
        COALESCE(NULLIF(TRIM(vin), ''), NULLIF(TRIM(vin_no), ''), '—') AS "vin",
        COALESCE(NULLIF(TRIM(registration_no), ''), NULLIF(TRIM(reg_no), ''), NULLIF(TRIM(car_reg), ''), '—') AS "registrationNo",
        date_of_enquiry AS "dateOfEnquiry",
        booking_date AS "bookingDate",
        COALESCE(NULLIF(TRIM(consultant_name), ''), '—') AS "consultantName",
        COALESCE(NULLIF(TRIM(manager_name), ''), '—') AS "managerName",
        COALESCE(NULLIF(TRIM(tl_name), ''), '—') AS "tlName",
        COALESCE(NULLIF(TRIM(bank_finance), ''), '—') AS "bankFinance",
        booking_amount AS "bookingAmount",
        COALESCE(NULLIF(TRIM(latest_requirement), ''), '—') AS "latestRequirement",
        cre_remark AS "creRemark",
        kec_remark AS "kecRemark",
        followup_status AS "followupStatus",
        status AS "rawStatus",
        row_hash AS "rowHash",
        COALESCE(NULLIF(TRIM(conversation_name), ''), '—') AS "conversationName",
        COALESCE(
          NULLIF(TRIM(phone_num), ''),
          NULLIF(TRIM(phone_no), ''),
          NULLIF(TRIM(full_phone_number), ''),
          NULLIF(TRIM(user_id), ''),
          '—'
        ) AS "contact",
        chat_transcript AS "chatTranscript",
        COALESCE(message_count, 0) AS "messageCount",
        first_message AS "firstMessage",
        last_message AS "lastMessage",
        lead_age AS "leadAge",
        assigned_to AS "assignedTo",
        tags AS "tags",
        notes AS "notes",
        ad_url AS "adUrl",
        created_at AS "createdAt",
        uploaded_at AS "uploadedAt",
        updated_at AS "updatedAt"
      FROM social_media_leads
      ORDER BY uploaded_at DESC NULLS LAST, id DESC
    `
    const res = await db.execute(sql.raw(q))
    console.log('SUCCESS: FETCHED ROWS =', Array.isArray(res) ? res.length : (res as any).rows?.length)
    process.exit(0)
  } catch (err: any) {
    console.error('EXACT_CAUSE:', err?.cause?.message || err?.cause || err)
    process.exit(1)
  }
}

run()
