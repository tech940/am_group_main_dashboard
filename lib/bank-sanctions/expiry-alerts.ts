import 'server-only'

import { sendEmail } from '@/lib/email/email-service'
import { emailLayout } from '@/lib/email/templates/layout'
import { listAllBankSanctionsForAlerts, type BankSanctionRecord } from './store'

/**
 * The 15-day expiry digest — the port of the Apps Script's sendExpirySoonOrExpireEmailsNow().
 *
 * Behaviour preserved from the sheet: rows whose expiry is in the current IST month or already
 * past get grouped by their alert email, each recipient receives ONLY their rows, and every send
 * CCs the accounts default. The 15-day cadence is external here — this repo runs crons as
 * secret-gated routes hit by an outside scheduler (the kia-maintenance pattern), so the route in
 * app/api/bank-sanctions/run-alerts calls this and something must actually schedule it.
 */

/** The sheet's DEFAULT_CC_EMAIL, unchanged. */
const DEFAULT_CC_EMAIL = 'sanjay@jammuautomart.com'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const STATUS_LABELS: Record<string, string> = {
  old_expired: 'Old Expired',
  current_month: 'Current Month Expiry',
}

function digestHtml(recipient: string, rows: BankSanctionRecord[]): string {
  const rowHtml = rows.map((row) => `
    <tr>
      <td style="border:1px solid #e2e8f0;padding:8px 10px;">${escapeHtml(row.loanType)}</td>
      <td style="border:1px solid #e2e8f0;padding:8px 10px;">${escapeHtml(row.location)}</td>
      <td style="border:1px solid #e2e8f0;padding:8px 10px;">${escapeHtml(row.expiryDate)}</td>
      <td style="border:1px solid #e2e8f0;padding:8px 10px;">${escapeHtml(STATUS_LABELS[row.expiryStatus || ''] || '')}</td>
    </tr>`).join('')

  return `
    <p style="margin:0 0 12px;font-size:15px;color:#334155">Hello,</p>
    <p style="margin:0 0 16px;font-size:15px;color:#334155">
      These bank sanction facilities assigned to <strong>${escapeHtml(recipient)}</strong> have
      expired or expire this month:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#eef2ff;">
          <th style="border:1px solid #e2e8f0;padding:8px 10px;text-align:left;color:#312e81;">Loan Type</th>
          <th style="border:1px solid #e2e8f0;padding:8px 10px;text-align:left;color:#312e81;">Location</th>
          <th style="border:1px solid #e2e8f0;padding:8px 10px;text-align:left;color:#312e81;">Expiry Date</th>
          <th style="border:1px solid #e2e8f0;padding:8px 10px;text-align:left;color:#312e81;">Status</th>
        </tr>
      </thead>
      <tbody>${rowHtml}</tbody>
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Automated alert from the Bank Sanctions register.</p>
  `
}

export async function runBankSanctionExpiryAlerts(): Promise<{ recipients: number; rows: number }> {
  // Deliberately the UNSCOPED read: the digest runs as a cron with no logged-in user, and each
  // recipient still only receives the rows carrying THEIR alert_email, so brand scoping would only
  // drop mails nobody else would send.
  const records = await listAllBankSanctionsForAlerts()
  const due = records.filter((row) => row.expiryStatus && row.alertEmail)

  const grouped = new Map<string, BankSanctionRecord[]>()
  for (const row of due) {
    const email = String(row.alertEmail).toLowerCase()
    const bucket = grouped.get(email)
    if (bucket) bucket.push(row)
    else grouped.set(email, [row])
  }

  let sent = 0
  // Sequential, not Promise.all — a handful of recipients, and the mail transport is the shared
  // OAuth transporter every KIA email uses; there is nothing to gain by racing it.
  for (const [email, rows] of grouped) {
    await sendEmail({
      to: email,
      cc: DEFAULT_CC_EMAIL,
      subject: 'Bank Sanction Expiry Alert',
      html: emailLayout({
        heading: 'Bank Sanction Expiry Alert',
        eyebrow: 'AM Group · Bank Sanctions',
        preheader: `${rows.length} facility(ies) expired or expiring this month`,
        bodyHtml: digestHtml(email, rows),
      }),
    })
    sent += 1
  }

  return { recipients: sent, rows: due.length }
}
