import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

export const dynamic = 'force-dynamic'

function isAuthorized(role?: string | null): boolean {
  const r = String(role || '').toLowerCase().trim()
  return ['md', 'developer', 'admin'].includes(r)
}

export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAuthorized(appUser.role)) {
      return NextResponse.json(
        { error: 'Access restricted to MD and Developer roles during testing.' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const statusFilter = searchParams.get('status') || 'All'

    /*
     * ⚠️ ONE ROW PER CONVERSATION — the feed re-inserts the same chat every few minutes.
     *
     * The external ingester re-polls Interakt roughly every 10 minutes and INSERTs whatever it
     * finds. The table's UNIQUE row_hash index cannot stop it, because `chat_transcript` embeds a
     * freshly generated UUID per message on every export, so the content hash never collides.
     *
     * Measured: 69 rows are 24 real conversations. One lead ("Darkness") occupied 24 of those 69
     * rows on its own — 24 uploads at ~10-minute intervals, identical message_count, identical
     * first_message, differing only inside the transcript's UUID tokens. Every headline on the
     * screen was inflated: Total Leads 69 -> 24, From Ad 27 -> 19, Customer Initiated 61 -> 22.
     *
     * DISTINCT ON keeps the newest upload per conversation, which is also the most COMPLETE one: a
     * chat that grows between polls (5 messages, then 7) would otherwise appear as two leads, and
     * the later snapshot is the one you want.
     *
     * ⚠️ The key is the conversation NAME, because it is the only stable identifier this feed
     * carries — phone_num, phone_no, full_phone_number and user_id are empty on all 69 rows. Two
     * different people sharing a WhatsApp display name would therefore merge. That is a real limit
     * of the source, accepted deliberately: the alternative is a screen that overstates every lead
     * count by ~2.9x.
     *
     * This is a READ-side fix. The rows keep accumulating; the correct repair is upstream, in the
     * ingester's hash (it must exclude the transcript, or key on the conversation).
     */
    const rows = await db.execute(sql.raw(`
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(conversation_name), ''), 'lead-' || id::text))
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
      /*
       * DISTINCT ON requires its expression to lead the ORDER BY. The outer ordering the UI expects
       * (newest first) is re-applied in JS below, because it cannot be expressed here.
       *
       * A row with no conversation_name falls back to its own id, so it is never merged with another
       * nameless row — an unnamed lead is not evidence that two rows are the same chat.
       */
      ORDER BY COALESCE(NULLIF(TRIM(conversation_name), ''), 'lead-' || id::text),
               uploaded_at DESC NULLS LAST, id DESC
    `))

    const allLeads = (rows as unknown as Record<string, unknown>[]) || []

    /*
     * Newest first, restored. DISTINCT ON forces its own key to lead the ORDER BY, so the display
     * order the UI expects cannot be expressed in the same statement. The set is ~24 rows, so
     * sorting here costs nothing.
     */
    allLeads.sort((a, b) => {
      const at = new Date(String(a.uploadedAt ?? 0)).getTime() || 0
      const bt = new Date(String(b.uploadedAt ?? 0)).getTime() || 0
      if (bt !== at) return bt - at
      return Number(b.id ?? 0) - Number(a.id ?? 0)
    })

    // Calculate metrics
    let interestedCount = 0
    let notInterestedCount = 0
    let pendingCount = 0
    let fromAdCount = 0
    let customerInitiatedCount = 0
    let weInitiatedCount = 0

    allLeads.forEach(lead => {
      const fs = String(lead.followupStatus || '').trim()
      if (fs === 'Interested') interestedCount++
      else if (fs === 'Not Interested') notInterestedCount++
      else pendingCount++

      if (lead.adUrl && String(lead.adUrl).trim().length > 0) {
        fromAdCount++
      }

      const transcript = String(lead.chatTranscript || '').trim()
      const firstMsg = String(lead.firstMessage || '').trim()
      if (transcript.startsWith('[in') || firstMsg.startsWith('[in')) {
        customerInitiatedCount++
      } else if (transcript.startsWith('[out') || firstMsg.startsWith('[out')) {
        weInitiatedCount++
      }
    })

    // Filter leads based on search and statusFilter
    const filtered = allLeads.filter(lead => {
      const fs = String(lead.followupStatus || '').trim()
      if (statusFilter === 'Interested' && fs !== 'Interested') return false
      if (statusFilter === 'Not Interested' && fs !== 'Not Interested') return false
      if (statusFilter === 'Pending' && (fs === 'Interested' || fs === 'Not Interested')) return false

      if (search) {
        const q = search.toLowerCase()
        const name = String(lead.customerName || '').toLowerCase()
        const mobile = String(lead.mobileNumber || '').toLowerCase()
        const modelName = String(lead.model || '').toLowerCase()
        const loc = String(lead.location || '').toLowerCase()
        const src = String(lead.source || '').toLowerCase()

        return (
          name.includes(q) ||
          mobile.includes(q) ||
          modelName.includes(q) ||
          loc.includes(q) ||
          src.includes(q)
        )
      }

      return true
    })

    return NextResponse.json({
      metrics: {
        totalLeads: allLeads.length,
        interested: interestedCount,
        notInterested: notInterestedCount,
        pending: pendingCount,
        fromAd: fromAdCount,
        customerInitiated: customerInitiatedCount,
        weInitiated: weInitiatedCount,
      },
      leads: filtered,
    })
  } catch (error) {
    console.error('Failed to fetch testing social media leads:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch social media leads' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAuthorized(appUser.role)) {
      return NextResponse.json(
        { error: 'Access restricted to MD and Developer roles during testing.' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const id = Number(body.id)
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Invalid lead ID' }, { status: 400 })
    }

    const { followupStatus, remarkType, remarkText } = body

    const updates: string[] = ['updated_at = NOW()']

    if (followupStatus !== undefined) {
      const fs = String(followupStatus).trim()
      if (fs === 'Interested' || fs === 'Not Interested') {
        updates.push(`followup_status = '${fs}'`)
      } else if (fs === '') {
        updates.push(`followup_status = NULL`)
      }
    }

    if (remarkType && remarkText !== undefined) {
      const type = String(remarkType).toUpperCase().trim()
      const text = String(remarkText).replace(/'/g, "''").trim()

      if (type === 'CRE') {
        updates.push(`cre_remark = '${text}'`)
      } else if (type === 'KEC') {
        updates.push(`kec_remark = '${text}'`)
      }
    }

    if (updates.length > 1) {
      await db.execute(sql.raw(`
        UPDATE social_media_leads
        SET ${updates.join(', ')}
        WHERE id = ${id}
      `))
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update social media lead:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update social media lead' },
      { status: 500 }
    )
  }
}
