import type { Metadata } from 'next'
import { getTrackingView, type KiaTrackingView } from '@/lib/kia/tracking'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Track Your Kia Booking',
  robots: { index: false, follow: false },
}

const BRAND = 'AM Kia'
const ACCENT = '#c8102e'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function NotFound() {
  return (
    <main style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0', padding: 32, textAlign: 'center', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT }}>{BRAND}</div>
        <h1 style={{ margin: '12px 0 8px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Link not found</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#64748b' }}>
          This tracking link is invalid or has expired. Please contact your sales consultant for an up-to-date link.
        </p>
      </div>
    </main>
  )
}

function StepRow({ step, index, total }: { step: KiaTrackingView['steps'][number]; index: number; total: number }) {
  const done = step.state === 'done'
  const current = step.state === 'current'
  const color = done ? '#16a34a' : current ? ACCENT : '#cbd5e1'
  const isLast = index === total - 1
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: done || current ? color : '#fff',
            border: `2px solid ${color}`,
            color: done || current ? '#fff' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {done ? '✓' : index + 1}
        </div>
        {!isLast && <div style={{ width: 2, flex: 1, minHeight: 28, background: done ? '#16a34a' : '#e2e8f0' }} />}
      </div>
      <div style={{ paddingBottom: isLast ? 0 : 22 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: current ? ACCENT : done ? '#0f172a' : '#94a3b8' }}>
          {step.label}
          {current && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: ACCENT, background: 'rgba(200,16,46,0.1)', padding: '2px 8px', borderRadius: 999 }}>
              In progress
            </span>
          )}
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: 1.5, color: '#64748b' }}>{step.hint}</p>
      </div>
    </div>
  )
}

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await getTrackingView(token)
  if (!view) return <NotFound />

  const vehicle = [view.model, view.variant].filter(Boolean).join(' ')
  const detailRows: Array<[string, string]> = [
    ['Booking Number', view.bookingNumber],
    ['Vehicle', vehicle || '—'],
    ['Colour', view.color || '—'],
    ['Consultant', view.consultantName || '—'],
    ['Booked On', formatDate(view.bookedAt)],
    view.deliveredAt
      ? ['Delivered On', formatDate(view.deliveredAt)]
      : ['Expected Delivery', view.expectedDeliveryDate ? formatDate(view.expectedDeliveryDate) : 'To be confirmed'],
  ]

  return (
    <main style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: '#0f172a', padding: '24px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ background: `linear-gradient(135deg, ${ACCENT}, #8f0b20)`, padding: '28px 28px 24px' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>{BRAND}</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
              Hi {view.customerFirstName}, here&rsquo;s your order status
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
              {vehicle || 'Your Kia vehicle'} · {view.bookingNumber}
            </p>
          </div>

          {view.cancelled ? (
            <div style={{ padding: 28 }}>
              <div style={{ borderRadius: 14, border: '1px solid rgba(200,16,46,0.3)', background: 'rgba(200,16,46,0.06)', padding: 20 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: ACCENT }}>This booking has been cancelled</p>
                <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: '#64748b' }}>
                  If you believe this is a mistake, please get in touch with your sales consultant.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ padding: 28 }}>
              <div style={{ marginBottom: 24 }}>
                {view.steps.map((step, index) => (
                  <StepRow key={step.key} step={step} index={index} total={view.steps.length} />
                ))}
              </div>

              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
                <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {detailRows.map(([label, value]) => (
                      <tr key={label}>
                        <td style={{ padding: '7px 12px 7px 0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                        <td style={{ padding: '7px 0', fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ padding: '18px 28px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              Questions about your order? Contact your {view.consultantName ? `consultant, ${view.consultantName}` : 'sales consultant'} at {view.dealerCode || BRAND}.
            </p>
          </div>
        </div>
        <p style={{ margin: '16px 0 0', textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          This page updates automatically as your booking progresses. Powered by {BRAND}.
        </p>
      </div>
    </main>
  )
}
