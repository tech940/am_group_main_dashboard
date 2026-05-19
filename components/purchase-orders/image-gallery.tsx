'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { X, FileText, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageGalleryProps {
  images: string[]
  title: string
  className?: string
  orderId?: string
}

function isPdfUrl(value: string) {
  return value.toLowerCase().split('?')[0].endsWith('.pdf')
}

function isImageUrl(value: string) {
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(value.toLowerCase().split('?')[0])
}

function getFileName(value: string, index: number) {
  try {
    return decodeURIComponent(value.split('/').pop()?.split('?')[0] || `Document ${index + 1}`)
  } catch {
    return value.split('/').pop()?.split('?')[0] || `Document ${index + 1}`
  }
}

function getSavedFilePreviewUrl(file: string, orderId?: string) {
  const params = new URLSearchParams({ file })

  if (orderId) {
    params.set('orderId', orderId)
  }

  return `/api/purchase-orders/file?${params.toString()}`
}

function normalizeGalleryFiles(images: ImageGalleryProps['images']) {
  if (!images) return []

  if (Array.isArray(images)) {
    return images.filter((image) => typeof image === 'string' && image.length > 0)
  }

  return []
}

export function ImageGallery({ images, title, className, orderId }: ImageGalleryProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const normalizedImages = normalizeGalleryFiles(images)

  const selectedFileName = selectedFile
    ? getFileName(selectedFile, normalizedImages.indexOf(selectedFile))
    : ''
  const selectedPreviewUrl = selectedFile
    ? getSavedFilePreviewUrl(selectedFile, orderId)
    : ''
  const selectedIsPdf = selectedFile ? isPdfUrl(selectedFile) : false
  const selectedIsImage = selectedFile ? isImageUrl(selectedFile) || !selectedIsPdf : false

  if (!normalizedImages || normalizedImages.length === 0) {
    return null
  }

  return (
    <>
      <Card className={cn('border-gray-200', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            {title}
            <span className="text-sm text-gray-500">({normalizedImages.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {normalizedImages.map((image, index) => {
              const isPdf = isPdfUrl(image)
              const isImage = isImageUrl(image) || !isPdf

              return (
              <div
                key={index}
                className="relative group cursor-pointer rounded-lg overflow-hidden border-2 border-gray-200 hover:border-blue-400 transition-all aspect-square bg-gradient-to-br from-gray-100 to-gray-200"
                onClick={() => setSelectedFile(image)}
              >
                {isImage ? (
                  <img
                    src={getSavedFilePreviewUrl(image, orderId)}
                    alt={`${title} ${index + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
                    <FileText className="h-10 w-10" />
                    <p className="text-xs font-black uppercase tracking-widest">PDF</p>
                  </div>
                )}
                <div className="absolute inset-x-2 bottom-2 rounded-xl bg-slate-950/75 px-2 py-1 text-center text-[10px] font-black uppercase tracking-widest text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  Click to preview
                </div>
              </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {selectedFile && (
        <div
          className="fixed inset-0 z-[100] flex animate-in fade-in duration-200 items-center justify-center bg-slate-950/95 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Document preview"
        >
          <button
            type="button"
            onClick={() => setSelectedFile(null)}
            className="absolute right-4 top-4 z-50 rounded-full border border-white/20 bg-white/10 p-3 text-white shadow-xl backdrop-blur-md transition-all hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
            aria-label="Close document preview"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="flex h-full w-full items-center justify-center overflow-auto rounded-2xl">
            {selectedIsImage && (
              <img
                src={selectedPreviewUrl}
                alt={selectedFileName || 'Full size preview'}
                className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                onError={(e) => {
                  console.error('Image failed to load. URL:', selectedFile)
                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23333" width="400" height="300"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em" font-size="20"%3EImage not available%3C/text%3E%3C/svg%3E'
                }}
              />
            )}
            {selectedIsPdf && (
              <iframe
                src={selectedPreviewUrl}
                title={selectedFileName || 'PDF preview'}
                className="h-full min-h-[70vh] w-full max-w-6xl rounded-xl bg-white shadow-2xl"
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Made with Bob
