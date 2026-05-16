'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X, Eye, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'

interface ImageGalleryProps {
  images: string[]
  title: string
  className?: string
}

export function ImageGallery({ images, title, className }: ImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)

  // Normalize images - handle various data formats
  const normalizedImages = React.useMemo(() => {
    if (!images) return []
    
    // If images is already an array of strings, use it
    if (Array.isArray(images)) {
      return images.filter(img => typeof img === 'string' && img.length > 0)
    }
    
    // If images is an object, try to extract array
    if (typeof images === 'object') {
      // Check if it has a property that contains the array
      const possibleArrays = Object.values(images).filter(Array.isArray)
      if (possibleArrays.length > 0) {
        return possibleArrays[0].filter(img => typeof img === 'string' && img.length > 0)
      }
    }
    
    return []
  }, [images])

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
            {normalizedImages.map((image, index) => (
              <div
                key={index}
                className="relative group cursor-pointer rounded-lg overflow-hidden border-2 border-gray-200 hover:border-blue-400 transition-all aspect-square bg-gradient-to-br from-gray-100 to-gray-200"
                onClick={() => setSelectedImage(image)}
              >
                {/* Glassmorphism Overlay with "View Image" text */}
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <div className="bg-white/80 backdrop-blur-md rounded-lg px-6 py-4 border border-white/20 shadow-xl transform transition-all duration-300 group-hover:scale-110 group-hover:bg-white/90">
                    <div className="flex flex-col items-center gap-2">
                      <Eye className="h-8 w-8 text-blue-600" />
                      <p className="text-sm font-semibold text-gray-800">View Image</p>
                    </div>
                  </div>
                </div>
                
                {/* Hidden actual image for reference */}
                <div className="absolute inset-0 opacity-0">
                  <img
                    src={image}
                    alt={`${title} ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Fullscreen Image Preview Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-none w-screen h-screen p-0 bg-black border-none m-0">
          <VisuallyHidden.Root>
            <DialogTitle>Image Preview</DialogTitle>
          </VisuallyHidden.Root>
          <div className="relative w-full h-full bg-black flex items-center justify-center">
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-6 right-6 z-50 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white rounded-full p-3 transition-all border border-white/20"
              aria-label="Close image preview"
            >
              <X className="h-6 w-6" />
            </button>
            {selectedImage && typeof selectedImage === 'string' && (
              <img
                src={selectedImage}
                alt="Full size preview"
                className="w-full h-full object-contain"
                onError={(e) => {
                  console.error('Image failed to load. URL:', selectedImage)
                  console.error('Image type:', typeof selectedImage)
                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23333" width="400" height="300"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em" font-size="20"%3EImage not available%3C/text%3E%3C/svg%3E'
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Made with Bob