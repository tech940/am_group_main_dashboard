import * as XLSX from 'xlsx'

const wb = XLSX.readFile('C:/Users/sahil/Downloads/Untitled.xlsx')

const grid = XLSX.utils.sheet_to_json(wb.Sheets['Syros'], { header: 1, defval: null }) as unknown[][]
console.log('--- Syros sheet rows 11-30 (first 11 cols) ---')
grid.slice(10, 30).forEach((r, i) => console.log(11 + i, JSON.stringify((r ?? []).slice(0, 11))))

const sp = XLSX.utils.sheet_to_json(wb.Sheets['Seltos Petrol'], { header: 1, defval: null }) as unknown[][]
console.log('\n--- Seltos Petrol GTX rows (trim, colour, ex, tcs) ---')
sp.forEach((r, i) => {
  const t = String((r ?? [])[1] ?? '')
  if (/GTX/i.test(t)) console.log(i + 1, JSON.stringify((r ?? []).slice(1, 5)))
})
