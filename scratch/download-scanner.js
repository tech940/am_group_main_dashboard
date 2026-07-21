const fs = require('fs')
const path = require('path')
const https = require('https')

const url = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Scanner/company_scanner.svg'
const dest = path.join(process.cwd(), 'public', 'assets', 'company_scanner.svg')

console.log('Downloading scanner image from:', url)

https.get(url, (res) => {
  if (res.statusCode !== 200) {
    console.error('Failed to download image. Status code:', res.statusCode)
    return
  }
  const fileStream = fs.createWriteStream(dest)
  res.pipe(fileStream)
  fileStream.on('finish', () => {
    fileStream.close()
    console.log('Downloaded company_scanner.svg successfully! Size:', fs.statSync(dest).size, 'bytes')
  })
}).on('error', (err) => {
  console.error('Error downloading:', err.message)
})
