'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultipleImageUploadProps {
  label: string
  images: File[]
  onImagesChange: (images: File[]) => void
  maxImages?: number
  required?: boolean
}

export function MultipleImageUpload({
  label,
  images,
  onImagesChange,
  maxImages = 10,
  required = false
}: MultipleImageUploadProps) {
  const [showUpload, setShowUpload] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/') || file.type === 'application/pdf'
      const isUnder10MB = file.size <= 10 * 1024 * 1024
      return isImage && isUnder10MB
    })

    if (images.length + validFiles.length > maxImages) {
      alert(`Maximum ${maxImages} files allowed`)
      return
    }

    onImagesChange([...images, ...validFiles])
  }

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index)
    onImagesChange(newImages)
    if (newImages.length === 0) {
      setShowUpload(false)
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = Array.from(e.dataTransfer.files)
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/') || file.type === 'application/pdf'
      const isUnder10MB = file.size <= 10 * 1024 * 1024
      return isImage && isUnder10MB
    })

    if (images.length + validFiles.length > maxImages) {
      alert(`Maximum ${maxImages} files allowed`)
      return
    }

    onImagesChange([...images, ...validFiles])
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showUpload}
            onChange={(e) => {
              setShowUpload(e.target.checked)
              if (!e.target.checked) {
                onImagesChange([])
              }
            }}
            className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
          />
          <span className="text-sm text-slate-600">Upload Supporting Images</span>
        </label>
      </div>

      {showUpload && (
        <div className="space-y-3">
          {/* Upload Area */}
          {images.length < maxImages && (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={cn(
                'relative border-2 border-dashed rounded-lg p-6 transition-colors',
                dragActive
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-slate-300 hover:border-teal-400'
              )}
            >
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="text-center">
                <Upload className="h-10 w-10 mx-auto text-slate-400 mb-3" />
                <p className="text-sm font-medium text-slate-700 mb-1">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-slate-500">
                  Images or PDF (Max {maxImages} files, 10MB each)
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {images.length} / {maxImages} files uploaded
                </p>
              </div>
            </div>
          )}

          {/* Image Preview Grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {images.map((file, index) => (
                <div
                  key={index}
                  className="relative group bg-slate-50 rounded-lg border border-slate-200 p-2"
                >
                  <div className="aspect-square rounded-md bg-slate-100 flex items-center justify-center overflow-hidden">
                    {file.type.startsWith('image/') ? (
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-slate-400 mb-1" />
                        <span className="text-xs text-slate-500">PDF</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <p className="text-xs font-medium text-slate-700 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Made with Bob