const fs = require('fs')
const path = require('path')

// Test script to verify PDF generation
const { buildKiaProformaPdf, buildKiaQuotePdf } = require('../lib/kia-proforma/invoice.ts')

console.log('Testing PDF build...')
