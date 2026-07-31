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

    // Fetch leads that have a non-empty mobile number
    const rows = await db.execute(sql.raw(`
      SELECT 
        id,
        COALESCE(
          NULLIF(TRIM(customer_name), ''),
          NULLIF(TRIM(conversation_name), ''),
          NULLIF(TRIM(customer), ''),
          NULLIF(TRIM(ownername), ''),
          'Customer'
        ) AS "customerName",
        COALESCE(
          NULLIF(TRIM(phone_num), ''),
          NULLIF(TRIM(phone_no), ''),
          NULLIF(TRIM(full_phone_number), ''),
          NULLIF(TRIM(user_id), '')
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
        COALESCE(NULLIF(TRIM(location), ''), NULLIF(TRIM(city), ''), NULLIF(TRIM(area), ''), '—') AS "location",
        COALESCE(NULLIF(TRIM(address), ''), '—') AS "address",
        COALESCE(NULLIF(TRIM(whatsapp_opted), ''), '—') AS "whatsappOpted",
        COALESCE(NULLIF(TRIM(vin), ''), NULLIF(TRIM(vin_num), ''), NULLIF(TRIM(vin_number), ''), '—') AS "vin",
        COALESCE(NULLIF(TRIM(registration_no), ''), NULLIF(TRIM(registration_number), ''), NULLIF(TRIM(car_reg), ''), '—') AS "registrationNo",
        date_of_enquiry AS "dateOfEnquiry",
        COALESCE(booking_date, vehicle_boking_date) AS "bookingDate",
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
        created_at AS "createdAt",
        uploaded_at AS "uploadedAt",
        updated_at AS "updatedAt"
      FROM social_media_leads
      WHERE COALESCE(
        NULLIF(TRIM(phone_num), ''),
        NULLIF(TRIM(phone_no), ''),
        NULLIF(TRIM(full_phone_number), ''),
        NULLIF(TRIM(user_id), '')
      ) IS NOT NULL
      ORDER BY uploaded_at DESC NULLS LAST, id DESC
    `))

    const allLeads = (rows as unknown as Record<string, unknown>[]) || []

    // Calculate metrics
    let interestedCount = 0
    let notInterestedCount = 0
    let pendingCount = 0

    allLeads.forEach(lead => {
      const fs = String(lead.followupStatus || '').trim()
      if (fs === 'Interested') interestedCount++
      else if (fs === 'Not Interested') notInterestedCount++
      else pendingCount++
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
