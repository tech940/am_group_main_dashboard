import 'server-only'

import { sendTrackedEmail } from '@/lib/email/email-log'
import { detailTable, emailLayout, escapeHtml } from '@/lib/email/templates'
import { primaryButton } from '@/lib/email/templates/layout'
import { formatIndiaDateTime } from '@/lib/date-time'
import { getKiaBranchLabel } from '@/lib/kia/dealer-branch'
import { resolveGatePassNotifyList } from './approvers'
import { qrPngBuffer } from './qr'

/**
 * Gate pass notifications.
 *
 * ── Three rules here are load-bearing, and each closes a bug that exists elsewhere in this repo ──
 *
 * 1. EVERY SEND HAPPENS AFTER THE TRANSACTION COMMITS. Never inside it.
 *    lib/petty-cash/server.ts fires `void sendPettyCashApprovalEmail(...)` from INSIDE its
 *    db.transaction callback, so a later statement throwing rolls the database back after the
 *    approval email has already left the building. Callers here take the committed row as an
 *    argument, which makes the ordering impossible to get wrong.
 *
 * 2. EVERY INTERPOLATED VALUE IS ESCAPED. `emailLayout` escapes its heading, eyebrow and preheader
 *    but inserts `bodyHtml` RAW. A gate pass carries free text typed by people — purpose notes,
 *    remarks, driver names, parked location, key handover — straight into that seam. So bodies are
 *    built from `detailTable()` (which escapes both cells) and `escapeHtml()`, never from bare
 *    interpolation. lib/petty-cash/emails.ts still does `Dear <strong>${name}</strong>` unescaped;
 *    do not copy it.
 *
 * 3. SENDS SURVIVE THE RESPONSE. On Vercel the instance is FROZEN the moment the response is sent,
 *    so a plain floating promise never completes — an already-observed failure here that silently
 *    killed every background cache refresh for up to two hours. `keepAlive` below pins the
 *    invocation with next/server `after()`, the same fix lib/redis/cache-utils.ts uses.
 */

/**
 * Local copy of cache-utils' keepAlivePastResponse — that one is not exported.
 *
 * Outside a request scope (a cron, a script) `after()` is unavailable and the import rejects; the
 * plain promise is then already correct, because nothing is about to freeze.
 */
function keepAlive(work: Promise<unknown>) {
  void import('next/server')
    .then(({ after }) => after(work))
    .catch(() => {})
}

/** The committed pass, as every template needs to see it. */
export type GatePassEmailRow = {
  id: string
  passNo: string
  dealerCode: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  driverName: string
  driverEmail?: string | null
  purpose: string
  purposeNote: string | null
  expectedReturnAt: Date
  requestedByName: string
  requestedByEmail: string
  approvedByName: string | null
  approvalRemarks: string | null
  gateOutAt: Date | null
  gateOutOdo: string | null
  gateInAt: Date | null
  gateInOdo: string | null
}

function vehicleLine(pass: GatePassEmailRow): string {
  return [pass.model, pass.variant, pass.color].filter(Boolean).join(' · ') || 'Vehicle details not recorded'
}

/** Shared identity block. Every value goes through detailTable, which escapes both columns. */
function passDetails(pass: GatePassEmailRow): string {
  return detailTable([
    ['Pass number', pass.passNo],
    ['Vehicle', vehicleLine(pass)],
    ['Registration', pass.registrationNumber || 'Not recorded'],
    ['Branch', getKiaBranchLabel(pass.dealerCode)],
    ['Driver', pass.driverName],
    ['Purpose', pass.purposeNote ? `${pass.purpose} — ${pass.purposeNote}` : pass.purpose],
    ['Due back', formatIndiaDateTime(pass.expectedReturnAt)],
  ])
}

/**
 * Fire a mail without ever letting it affect the caller.
 *
 * sendTrackedEmail already returns `{ok:false}` rather than throwing, unlike bare sendEmail which
 * rethrows and, on an auth-looking error, retries once with a second unguarded await whose throw
 * escapes entirely. The catch here is belt-and-braces for the import itself.
 */
function dispatch(work: Promise<unknown>) {
  keepAlive(work.catch((error) => {
    console.error('Gate pass email failed:', error)
  }))
}

/** A pass has been raised and is waiting on a named desk. */
export async function sendGatePassSubmittedEmail(pass: GatePassEmailRow): Promise<{ unstaffed: boolean }> {
  const { recipients, unstaffed } = await resolveGatePassNotifyList(pass.dealerCode)
  if (unstaffed || recipients.length === 0) {
    // Not an error to the requester — but the caller surfaces it, because a pass nobody can approve
    // is exactly the silent dead end that leaves requests parked at an unstaffed stage for weeks.
    console.warn(`Gate pass ${pass.passNo}: no active approver at ${pass.dealerCode}`)
    return { unstaffed: true }
  }

  const html = emailLayout({
    eyebrow: 'Demo Car GatePass',
    heading: 'A gate pass is waiting for your approval',
    preheader: `${pass.passNo} · ${vehicleLine(pass)}`,
    bodyHtml:
      `<p>${escapeHtml(pass.requestedByName)} has requested a demo car.</p>`
      + passDetails(pass),
  })

  dispatch(sendTrackedEmail({
    to: recipients.map((r) => r.email),
    subject: `Gate pass ${pass.passNo} awaiting your approval`,
    html,
    emailType: 'gate_pass_submitted',
  }))
  return { unstaffed: false }
}

/**
 * Approved — the requester gets the QR and departure link that lets the guard sign the car out.
 *
 * The QR rides as an inline `cid:` attachment rather than a data: URI, because Gmail strips data:
 * image URIs and the pass would arrive with a broken image where its only useful content should be.
 */
export async function sendGatePassApprovedEmail(pass: GatePassEmailRow, gateUrl: string): Promise<void> {
  let qr: Buffer | null = null
  try {
    qr = await qrPngBuffer(gateUrl)
  } catch (error) {
    // A missing QR must not cost the requester their approval notice — the link below still works.
    console.error(`Gate pass ${pass.passNo}: QR generation failed:`, error)
  }

  const cid = 'gate-pass-qr'
  const html = emailLayout({
    eyebrow: 'Demo Car GatePass',
    heading: 'Your gate pass is approved',
    preheader: `${pass.passNo} · show this QR at the gate`,
    bodyHtml:
      `<div style="margin-bottom:16px;">`
      + `<p style="margin:0 0 8px;font-size:15px;color:#0f172a;">Hello <strong>${escapeHtml(pass.requestedByName)}</strong>,</p>`
      + `<p style="margin:0 0 12px;color:#334155;line-height:1.5;">Your gate pass <strong>${escapeHtml(pass.passNo)}</strong> has been approved by <strong>${escapeHtml(pass.approvedByName || 'your approver')}</strong>.`
      + (pass.approvalRemarks ? `<br/><span style="color:#64748b;font-size:13px;">Remark: <em>${escapeHtml(pass.approvalRemarks)}</em></span>` : '')
      + `</p>`
      + `</div>`
      + (qr
        ? `<div style="text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:20px 0;">`
          + `<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0f172a;">Gate Departure QR Code</p>`
          + `<p style="margin:0 0 16px;font-size:12px;color:#64748b;max-width:360px;margin-left:auto;margin-right:auto;">Show this QR code to the gate guard before departure to log odometer OUT, take 4-angle vehicle photos, and open the gate.</p>`
          + `<img src="cid:${cid}" alt="Gate pass QR code" width="220" height="220" style="border:1px solid #cbd5e1;border-radius:10px;background:#ffffff;padding:8px;display:inline-block;" />`
          + `</div>`
        : '')
      + `<div style="margin:24px 0 16px;text-align:center;">`
      + primaryButton(gateUrl, 'Open gate pass')
      + `</div>`
      + `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin:16px 0;word-break:break-all;">`
      + `<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Direct Link for Guard / Departure</p>`
      + `<a href="${escapeHtml(gateUrl)}" style="color:#2563eb;font-size:13px;text-decoration:underline;">${escapeHtml(gateUrl)}</a>`
      + `</div>`
      + `<p style="color:#64748b;font-size:12px;margin:0 0 20px;">This link signs the vehicle OUT. A separate link is issued when it leaves, for signing it back in.</p>`
      + passDetails(pass),
  })

  const cc: string[] = []
  if (pass.driverEmail && pass.driverEmail.toLowerCase() !== pass.requestedByEmail.toLowerCase()) {
    cc.push(pass.driverEmail)
  }

  dispatch(sendTrackedEmail({
    to: pass.requestedByEmail,
    cc: cc.length > 0 ? cc : undefined,
    subject: `Gate pass ${pass.passNo} approved`,
    html,
    emailType: 'gate_pass_approved',
    attachments: qr
      ? [{ filename: `gate-pass-${pass.passNo}-qr.png`, content: qr, contentType: 'image/png', cid }]
      : undefined,
  }))
}

export async function sendGatePassRejectedEmail(pass: GatePassEmailRow): Promise<void> {
  const html = emailLayout({
    eyebrow: 'Demo Car GatePass',
    heading: 'Your gate pass was not approved',
    preheader: `${pass.passNo} · ${vehicleLine(pass)}`,
    bodyHtml:
      `<p>${escapeHtml(pass.approvedByName || 'Your approver')} did not approve this request.</p>`
      + (pass.approvalRemarks
        ? `<p><strong>Reason:</strong> ${escapeHtml(pass.approvalRemarks)}</p>`
        : '<p>No reason was recorded. Speak to your Sales Manager before raising it again.</p>')
      + passDetails(pass),
  })

  dispatch(sendTrackedEmail({
    to: pass.requestedByEmail,
    subject: `Gate pass ${pass.passNo} not approved`,
    html,
    emailType: 'gate_pass_rejected',
  }))
}

export const GATE_PASS_MANAGEMENT_EMAILS: string[] = [
  'tech@amgroupind.com',
  'aryan@amgroupind.com',
  'sanjay@jammuautomart.com',
  'gmsales@amkia.in',
  'mohanamkia@gmail.com',
]

function buildNotificationCcList(
  primaryEmail: string,
  dealerRecipients: Array<{ email: string }>,
  driverEmail?: string | null,
): string[] {
  const all = [
    ...dealerRecipients.map((r) => r.email),
    ...GATE_PASS_MANAGEMENT_EMAILS,
    ...(driverEmail ? [driverEmail] : []),
  ]
  const lowerPrimary = primaryEmail.trim().toLowerCase()
  const unique = new Set<string>()
  for (const email of all) {
    const trimmed = email.trim()
    if (trimmed && trimmed.toLowerCase() !== lowerPrimary) {
      unique.add(trimmed)
    }
  }
  return Array.from(unique)
}

/** The car has physically left. Requester gets the return QR/link, while management & approvers get an informational alert. */
export async function sendGatePassGateOutEmail(pass: GatePassEmailRow, returnUrl: string): Promise<void> {
  const { recipients } = await resolveGatePassNotifyList(pass.dealerCode)

  let qr: Buffer | null = null
  try {
    qr = await qrPngBuffer(returnUrl)
  } catch (error) {
    console.error(`Gate pass ${pass.passNo}: return QR generation failed:`, error)
  }

  const cid = 'gate-pass-return-qr'

  // 1. Email to Requester ONLY — includes Return QR Code & Direct Link to sign vehicle back in
  const requesterHtml = emailLayout({
    eyebrow: 'Demo Car GatePass',
    heading: 'Vehicle has left the premises',
    preheader: `${pass.passNo} · due back ${formatIndiaDateTime(pass.expectedReturnAt)}`,
    bodyHtml:
      `<div style="margin-bottom:16px;">`
      + `<p style="margin:0 0 8px;font-size:15px;color:#0f172a;">Hello <strong>${escapeHtml(pass.requestedByName)}</strong>,</p>`
      + `<p style="margin:0 0 12px;color:#334155;line-height:1.5;">Vehicle <strong>${escapeHtml(pass.registrationNumber || pass.model || 'Demo Car')}</strong> on pass <strong>${escapeHtml(pass.passNo)}</strong> has been checked out at the gate.</p>`
      + `</div>`
      + (qr
        ? `<div style="text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:20px 0;">`
          + `<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0f172a;">Return Verification QR Code</p>`
          + `<p style="margin:0 0 16px;font-size:12px;color:#64748b;max-width:360px;margin-left:auto;margin-right:auto;">Show this QR code to the gate guard upon return to log odometer IN, parking location, and key handover.</p>`
          + `<img src="cid:${cid}" alt="Return QR code" width="220" height="220" style="border:1px solid #cbd5e1;border-radius:10px;background:#ffffff;padding:8px;display:inline-block;" />`
          + `</div>`
        : '')
      + `<div style="margin:24px 0 16px;text-align:center;">`
      + primaryButton(returnUrl, 'Sign vehicle back in')
      + `</div>`
      + `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin:16px 0;word-break:break-all;">`
      + `<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Direct Return Link</p>`
      + `<a href="${escapeHtml(returnUrl)}" style="color:#2563eb;font-size:13px;text-decoration:underline;">${escapeHtml(returnUrl)}</a>`
      + `</div>`
      + detailTable([
        ['Pass number', pass.passNo],
        ['Vehicle', vehicleLine(pass)],
        ['Registration', pass.registrationNumber || 'Not recorded'],
        ['Driver', pass.driverName],
        ['Left at', pass.gateOutAt ? formatIndiaDateTime(pass.gateOutAt) : '—'],
        ['Odometer out', pass.gateOutOdo ? `${pass.gateOutOdo} km` : 'Not recorded'],
        ['Due back', formatIndiaDateTime(pass.expectedReturnAt)],
      ]),
  })

  dispatch(sendTrackedEmail({
    to: pass.requestedByEmail,
    subject: `Gate pass ${pass.passNo}: vehicle out (Return QR code enclosed)`,
    html: requesterHtml,
    emailType: 'gate_pass_gate_out',
    attachments: qr
      ? [{ filename: `gate-pass-${pass.passNo}-return-qr.png`, content: qr, contentType: 'image/png', cid }]
      : undefined,
  }))

  // 2. Alert-Only Email to Management & Approvers — NO QR Code and NO action links
  const alertRecipients = buildNotificationCcList(pass.requestedByEmail, recipients)
  if (alertRecipients.length > 0) {
    const alertHtml = emailLayout({
      eyebrow: 'Demo Car GatePass Alert',
      heading: 'Vehicle Has Left Premises',
      preheader: `${pass.passNo} · ${vehicleLine(pass)} · ${pass.driverName}`,
      bodyHtml:
        `<div style="margin-bottom:16px;">`
        + `<p style="margin:0 0 8px;font-size:15px;color:#0f172a;">Vehicle <strong>${escapeHtml(pass.registrationNumber || pass.model || 'Demo Car')}</strong> has departed.</p>`
        + `<p style="margin:0 0 12px;color:#334155;line-height:1.5;">Gate pass <strong>${escapeHtml(pass.passNo)}</strong> has been signed out at the gate. Driven by <strong>${escapeHtml(pass.driverName)}</strong>, requested by <strong>${escapeHtml(pass.requestedByName)}</strong>.</p>`
        + `</div>`
        + detailTable([
          ['Pass number', pass.passNo],
          ['Vehicle', vehicleLine(pass)],
          ['Registration', pass.registrationNumber || 'Not recorded'],
          ['Branch', getKiaBranchLabel(pass.dealerCode)],
          ['Driver', pass.driverName],
          ['Requested by', pass.requestedByName],
          ['Left at', pass.gateOutAt ? formatIndiaDateTime(pass.gateOutAt) : '—'],
          ['Odometer out', pass.gateOutOdo ? `${pass.gateOutOdo} km` : 'Not recorded'],
          ['Due back', formatIndiaDateTime(pass.expectedReturnAt)],
          ['Purpose', pass.purposeNote ? `${pass.purpose} — ${pass.purposeNote}` : pass.purpose],
        ]),
    })

    dispatch(sendTrackedEmail({
      to: alertRecipients,
      subject: `Gate Out Alert: ${pass.passNo} · ${pass.registrationNumber || pass.model || 'Demo Car'} on the road`,
      html: alertHtml,
      emailType: 'gate_pass_gate_out_alert',
    }))
  }
}

export async function sendGatePassReturnedEmail(pass: GatePassEmailRow): Promise<void> {
  const { recipients } = await resolveGatePassNotifyList(pass.dealerCode)
  const distance = pass.gateInOdo && pass.gateOutOdo
    ? Number(pass.gateInOdo) - Number(pass.gateOutOdo)
    : null

  const html = emailLayout({
    eyebrow: 'Demo Car GatePass',
    heading: 'Vehicle returned & trip closed',
    preheader: `${pass.passNo} · ${vehicleLine(pass)} · ${distance !== null ? `${distance} km covered` : 'Returned'}`,
    bodyHtml:
      `<div style="margin-bottom:16px;">`
      + `<p style="margin:0 0 8px;font-size:15px;color:#0f172a;">Vehicle <strong>${escapeHtml(pass.registrationNumber || pass.model || 'Demo Car')}</strong> has arrived safely back at <strong>${escapeHtml(getKiaBranchLabel(pass.dealerCode))}</strong>.</p>`
      + `<p style="margin:0 0 12px;color:#334155;line-height:1.5;">Gate pass <strong>${escapeHtml(pass.passNo)}</strong> has been verified and signed back in by the gate guard.</p>`
      + `</div>`
      + detailTable([
        ['Pass number', pass.passNo],
        ['Vehicle', vehicleLine(pass)],
        ['Registration', pass.registrationNumber || 'Not recorded'],
        ['Branch', getKiaBranchLabel(pass.dealerCode)],
        ['Driver', pass.driverName],
        ['Requested by', pass.requestedByName],
        ['Left at', pass.gateOutAt ? formatIndiaDateTime(pass.gateOutAt) : '—'],
        ['Returned at', pass.gateInAt ? formatIndiaDateTime(pass.gateInAt) : '—'],
        ['Odometer out', pass.gateOutOdo ? `${pass.gateOutOdo} km` : '—'],
        ['Odometer in', pass.gateInOdo ? `${pass.gateInOdo} km` : '—'],
        ['Total distance', Number.isFinite(distance as number) && distance !== null ? `${distance} km` : 'Not computed'],
      ]),
  })

  const cc = buildNotificationCcList(pass.requestedByEmail, recipients, pass.driverEmail)

  dispatch(sendTrackedEmail({
    to: pass.requestedByEmail,
    cc: cc.length > 0 ? cc : undefined,
    subject: `Vehicle Returned: ${pass.passNo} · ${pass.registrationNumber || pass.model || 'Demo Car'} closed`,
    html,
    emailType: 'gate_pass_returned',
  }))
}

/**
 * The car is late back.
 *
 * ⚠️ The caller must have already stamped `overdue_notified_at` — otherwise the sweep re-mails the
 * same pass on every run, which is how a reminder becomes noise people filter out, and then a real
 * overdue vehicle goes unnoticed.
 */
export async function sendGatePassOverdueEmail(pass: GatePassEmailRow): Promise<void> {
  const { recipients } = await resolveGatePassNotifyList(pass.dealerCode)

  const html = emailLayout({
    eyebrow: 'Demo Car GatePass Alert',
    heading: 'Vehicle is overdue for return',
    preheader: `URGENT: ${pass.passNo} · was due ${formatIndiaDateTime(pass.expectedReturnAt)}`,
    bodyHtml:
      `<div style="margin-bottom:16px;">`
      + `<p style="margin:0 0 8px;font-size:15px;color:#991b1b;font-weight:700;">⚠️ Vehicle return schedule has been exceeded.</p>`
      + `<p style="margin:0 0 12px;color:#334155;line-height:1.5;">Vehicle <strong>${escapeHtml(pass.registrationNumber || pass.model || 'Demo Car')}</strong> on gate pass <strong>${escapeHtml(pass.passNo)}</strong> was expected back by <strong>${escapeHtml(formatIndiaDateTime(pass.expectedReturnAt) || '—')}</strong> but has not yet been checked in at the gate.</p>`
      + `</div>`
      + detailTable([
        ['Pass number', pass.passNo],
        ['Vehicle', vehicleLine(pass)],
        ['Registration', pass.registrationNumber || 'Not recorded'],
        ['Branch', getKiaBranchLabel(pass.dealerCode)],
        ['Driver', pass.driverName],
        ['Requested by', pass.requestedByName],
        ['Left premises at', pass.gateOutAt ? formatIndiaDateTime(pass.gateOutAt) : '—'],
        ['Was due back', formatIndiaDateTime(pass.expectedReturnAt)],
        ['Purpose', pass.purposeNote ? `${pass.purpose} — ${pass.purposeNote}` : pass.purpose],
      ]),
  })

  const cc = buildNotificationCcList(pass.requestedByEmail, recipients, pass.driverEmail)

  dispatch(sendTrackedEmail({
    to: pass.requestedByEmail,
    cc: cc.length > 0 ? cc : undefined,
    subject: `OVERDUE ALERT: ${pass.passNo} · ${pass.registrationNumber || pass.model || 'Demo Car'} past due time`,
    html,
    emailType: 'gate_pass_overdue',
  }))
}
