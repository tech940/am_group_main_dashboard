'use client'

import { useMemo, useState } from 'react'
import { FileText, Image as ImageIcon, RefreshCw, Upload, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface MultipleImageUploadProps {
  label: string
  images: Array<File | string>
  onImagesChange: (images: Array<File | string>) => void
  maxImages?: number
  required?: boolean
  orderId?: string
}

interface PreviewItem {
  id: string
  file: File | string
  name: string
  src: string | null
  isImage: boolean
  isPdf: boolean
  sizeLabel: string | null
}

const filePreviewUrls = new WeakMap<File, string>()

function isBrowserFile(value: File | string): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

function getFilePreviewUrl(file: File) {
  const existingUrl = filePreviewUrls.get(file)
  if (existingUrl) {
    return existingUrl
  }

  const nextUrl = URL.createObjectURL(file)
  filePreviewUrls.set(file, nextUrl)
  return nextUrl
}

function isPdfUrl(value: string) {
  return value.toLowerCase().split('?')[0].endsWith('.pdf')
}

function isImageUrl(value: string) {
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(value.toLowerCase().split('?')[0])
}

function getSavedFilePreviewUrl(file: string, orderId?: string) {
  const params = new URLSearchParams({ file })

  if (orderId) {
    params.set('orderId', orderId)
  }

  return `/api/purchase-orders/file?${params.toString()}`
}

function getFileName(file: File | string, index: number) {
  if (isBrowserFile(file)) {
    return file.name
  }

  try {
    return decodeURIComponent(file.split('/').pop()?.split('?')[0] || `Uploaded file ${index + 1}`)
  } catch {
    return file.split('/').pop()?.split('?')[0] || `Uploaded file ${index + 1}`
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getRejectedFiles(files: File[]) {
  return files.filter((file) => {
    const isAllowedType = file.type.startsWith('image/') || file.type === 'application/pdf'
    const isUnder10MB = file.size <= 10 * 1024 * 1024
    return !isAllowedType || !isUnder10MB
  })
}

function getValidFiles(files: File[]) {
  return files.filter((file) => {
    const isAllowedType = file.type.startsWith('image/') || file.type === 'application/pdf'
    const isUnder10MB = file.size <= 10 * 1024 * 1024
    return isAllowedType && isUnder10MB
  })
}

export function MultipleImageUpload({
  label,
  images,
  onImagesChange,
  maxImages = 10,
  required = false,
  orderId,
}: MultipleImageUploadProps) {
  const [showUpload, setShowUpload] = useState(images.length === 0)
  const [dragActive, setDragActive] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const previews = useMemo<PreviewItem[]>(() => (
    images.map((file, index) => {
      const isFile = isBrowserFile(file)
      const isImage = isFile ? file.type.startsWith('image/') : isImageUrl(file) || !isPdfUrl(file)
      const isPdf = isFile ? file.type === 'application/pdf' : isPdfUrl(file)

      return {
        id: `${index}-${getFileName(file, index)}`,
        file,
        name: getFileName(file, index),
        src: isFile && (isImage || isPdf)
          ? getFilePreviewUrl(file)
          : typeof file === 'string'
            ? getSavedFilePreviewUrl(file, orderId)
            : null,
        isImage,
        isPdf,
        sizeLabel: isFile ? formatFileSize(file.size) : null,
      }
    })
  ), [images, orderId])

  const selectedPreview = selectedIndex === null ? null : previews[selectedIndex] || null

  const addFiles = (files: File[]) => {
    const rejectedFiles = getRejectedFiles(files)
    const validFiles = getValidFiles(files)

    if (rejectedFiles.length > 0) {
      alert('Some files were skipped. Only images or PDFs up to 10MB are allowed.')
    }

    if (validFiles.length === 0) {
      return
    }

    if (images.length + validFiles.length > maxImages) {
      alert(`Maximum ${maxImages} files allowed`)
      return
    }

    setShowUpload(true)
    onImagesChange([...images, ...validFiles])
  }

  const replaceImage = (index: number, file: File | undefined) => {
    if (!file) {
      return
    }

    const [validFile] = getValidFiles([file])
    if (!validFile) {
      alert('Only images or PDFs up to 10MB are allowed.')
      return
    }

    onImagesChange(images.map((current, currentIndex) => (
      currentIndex === index ? validFile : current
    )))
  }

  const removeImage = (index: number) => {
    const nextImages = images.filter((_, currentIndex) => currentIndex !== index)
    onImagesChange(nextImages)
    setSelectedIndex((current) => {
      if (current === null) return null
      if (current === index) return null
      return current > index ? current - 1 : current
    })
    if (nextImages.length === 0) {
      setShowUpload(true)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []))
    event.target.value = ''
  }

  const handleDrag = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(event.type === 'dragenter' || event.type === 'dragover')
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    addFiles(Array.from(event.dataTransfer.files || []))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="text-sm font-bold text-slate-800">
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
        <Button
          type="button"
          variant={showUpload ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowUpload((value) => !value)}
          className="rounded-xl"
        >
          <Upload className="mr-2 h-4 w-4" />
          {showUpload ? 'Hide Uploader' : 'Add More'}
        </Button>
      </div>

      {showUpload && images.length < maxImages && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={cn(
            'relative rounded-2xl border-2 border-dashed p-6 transition-all duration-200',
            dragActive
              ? 'border-[#023468] bg-[#edf4fb] shadow-inner'
              : 'border-slate-300 bg-white hover:border-[#8ca8c0] hover:bg-[#edf4fb]/70'
          )}
        >
          <input
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={handleFileChange}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`Upload ${label}`}
          />
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Upload className="h-7 w-7" />
            </div>
            <p className="text-sm font-bold text-slate-800">Click to upload or drag and drop</p>
            <p className="mt-1 text-xs text-slate-500">Images or PDF, 10MB each</p>
            <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
              {images.length} / {maxImages} uploaded
            </p>
          </div>
        </div>
      )}

      {images.length >= maxImages && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Maximum {maxImages} files added. Delete or replace an existing file to upload another.
        </div>
      )}

      {previews.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {previews.map((preview, index) => (
            <div
              key={preview.id}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#b9ccde] hover:shadow-lg"
            >
              <button
                type="button"
                onClick={() => setSelectedIndex(index)}
                className="relative block aspect-square w-full overflow-hidden bg-slate-100"
              >
                {preview.isImage && preview.src ? (
                  <img
                    src={preview.src}
                    alt={preview.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
                    {preview.isPdf ? <FileText className="h-9 w-9" /> : <ImageIcon className="h-9 w-9" />}
                    <span className="text-xs font-bold uppercase tracking-widest">
                      {preview.isPdf ? 'PDF' : 'File'}
                    </span>
                  </div>
                )}
                <span className="absolute inset-x-2 bottom-2 rounded-xl bg-slate-950/70 px-2 py-1 text-center text-[10px] font-black uppercase tracking-widest text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  Click to preview
                </span>
              </button>

              <div className="space-y-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-800">{preview.name}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    {preview.sizeLabel || 'Saved file'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label
                    className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50"
                    title="Replace"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="sr-only"
                      onChange={(event) => {
                        replaceImage(index, event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => removeImage(index)}
                    className="h-9 rounded-xl border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                    title="Delete"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPreview && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{selectedPreview.name}</p>
                <p className="text-xs text-slate-500">{selectedPreview.sizeLabel || 'Saved file'}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedIndex(null)}
                className="rounded-xl"
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex max-h-[calc(90vh-76px)] items-center justify-center bg-slate-950 p-4">
              {selectedPreview.isImage && selectedPreview.src ? (
                <img
                  src={selectedPreview.src}
                  alt={selectedPreview.name}
                  className="max-h-[calc(90vh-108px)] max-w-full rounded-2xl object-contain"
                />
              ) : selectedPreview.src ? (
                <iframe
                  src={selectedPreview.src}
                  title={selectedPreview.name}
                  className="h-[calc(90vh-108px)] w-full rounded-2xl bg-white"
                />
              ) : (
                <div className="rounded-2xl bg-white p-8 text-center">
                  <FileText className="mx-auto mb-3 h-10 w-10 text-slate-400" />
                  <p className="text-sm font-semibold text-slate-700">Preview is not available for this file.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Made with Bob
