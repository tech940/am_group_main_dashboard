import 'server-only'

import { sendEmail } from '@/lib/email/email-service'
import { emailLayout } from '@/lib/email/templates/layout'
import { createResubmitToken } from '@/lib/kia/approval-resubmit'
import { firstStageShortLabel } from '@/lib/approvals/first-stage-approver'

/**
 * Emails a submitter receives when a decision lands on their payment request.
 *
 * ── Why this is shared ────────────────────────────────────────────────────────────────────────
 * The send-back email lived inline in the single-action route and nowhere else, so BULK send-back
 * was impossible: the bulk route did not even accept SEND_BACK as an action. Approving fifty
 * requests notified fifty people; sending fifty back notified nobody, because the feature did not
 * exist. Forking the template into the bulk route would have guaranteed the two drifted.
 *
 * ⚠️ A related gap this closes: REJECT previously set `emailSendStatus = 'Rejected'` and sent no
 * email at all — in either route. The column name promised a message that never left, so a rejected
 * ₹4.48L request looked notified in the database and silent to the person who submitted it.
 *
 * Every send here is fire-and-forget and swallows its own errors. A decision that is already written
 * to the database must not be rolled back because a mail server was briefly unreachable — the
 * approver has moved on, and the record is the source of truth.
 */

/** Human labels for the stage that made the decision, so the email can say WHICH desk acted. */
const STAGE_LABELS: Record<string, string> = {
  ed: 'ED',
  hr: 'HR',
  ea: 'EA',
  md: 'MD',
  accounts: 'Accounts',
  payment_done: 'Payment',
}

/**
 * What to call the desk that acted.
 *
 * ⚠️ The first stage ('sales_manager') is NOT a fixed word. It was hardcoded to 'VP' here, which
 * would tell a Hyundai or Platinum submitter their request was decided by a role their brand does
 * not have — the same KIA-only assumption already fixed in the routes and the approvals screen. It
 * is resolved from the BRAND instead: 'ED' at KIA, 'GSM' everywhere else.
 */
export function stageLabelFor(row: DecisionRecipient, stage: string): string {
  if (stage === 'sales_manager') return firstStageShortLabel(row.brand, null)
  return STAGE_LABELS[stage] || stage.toUpperCase()
}

/** Same resolution order as lib/delegation/emails.ts so every outbound link agrees on the host. */
function getAppBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))
  return String(baseUrl).replace(/\/$/, '')
}

/** Emails are HTML; a vendor name or remark containing < or & must not be able to break the layout. */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type DecisionRecipient = {
  id: string
  name: string | null
  email: string | null
  amount: string | null
  vendorName: string | null
  /** Shown so the submitter can quote it back — see lib/approvals/request-number.ts. */
  requestNo?: string | null
  /** Decides what the first approval stage is CALLED — 'ED' at KIA, 'GSM' at every other brand. */
  brand?: string | null
}

type DecisionContext = {
  /** Workflow stage that acted, e.g. 'md' | 'accounts'. */
  stage: string
  /** Display name of the approver. */
  senderName: string
  /** The approver's comments. Mandatory in practice for send-back and reject. */
  remarks: string
}

function requestLabel(row: DecisionRecipient): string {
  const vendor = String(row.vendorName || '').trim()
  const no = String(row.requestNo || '').trim()
  const parts = [no ? `<strong>${escapeHtml(no)}</strong>` : '', vendor ? `for <strong>${escapeHtml(vendor)}</strong>` : '']
  return parts.filter(Boolean).join(' ')
}

/**
 * "Your request was sent back — here is a link to fix and resubmit it."
 *
 * The resubmit link carries a signed token so the submitter, who has NO LOGIN, can reopen the
 * request with their answers prefilled. That is the whole reason this email matters more than the
 * others: without it a sent-back request is a dead end.
 */
export function sendApprovalSentBackEmail(row: DecisionRecipient, ctx: DecisionContext): void {
  if (!row.email) return
  try {
    const stageLabel = stageLabelFor(row, ctx.stage)
    const resubmitUrl = `${getAppBaseUrl()}/brands/kia/payment-approvals/submit?resubmit=${createResubmitToken(row.id)}`
    const bodyHtml = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#334155">
        Your payment approval request ${requestLabel(row)} of <strong>INR ${escapeHtml(row.amount)}</strong>
        has been sent back for clarification / additional information.
      </p>
      <div style="margin:20px 0;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#d97706;">Sent back by:</h4>
        <p style="margin:0 0 12px;font-size:14px;color:#111827;"><strong>${escapeHtml(ctx.senderName)}</strong> &middot; ${escapeHtml(stageLabel)} stage</p>
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#d97706;">Comments:</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${escapeHtml(ctx.remarks) || 'No remarks provided.'}</p>
      </div>
      <p style="margin:0 0 20px;font-size:15px;color:#334155">
        Use the button below to reopen your request with everything you submitted already filled in,
        make the changes asked for, and send it back through.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
        <tr>
          <td style="border-radius:10px;background:#0f766e;">
            <a href="${resubmitUrl}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
              Re-submit request
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:12px;color:#94a3b8;">
        This link is unique to your request and expires in 30 days. No sign-in is needed.
      </p>
    `
    void sendEmail({
      to: row.email,
      subject: `Clarification Needed: Payment Request${row.requestNo ? ` ${row.requestNo}` : ''}`,
      html: emailLayout({
        heading: 'Payment Request Sent Back',
        eyebrow: 'AM Group · Approvals',
        preheader: 'Clarification Needed',
        bodyHtml,
      }),
    }).catch((err) => console.error('[approvals] send-back email failed for %s:', row.email, err))
  } catch (err) {
    console.error('[approvals] could not build the send-back email for %s:', row.email, err)
  }
}

/**
 * "Your request was not approved."
 *
 * New — rejection was previously silent. There is deliberately NO resubmit link: a rejection is a
 * decision, not a request for changes, and offering the same button as a send-back would blur two
 * different outcomes. The remarks carry the reason.
 */
export function sendApprovalRejectedEmail(row: DecisionRecipient, ctx: DecisionContext): void {
  if (!row.email) return
  try {
    const stageLabel = stageLabelFor(row, ctx.stage)
    const bodyHtml = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#334155">
        Your payment approval request ${requestLabel(row)} of <strong>INR ${escapeHtml(row.amount)}</strong>
        has not been approved.
      </p>
      <div style="margin:20px 0;padding:16px;border:1px solid #fecdd3;border-radius:12px;background:#fff5f6;">
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#be123c;">Decided by:</h4>
        <p style="margin:0 0 12px;font-size:14px;color:#111827;"><strong>${escapeHtml(ctx.senderName)}</strong> &middot; ${escapeHtml(stageLabel)} stage</p>
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#be123c;">Reason:</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${escapeHtml(ctx.remarks) || 'No reason provided.'}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#64748b;">
        If you believe this needs revisiting, reply to the approver directly or raise a new request
        with the additional detail.
      </p>
    `
    void sendEmail({
      to: row.email,
      subject: `Not Approved: Payment Request${row.requestNo ? ` ${row.requestNo}` : ''}`,
      html: emailLayout({
        heading: 'Payment Request Not Approved',
        eyebrow: 'AM Group · Approvals',
        preheader: 'Your request was not approved',
        bodyHtml,
      }),
    }).catch((err) => console.error('[approvals] rejection email failed for %s:', row.email, err))
  } catch (err) {
    console.error('[approvals] could not build the rejection email for %s:', row.email, err)
  }
}

/**
 * "Your request is on hold."
 *
 * Also new. A hold is reversible and often short, so this is the quietest of the three — no link, no
 * call to action, just so the submitter is not left refreshing a page that never moves.
 */
export function sendApprovalHeldEmail(row: DecisionRecipient, ctx: DecisionContext): void {
  if (!row.email) return
  try {
    const stageLabel = stageLabelFor(row, ctx.stage)
    const bodyHtml = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#334155">
        Your payment approval request ${requestLabel(row)} of <strong>INR ${escapeHtml(row.amount)}</strong>
        has been placed on hold at the ${escapeHtml(stageLabel)} stage.
      </p>
      <div style="margin:20px 0;padding:16px;border:1px solid #fde68a;border-radius:12px;background:#fffbeb;">
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#b45309;">Placed on hold by:</h4>
        <p style="margin:0 0 12px;font-size:14px;color:#111827;"><strong>${escapeHtml(ctx.senderName)}</strong></p>
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#b45309;">Note:</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${escapeHtml(ctx.remarks) || 'No note provided.'}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#64748b;">
        No action is needed from you. You will be notified when it moves again.
      </p>
    `
    void sendEmail({
      to: row.email,
      subject: `On Hold: Payment Request${row.requestNo ? ` ${row.requestNo}` : ''}`,
      html: emailLayout({
        heading: 'Payment Request On Hold',
        eyebrow: 'AM Group · Approvals',
        preheader: 'Your request is on hold',
        bodyHtml,
      }),
    }).catch((err) => console.error('[approvals] hold email failed for %s:', row.email, err))
  } catch (err) {
    console.error('[approvals] could not build the hold email for %s:', row.email, err)
  }
}

/**
 * "The MD has left a remark on your request."
 *
 * A remark is NOT a decision — the request stays exactly where it is. It gets its own message
 * because the MD often asks a question here ("3 Quotes?") that the submitter has to answer before
 * anything moves, and a question nobody sees stalls the request indefinitely.
 *
 * ⚠️ Lifted out of app/api/brands/kia/approvals/[id]/remark/route.ts, where it lived inline. That is
 * the same shape that caused the send-back and reject gaps: a template that lives in ONE route
 * cannot be reused, so the second caller either forks it or sends nothing. It also interpolated the
 * submitter's name and the remark RAW into HTML; both are escaped here.
 */
export function sendMdRemarkEmail(row: DecisionRecipient, ctx: Pick<DecisionContext, 'senderName' | 'remarks'>): void {
  if (!row.email) return
  try {
    const vendorLabel = String(row.vendorName || '').trim()
    const bodyHtml = `
      <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#334155">
        The MD has added a remark on your payment approval request ${requestLabel(row)}
        of <strong>INR ${escapeHtml(row.amount)}</strong>.
      </p>
      <div style="margin:20px 0;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#0f766e;">Remark from ${escapeHtml(ctx.senderName)}:</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${escapeHtml(ctx.remarks)}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#64748b;">
        If the remark asks for something, please reply with it so the request can move forward.
        Your request has not been rejected — it is still in the approval flow.
      </p>
    `
    void sendEmail({
      to: row.email,
      subject: `MD Remark on your Payment Request${row.requestNo ? ` ${row.requestNo}` : (vendorLabel ? ` for ${vendorLabel}` : '')}`,
      html: emailLayout({
        heading: 'MD Remark Added',
        eyebrow: 'AM Group · Approvals',
        preheader: 'MD remark on your payment request',
        bodyHtml,
      }),
    }).catch((err) => console.error('[approvals] MD remark email failed for %s:', row.email, err))
  } catch (err) {
    console.error('[approvals] could not build the MD remark email for %s:', row.email, err)
  }
}

/** Dispatch by action. Returns whether an email was attempted, for the bulk route's summary. */
export function sendApprovalDecisionEmail(
  action: 'SEND_BACK' | 'REJECT' | 'HOLD',
  row: DecisionRecipient,
  ctx: DecisionContext,
): boolean {
  if (!row.email) return false
  if (action === 'SEND_BACK') sendApprovalSentBackEmail(row, ctx)
  else if (action === 'REJECT') sendApprovalRejectedEmail(row, ctx)
  else sendApprovalHeldEmail(row, ctx)
  return true
}
