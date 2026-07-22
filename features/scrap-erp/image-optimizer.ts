/**
 * Client-side Image Compressor & WebP Converter for Scrap ERP
 * Automatically downscales images to max 1600px and re-encodes them to WebP (quality 0.8)
 * to save storage space and bandwidth before saving.
 */
export async function compressAndConvertToWebp(
  file: File,
  maxDimension = 1600,
  quality = 0.8
): Promise<{ file: File; dataUrl: string }> {
  // If it's a PDF or non-image, return file as-is
  if (!file.type.startsWith('image/')) {
    const dataUrl = await fileToDataUrl(file)
    return { file, dataUrl }
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.src = e.target?.result as string
    }

    reader.onerror = (err) => reject(err)

    img.onload = () => {
      try {
        let width = img.width
        let height = img.height

        // Downscale while preserving aspect ratio
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          } else {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fileToDataUrl(file).then((dataUrl) => resolve({ file, dataUrl }))
          return
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height)

        // Convert canvas to WebP Blob & DataURL
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              fileToDataUrl(file).then((dataUrl) => resolve({ file, dataUrl }))
              return
            }

            // Replace file extension with .webp
            const originalName = file.name.replace(/\.[^/.]+$/, '')
            const webpFileName = `${originalName}.webp`

            const webpFile = new File([blob], webpFileName, {
              type: 'image/webp',
              lastModified: Date.now(),
            })

            const dataUrl = canvas.toDataURL('image/webp', quality)

            console.log(
              `[Scrap ERP Image Optimizer] Converted ${file.name} (${(file.size / 1024).toFixed(1)} KB) -> ${webpFileName} (${(webpFile.size / 1024).toFixed(1)} KB)`
            )

            resolve({ file: webpFile, dataUrl })
          },
          'image/webp',
          quality
        )
      } catch (err) {
        fileToDataUrl(file).then((dataUrl) => resolve({ file, dataUrl }))
      }
    }

    reader.readAsDataURL(file)
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve((e.target?.result as string) || '')
    reader.readAsDataURL(file)
  })
}
