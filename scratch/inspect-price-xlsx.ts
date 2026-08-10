import * as XLSX from 'xlsx'

const wb = XLSX.readFile('C:/Users/sahil/Downloads/Untitled.xlsx')
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]
  console.log('SHEET:', JSON.stringify(name), '-', rows.length, 'rows x', Math.max(...rows.map((r) => r.length), 0), 'cols')
  for (const r of rows.slice(0, 12)) console.log('  ', JSON.stringify(r))
}
