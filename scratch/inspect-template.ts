import path from 'path'
import ExcelJS from 'exceljs'

async function main() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.join(process.cwd(), 'templates', 'kia', 'service-dashboard-template.xlsx'))
  const worksheet = workbook.getWorksheet(1)
  console.log('Worksheet name:', worksheet.name)
  console.log('Row count:', worksheet.rowCount)
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r)
    console.log(`Row ${r}: A = "${row.getCell(1).value}", B = "${row.getCell(2).value}", C = "${row.getCell(3).value}"`)
  }
}

main().catch(console.error)
