// Shared, inline-styled HTML wrapper for all transactional emails. Kept minimal
// and table-free-ish with inline styles so it renders consistently across clients.
// New templates should reuse `emailLayout` so branding stays in one place.

export type EmailLayoutOptions = {
  heading: string
  bodyHtml: string
  preheader?: string
}

const BRAND = 'AM Global Dashboard'
const ACCENT = '#c8102e' // AM Kia red

export function emailLayout({ heading, bodyHtml, preheader }: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
    <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
        <div style="background:linear-gradient(135deg,${ACCENT},#8f0b20);padding:24px 28px;">
          <p style="margin:0;font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.75);">${escapeHtml(BRAND)}</p>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.25;">${escapeHtml(heading)}</h1>
        </div>
        <div style="padding:28px;font-size:15px;line-height:1.6;color:#334155;">
          ${bodyHtml}
        </div>
        <div style="padding:18px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0;font-size:13px;color:#64748b;">Regards,</p>
          <p style="margin:2px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(BRAND)}</p>
        </div>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#94a3b8;">This is an automated message from ${escapeHtml(BRAND)}. Please do not reply to this email.</p>
    </div>
  </body>
</html>`
}

/** Renders a compact label/value detail table for email bodies. */
export function detailTable(rows: Array<[label: string, value: string | null | undefined]>): string {
  const cells = rows
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(String(value))}</td>
      </tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 4px;border-collapse:collapse;">${cells}</table>`
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
