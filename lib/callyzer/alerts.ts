import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email/email-service'
import { emailLayout } from '@/lib/email/templates/layout'
import {
  alertSignature,
  detectProblems,
  type Completeness,
  type HandsetHealth,
  type Problem,
} from '@/lib/callyzer/health'

/**
 * Feed-health alerting for Call Analysis.
 *
 * WHY EMAIL AND NOT JUST THE STRIP: the health strip only helps someone who opens the page, and the
 * failure it guards against — a handset stops uploading, so 71% of the call log silently stops
 * growing — is precisely the case where nobody has a reason to open it. The numbers keep rendering,
 * they just stop moving.
 *
 * WHY IT IS DE-DUPLICATED: the sync runs every 3 hours. A handset offline for a week would otherwise
 * send 56 identical emails, the recipients would filter the alert away, and the next real one would
 * be invisible too. Mail goes out only when the PROBLEM SET changes — see migration 0028.
 *
 * Recipients are the technical owners, not the MD. This is "a phone stopped uploading", which is a
 * fix-it message, not a business one.
 */

const DEFAULT_RECIPIENTS = ['tech@amgroupind.com', 'aryan@amgroupind.com']

/** Comma-separated override, for staging or a changed on-call. Falls back to the owners above. */
function recipients(): string[] {
  const raw = (process.env.CALLYZER_ALERT_RECIPIENTS || '').trim()
  if (!raw) return DEFAULT_RECIPIENTS
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_RECIPIENTS
}

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 12px 6px 0;font-size:13px;color:#64748b;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">${value}</td>
  </tr>`
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function alertHtml(problems: Problem[], handsets: HandsetHealth[] | null, completeness: Completeness | null) {
  const items = problems
    .map(
      (p) => `<div style="margin:0 0 14px;padding:12px 14px;background:#fef2f2;border-left:3px solid #e11d48;border-radius:8px;">
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#9f1239;">${esc(p.headline)}</p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#7f1d1d;">${esc(p.detail)}</p>
      </div>`,
    )
    .join('')

  const state = (handsets || [])
    .map((h) =>
      row(
        esc(h.empName),
        `${esc(h.status.replace('_', ' '))}${h.hoursSinceSync !== null ? ` · last check-in ${h.hoursSinceSync}h ago` : ''}`,
      ),
    )
    .join('')

  return `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
      The Call Analysis dashboard reads a synced copy of the Callyzer call log. When a handset stops
      uploading, the page keeps rendering and the numbers simply stop growing — which looks exactly
      like a quiet week. The following needs attention:
    </p>
    ${items}
    ${state ? `<p style="margin:20px 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">All handsets</p><table cellpadding="0" cellspacing="0" style="width:100%;">${state}</table>` : ''}
    ${
      completeness
        ? `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">Record count for ${esc(completeness.windowFrom)} to ${esc(completeness.windowTo)}: dashboard ${completeness.ours}, Callyzer ${completeness.theirs}.</p>`
        : ''
    }
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">
      You will not receive this again until the situation changes. A follow-up is sent when it clears.
    </p>`
}

function recoveryHtml(handsets: HandsetHealth[] | null) {
  const state = (handsets || [])
    .map((h) => row(esc(h.empName), `${esc(h.status)}${h.hoursSinceSync !== null ? ` · last check-in ${h.hoursSinceSync}h ago` : ''}`))
    .join('')
  return `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
      The Callyzer feed is healthy again. Every handset is checking in and the dashboard's record
      count matches Callyzer's.
    </p>
    ${state ? `<table cellpadding="0" cellspacing="0" style="width:100%;">${state}</table>` : ''}
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">
      Note that calls missed while a handset was offline are recovered automatically on the next
      sync — Callyzer holds them until the phone reconnects.
    </p>`
}

export type AlertOutcome = { sent: boolean; kind: 'alert' | 'recovery' | null; reason: string }

/**
 * Compare the current problem set against the last one we alerted on, and mail only on a change.
 * Never throws: an alerting failure must not fail a sync whose call data landed correctly.
 */
export async function maybeSendFeedHealthAlert(
  handsets: HandsetHealth[] | null,
  completeness: Completeness | null,
): Promise<AlertOutcome> {
  try {
    // No handset data means the probe itself failed. Staying silent is deliberate: Callyzer being
    // briefly unreachable is not a feed outage, and alerting on it would be the loudest false alarm
    // in the system.
    if (!handsets) return { sent: false, kind: null, reason: 'no handset data — probe failed, not alerting' }

    const problems = detectProblems(handsets, completeness)
    const signature = alertSignature(problems)

    const stateRows = await db.execute(sql`
      SELECT last_alert_signature FROM callyzer_sync_state WHERE id = 1
    `)
    const previous = String(
      ((Array.isArray(stateRows) ? stateRows[0] : null) as { last_alert_signature?: string } | null)
        ?.last_alert_signature ?? '',
    )

    if (signature === previous) {
      return { sent: false, kind: null, reason: signature ? 'unchanged problem — already alerted' : 'healthy' }
    }

    const isRecovery = signature === '' && previous !== ''
    const heading = isRecovery ? 'Callyzer feed recovered' : 'Callyzer feed needs attention'
    const subject = isRecovery
      ? 'Resolved: Callyzer call feed is healthy again'
      : `Action needed: ${problems[0].headline}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`

    await sendEmail({
      to: recipients(),
      subject,
      html: emailLayout({
        heading,
        eyebrow: 'AM Group · Call Analysis',
        preheader: isRecovery ? 'All handsets are reporting normally.' : problems[0].detail,
        bodyHtml: isRecovery ? recoveryHtml(handsets) : alertHtml(problems, handsets, completeness),
      }),
    })

    // Recorded only after a successful send, so a transient mail failure retries on the next sync
    // rather than silently swallowing the alert.
    await db.execute(sql`
      UPDATE callyzer_sync_state
      SET last_alert_signature = ${signature},
          last_alert_sent_at = now(),
          last_alert_kind = ${isRecovery ? 'recovery' : 'alert'}
      WHERE id = 1
    `)

    return { sent: true, kind: isRecovery ? 'recovery' : 'alert', reason: `${problems.length} problem(s)` }
  } catch (error) {
    console.error('[callyzer] feed-health alert failed:', error)
    return { sent: false, kind: null, reason: error instanceof Error ? error.message : 'unknown error' }
  }
}
