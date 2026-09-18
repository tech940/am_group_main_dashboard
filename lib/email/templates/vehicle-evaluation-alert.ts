export interface VehicleEvaluationAlertParams {
  customerName: string
  mobile: string
  brand: string
  model: string
  manufacturingYear: number
  fuelType?: string | null
  transmission?: string | null
  kilometersDriven?: string | null
  evaluationDate: string
  cityArea: string
  interestedInNewCar: boolean
  estimatedPriceFormatted: string
  submittedAt: string
  source?: string
  dashboardUrl?: string
}

export function vehicleEvaluationAlertTemplate(params: VehicleEvaluationAlertParams): {
  subject: string
  html: string
  text: string
} {
  const {
    customerName,
    mobile,
    brand,
    model,
    manufacturingYear,
    fuelType,
    transmission,
    kilometersDriven,
    evaluationDate,
    cityArea,
    interestedInNewCar,
    estimatedPriceFormatted,
    submittedAt,
    dashboardUrl = 'https://app.amautomotivegroup.com',
  } = params

  const cleanPhone = mobile.replace(/\D/g, '').slice(-10)
  const phoneCallUrl = `tel:+91${cleanPhone}`
  const whatsappUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(
    `Hello ${customerName}, Thank you for your interest in getting your ${manufacturingYear} ${brand} ${model} evaluated with AM Group Jammu. We have received your request for ${evaluationDate}. How may we assist you today?`
  )}`

  const subject = `🔥 New Car Evaluation Lead: ${customerName} (${brand} ${model} ${manufacturingYear}) - Jammu`

  const exchangeBadge = interestedInNewCar
    ? `<span style="background: #10B981; color: #ffffff; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; text-transform: uppercase;">Yes - Exchange Interested</span>`
    : `<span style="background: #64748B; color: #ffffff; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; text-transform: uppercase;">Direct Sale Only</span>`

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #002C6C; padding: 20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: -0.02em;">AM GROUP AUTOMOTIVE</div>
                    <div style="color: #93c5fd; font-size: 12px; font-weight: 500; margin-top: 2px;">Used Car Valuation & Exchange Desk • Jammu</div>
                  </td>
                  <td align="right">
                    <span style="background: #2563EB; color: #ffffff; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 9999px;">WhatsApp Campaign Lead</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Summary Hero -->
          <tr>
            <td style="padding: 24px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">New Customer Valuation Request</div>
                    <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px;">${customerName}</div>
                    <div style="font-size: 14px; color: #475569; margin-top: 4px;">📍 Area: <strong>${cityArea}</strong> • Preferred Date: <strong style="color: #0284c7;">${evaluationDate}</strong></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Car Details Card -->
          <tr>
            <td style="padding: 0 24px 20px 24px;">
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 10px;">Vehicle Profile & Estimated Range</div>
                
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding: 4px 0; font-size: 13px; color: #64748b;" width="40%">Car:</td>
                    <td style="padding: 4px 0; font-size: 14px; font-weight: 700; color: #0f172a;">${manufacturingYear} ${brand} ${model}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Fuel / Transmission:</td>
                    <td style="padding: 4px 0; font-size: 13px; font-weight: 600; color: #334155; text-transform: capitalize;">${fuelType || 'Petrol'} • ${transmission || 'Manual'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Kilometers Driven:</td>
                    <td style="padding: 4px 0; font-size: 13px; font-weight: 600; color: #334155;">${kilometersDriven || '40k - 70k km'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Online Estimated Range:</td>
                    <td style="padding: 4px 0; font-size: 15px; font-weight: 800; color: #047857;">${estimatedPriceFormatted}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; font-size: 13px; color: #64748b;">New Car Interest:</td>
                    <td style="padding: 4px 0;">${exchangeBadge}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Quick Action Buttons -->
          <tr>
            <td style="padding: 0 24px 24px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="48%" align="center">
                    <a href="${whatsappUrl}" target="_blank" style="display: block; background-color: #25D366; color: #ffffff; text-decoration: none; padding: 12px 16px; border-radius: 6px; font-size: 13px; font-weight: 700; text-align: center; box-sizing: border-box;">
                      💬 WhatsApp Customer (+91 ${cleanPhone})
                    </a>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" align="center">
                    <a href="${phoneCallUrl}" style="display: block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 16px; border-radius: 6px; font-size: 13px; font-weight: 700; text-align: center; box-sizing: border-box;">
                      📞 Call Customer
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size: 11px; color: #94a3b8;">
                    Lead submitted on ${submittedAt} via Jammu Vehicle Valuation Page.
                  </td>
                  <td align="right">
                    <a href="${dashboardUrl}" style="font-size: 11px; font-weight: 600; color: #2563eb; text-decoration: none;">AM Group Dashboard →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const text = `
NEW VEHICLE EVALUATION LEAD (JAMMU)
=====================================
Customer: ${customerName}
Mobile: +91 ${cleanPhone}
Area: ${cityArea}
Preferred Evaluation Date: ${evaluationDate}

Vehicle Details:
----------------
Car: ${manufacturingYear} ${brand} ${model}
Fuel/Transmission: ${fuelType || 'Petrol'} / ${transmission || 'Manual'}
Mileage/Km: ${kilometersDriven || '40k-70k km'}
Estimated Price Range: ${estimatedPriceFormatted}
Interested in New Car: ${interestedInNewCar ? 'YES (Exchange Lead)' : 'No (Sale Only)'}

Actions:
- Call: ${phoneCallUrl}
- WhatsApp: ${whatsappUrl}

Submitted: ${submittedAt}
AM Group Automotive • Jammu
  `.trim()

  return { subject, html, text }
}
