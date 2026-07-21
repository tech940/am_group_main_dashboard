const fs = require('fs')
const path = require('path')

// Test generation of proforma & quote PDFs
const { buildKiaProformaPdf, buildKiaQuotePdf } = require('../lib/kia-proforma/invoice')

const sampleProforma = {
  id: 'PRO-20260721-9988',
  proformaDate: '2026-07-21',
  customerName: 'Rahul Sharma',
  mobileNumber: '9876543210',
  customerAddress: 'Gandhi Nagar, Jammu, J&K',
  customerEmail: 'rahul.sharma@example.com',
  modelName: 'Kia Seltos',
  trimDescription: 'HTX 1.5 Petrol MT',
  fuelType: 'Petrol',
  vehicleColor: 'Aurora Black Pearl',
  bankName: 'State Bank of India',
  bankBranch: 'SME Jammu',
  insuranceCompany: 'ICICI Lombard',
  exShowroom: '1500000',
  tcsValue: '15000',
  registrationCharges: '120000',
  insuranceValue: '55000',
  fastagValue: '600',
  accessoriesKit: '25000',
  extWarranty: '22000',
  cashDiscount: '20000',
  exchangeValue: '0',
  bookingAmount: '50000',
  govtEmployeeDiscount: '0',
  additionalDiscount: '5000',
  totalCustomerCost: '1737600',
  grandTotalCost: '1662600',
}

const sampleQuote = {
  ...sampleProforma,
  quoteNumber: 'Q-20260721-1234',
  quoteDate: '2026-07-21',
  customerPhone: '9876543210',
}

try {
  const proformaPdfBuffer = buildKiaProformaPdf(sampleProforma)
  const proformaOut = path.join(process.cwd(), 'scratch', 'test_proforma.pdf')
  fs.writeFileSync(proformaOut, proformaPdfBuffer)
  console.log('Proforma PDF generated successfully! Size:', proformaPdfBuffer.length, 'bytes ->', proformaOut)

  const quotePdfBuffer = buildKiaQuotePdf(sampleQuote)
  const quoteOut = path.join(process.cwd(), 'scratch', 'test_quote.pdf')
  fs.writeFileSync(quoteOut, quotePdfBuffer)
  console.log('Quote PDF generated successfully! Size:', quotePdfBuffer.length, 'bytes ->', quoteOut)
} catch (err) {
  console.error('Error generating PDF:', err)
}
