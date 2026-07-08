import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsDb } from '@/lib/analytics/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

type FreshnessResult = {
  table: string
  label: string
  lastUpdated: string | null
  rowCount: number
}

async function queryAppTable(table: string, label: string, dateCol: string): Promise<FreshnessResult> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT 
        MAX("${dateCol}") AS "lastUpdated",
        COUNT(*)::int AS "rowCount"
      FROM "${table}"
    `))
    return {
      table,
      label,
      lastUpdated: result[0]?.lastUpdated ? String(result[0].lastUpdated) : null,
      rowCount: Number(result[0]?.rowCount || 0),
    }
  } catch (error) {
    console.error(`Failed to query app table ${table}:`, error)
    return { table, label, lastUpdated: null, rowCount: 0 }
  }
}

async function queryAnalyticsTable(table: string, label: string, dateCol: string): Promise<FreshnessResult> {
  try {
    const result = await analyticsDb.execute(sql.raw(`
      SELECT 
        MAX("${dateCol}") AS "lastUpdated",
        COUNT(*)::int AS "rowCount"
      FROM "${table}"
    `))
    return {
      table,
      label,
      lastUpdated: result[0]?.lastUpdated ? String(result[0].lastUpdated) : null,
      rowCount: Number(result[0]?.rowCount || 0),
    }
  } catch (error) {
    console.error(`Failed to query analytics table ${table}:`, error)
    return { table, label, lastUpdated: null, rowCount: 0 }
  }
}

export async function GET() {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !actorCapabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const [kiaAnalytics, hyundaiAnalytics, platinumAnalytics, kiaApp] = await Promise.all([
      // Kia Analytics
      Promise.all([
        queryAnalyticsTable('ro_billing_report', 'RO Billing', 'uploaded_at'),
        queryAnalyticsTable('open_ro_yearly', 'Open RO', 'uploaded_at'),
        queryAnalyticsTable('kia_call_center_complaints', 'Complaints', 'uploaded_at'),
        queryAnalyticsTable('operation_wise_analysis_report', 'Operation Analysis', 'uploaded_at'),
        queryAnalyticsTable('ew_report', 'Extended Warranty', 'uploaded_at'),
        queryAnalyticsTable('rsa_report', 'RSA', 'uploaded_at'),
        queryAnalyticsTable('mcp_report', 'MCP', 'uploaded_at'),
      ]),
      // Hyundai Analytics
      Promise.all([
        queryAnalyticsTable('hyundai_ro_billing_report', 'RO Billing', 'uploaded_at'),
        queryAnalyticsTable('hyundai_repair_order_list', 'Open RO', 'uploaded_at'),
        queryAnalyticsTable('hyundai_call_center_complaints', 'Complaints', 'uploaded_at'),
        queryAnalyticsTable('hyundai_operation_wise_analysis_report', 'Operation Analysis', 'uploaded_at'),
        queryAnalyticsTable('hyundai_ew_report', 'Extended Warranty', 'uploaded_at'),
      ]),
      // Platinum Analytics
      Promise.all([
        queryAnalyticsTable('am_platinum_ro_billing_report', 'RO Billing', 'uploaded_at'),
        queryAnalyticsTable('am_platinum_repair_order_list', 'Open RO', 'uploaded_at'),
        queryAnalyticsTable('am_platinum_call_center_complaints', 'Complaints', 'uploaded_at'),
        queryAnalyticsTable('am_platinum_operation_wise_analysis_report', 'Operation Analysis', 'uploaded_at'),
        queryAnalyticsTable('am_platinum_ew_report', 'Extended Warranty', 'uploaded_at'),
      ]),
      // Kia App DB
      Promise.all([
        queryAppTable('kia_stock_management', 'Vehicle Stock Inventory', 'uploaded_at'),
        queryAppTable('kia_bookings', 'Bookings List', 'updated_at'),
        queryAppTable('kia_vehicle_allocations', 'Vehicle Journey Allocations', 'created_at'),
      ])
    ])

    return NextResponse.json({
      actorCapabilities,
      kia: [...kiaApp, ...kiaAnalytics],
      hyundai: hyundaiAnalytics,
      platinum: platinumAnalytics,
    })
  } catch (error) {
    console.error('GET /api/admin/data-freshness failed:', error)
    return NextResponse.json({ error: 'Failed to load data freshness logs.' }, { status: 500 })
  }
}
