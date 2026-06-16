import ExcelJS from 'exceljs'
import path from 'node:path'

const file = process.argv[2] || path.join('c:/Users/sahil/Downloads/AM_KIA_Service_Dashboard_2026-06-15.xlsx')

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(file)
const ws = wb.getWorksheet('Service Dashboard') || wb.worksheets[0]
if (!ws) throw new Error('No worksheet')

const rows = []
for (let r = 1; r <= 41; r += 1) {
  const label = String(ws.getCell(`A${r}`).text || ws.getCell(`A${r}`).value || '').trim()
  const today = ws.getCell(`B${r}`).value
  const mtd = ws.getCell(`C${r}`).value
  if (label || today != null || mtd != null) {
    rows.push({ row: r, label, today, mtd })
  }
}
console.log(JSON.stringify({ file, sheet: ws.name, rows }, null, 2))
