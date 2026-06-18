import path from 'path'
import ExcelJS from 'exceljs'

async function main() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.join(process.cwd(), 'templates', 'kia', 'service-dashboard-template.xlsx'))
  const worksheet = workbook.getWorksheet(1)
  console.log('=== Merged ranges ===')
  worksheet.model.merges.forEach((merge) => {
    console.log(merge)
  })
}

main().catch(console.error)
