import 'server-only'

import nodemailer from 'nodemailer'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dashboardSettings } from '@/lib/db/schema'
import { buildKiaServiceDashboardExport } from '@/lib/kia/service-dashboard-export'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

export const SERVICE_DASHBOARD_EMAIL_SETTINGS_KEY = 'serviceDashboardEmailSettings'

export type ServiceDashboardEmailSettings = {
  enabled: boolean
  recipients: string[]
  cc: string[]
  bcc: string[]
  defaultDealerCode: string | null
  sendTime: string
  timezone: string
}

export type SendServiceDashboardEmailInput = {
  brand?: 'kia'
  reportKey?: 'service-dashboard'
  endDate?: string | null
  dealerCode?: string | null
  recipients?: string[]
  cc?: string[]
  bcc?: string[]
  trigger?: 'manual' | 'scheduler'
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const DEFAULT_SERVICE_DASHBOARD_EMAIL_SETTINGS: ServiceDashboardEmailSettings = {
  enabled: false,
  recipients: [],
  cc: [],
  bcc: [],
  defaultDealerCode: null,
  sendTime: '19:00',
  timezone: 'Asia/Kolkata',
}

function cleanEmailList(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;]/)

  return Array.from(new Set(values
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)))
}

export function validateEmailList(values: string[]) {
  return values.filter((email) => !EMAIL_PATTERN.test(email))
}

export function normalizeServiceDashboardEmailSettings(value: unknown): ServiceDashboardEmailSettings {
  const source = value && typeof value === 'object' ? value as Partial<ServiceDashboardEmailSettings> : {}
  const sendTime = typeof source.sendTime === 'string' && /^\d{2}:\d{2}$/.test(source.sendTime)
    ? source.sendTime
    : DEFAULT_SERVICE_DASHBOARD_EMAIL_SETTINGS.sendTime

  return {
    enabled: Boolean(source.enabled),
    recipients: cleanEmailList(source.recipients),
    cc: cleanEmailList(source.cc),
    bcc: cleanEmailList(source.bcc),
    defaultDealerCode: normalizeKiaDealerCode(source.defaultDealerCode || null),
    sendTime,
    timezone: source.timezone || DEFAULT_SERVICE_DASHBOARD_EMAIL_SETTINGS.timezone,
  }
}

export async function getServiceDashboardEmailSettings() {
  const [row] = await db
    .select({ value: dashboardSettings.value })
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, SERVICE_DASHBOARD_EMAIL_SETTINGS_KEY))
    .limit(1)

  return normalizeServiceDashboardEmailSettings(row?.value)
}

function getMailerTransport() {
  const user = process.env.REPORT_MAIL_GMAIL_USER
  const pass = process.env.REPORT_MAIL_GMAIL_APP_PASSWORD

  if (!user || !pass) {
    throw new Error('Report email is not configured. Set REPORT_MAIL_GMAIL_USER and REPORT_MAIL_GMAIL_APP_PASSWORD.')
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

export async function sendServiceDashboardEmail(input: SendServiceDashboardEmailInput = {}) {
  if (input.brand && input.brand !== 'kia') {
    throw new Error(`Unsupported service dashboard brand: ${input.brand}`)
  }
  if (input.reportKey && input.reportKey !== 'service-dashboard') {
    throw new Error(`Unsupported service dashboard report: ${input.reportKey}`)
  }

  const settings = await getServiceDashboardEmailSettings()
  const recipients = cleanEmailList(input.recipients?.length ? input.recipients : settings.recipients)
  const cc = cleanEmailList(input.cc?.length ? input.cc : settings.cc)
  const bcc = cleanEmailList(input.bcc?.length ? input.bcc : settings.bcc)
  const invalidEmails = validateEmailList([...recipients, ...cc, ...bcc])

  if (invalidEmails.length > 0) {
    throw new Error(`Invalid email address${invalidEmails.length > 1 ? 'es' : ''}: ${invalidEmails.join(', ')}`)
  }
  if (recipients.length === 0) {
    throw new Error('Add at least one Service Dashboard email recipient in Admin Settings.')
  }

  const dealerCode = normalizeKiaDealerCode(input.dealerCode || settings.defaultDealerCode)
  const exportResult = await buildKiaServiceDashboardExport({
    endDate: input.endDate,
    dealerCode,
  })
  const transport = getMailerTransport()
  const fromName = process.env.REPORT_MAIL_FROM_NAME || 'AM Dashboard Reports'
  const mailUser = process.env.REPORT_MAIL_GMAIL_USER || ''
  const attachment = Buffer.from(new Uint8Array(exportResult.buffer))
  const dealerLabel = dealerCode ? `Dealer ${dealerCode}` : 'All KIA locations'

  const info = await transport.sendMail({
    from: `"${fromName}" <${mailUser}>`,
    to: recipients,
    cc,
    bcc,
    subject: `AM KIA Service Dashboard - ${exportResult.metrics.exportDate}`,
    text: [
      `AM KIA Service Dashboard for ${exportResult.metrics.exportDate}`,
      `Scope: ${dealerLabel}`,
      '',
      'The Excel report is attached.',
    ].join('\n'),
    html: `
      <p><strong>AM KIA Service Dashboard</strong></p>
      <p>Date: ${exportResult.metrics.exportDate}<br/>Scope: ${dealerLabel}</p>
      <p>The Excel report is attached.</p>
    `,
    attachments: [{
      filename: exportResult.fileName,
      content: attachment,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  })

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    fileName: exportResult.fileName,
    recipients,
    cc,
    bcc,
    metrics: exportResult.metrics,
  }
}
