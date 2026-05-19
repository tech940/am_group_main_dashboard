'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X, FileText, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'

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

      {/* Fullscreen File Preview Dialog */}
      <Dialog open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <DialogContent className="max-w-none w-screen h-screen p-0 bg-black border-none m-0">
          <VisuallyHidden.Root>
            <DialogTitle>Document Preview</DialogTitle>
          </VisuallyHidden.Root>
          <div className="relative w-full h-full bg-black flex items-center justify-center">
            <button
              onClick={() => setSelectedFile(null)}
              className="absolute top-6 right-6 z-50 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white rounded-full p-3 transition-all border border-white/20"
              aria-label="Close document preview"
            >
              <X className="h-6 w-6" />
            </button>
            {selectedFile && selectedIsImage && (
              <img
                src={selectedPreviewUrl}
                alt={selectedFileName || 'Full size preview'}
                className="w-full h-full object-contain"
                onError={(e) => {
                  console.error('Image failed to load. URL:', selectedFile)
                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23333" width="400" height="300"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em" font-size="20"%3EImage not available%3C/text%3E%3C/svg%3E'
                }}
              />
            )}
            {selectedFile && selectedIsPdf && (
              <iframe
                src={selectedPreviewUrl}
                title={selectedFileName || 'PDF preview'}
                className="h-full w-full bg-white"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Made with Bob
