'use client'

import { useState } from 'react'
import { ScrapTransaction } from '@/lib/scrap-erp/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Download, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ScrapImageGalleryModal({
  transaction,
  open,
  isOpen,
  onClose,
}: {
  transaction: ScrapTransaction | null
  open?: boolean
  isOpen?: boolean
  onClose: () => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)

  const isDialogOpen = open !== undefined ? open : Boolean(isOpen)

  if (!transaction) return null

  const attachments = transaction.attachments || []
  const current = attachments[activeIdx] || attachments[0]

  return (
    <Dialog open={isDialogOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl overflow-hidden rounded-2xl p-0">
        <DialogHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-sm font-extrabold text-foreground">
              Media Attachments — {transaction.transactionNumber}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {transaction.locationName} · {transaction.scrapTypeName} ({transaction.weightQty} {transaction.unit})
            </p>
          </div>
        </DialogHeader>

        {attachments.length === 0 ? (
          <div className="p-12 text-center text-xs font-bold text-muted-foreground">
            No media attachments found for this transaction.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {/* Left 2 Cols: Main Lightbox Viewer */}
            <div className="md:col-span-2 bg-muted/20 p-6 flex flex-col items-center justify-center relative min-h-[320px]">
              <div className="absolute top-3 right-3 flex items-center gap-1 bg-background/80 backdrop-blur-xs p-1 rounded-xl border border-border z-10">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setZoom((prev) => Math.min(prev + 0.25, 3))}
                  className="h-7 w-7"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setZoom((prev) => Math.max(prev - 0.25, 0.5))}
                  className="h-7 w-7"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRotation((prev) => (prev + 90) % 360)}
                  className="h-7 w-7"
                  title="Rotate"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {current && (
                <div className="w-full flex items-center justify-center overflow-hidden rounded-xl bg-background border border-border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={current.url}
                    alt={current.fileName}
                    className="max-h-[300px] object-contain transition-transform duration-200"
                    style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                  />
                </div>
              )}
            </div>

            {/* Right Col: Attachments Thumbnails */}
            <div className="p-4 border-t md:border-t-0 md:border-l border-border space-y-3 bg-card">
              <span className="text-xs font-bold text-foreground block">
                Files ({attachments.length})
              </span>
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {attachments.map((att, idx) => (
                  <div
                    key={att.id}
                    onClick={() => {
                      setActiveIdx(idx)
                      setZoom(1)
                      setRotation(0)
                    }}
                    className={`cursor-pointer rounded-xl border p-2.5 flex items-center justify-between text-xs transition-colors ${
                      idx === activeIdx
                        ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-600 font-bold'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="truncate font-semibold">{att.fileName}</div>
                      <div className="text-[10px] opacity-70 uppercase">{att.type.replace('_', ' ')}</div>
                    </div>
                    <a
                      href={att.url}
                      download={att.fileName}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
