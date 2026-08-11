'use client'

import { useState } from 'react'
import { ScrapTransaction, ScrapAttachment } from '@/lib/scrap-erp/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Download, ZoomIn, ZoomOut, RotateCw, Upload, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ScrapImageGalleryModal({
  transaction,
  open,
  isOpen,
  onClose,
  onAttachmentsUpdated,
}: {
  transaction: ScrapTransaction | null
  open?: boolean
  isOpen?: boolean
  onClose: () => void
  onAttachmentsUpdated?: (updatedTxn: ScrapTransaction) => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [localAttachments, setLocalAttachments] = useState<ScrapAttachment[] | null>(null)

  const isDialogOpen = open !== undefined ? open : Boolean(isOpen)

  if (!transaction) return null

  const attachments = localAttachments !== null ? localAttachments : (transaction.attachments || [])
  const current = attachments[activeIdx] || attachments[0]

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !transaction) return
    setIsUploading(true)

    try {
      const fileList = Array.from(files)
      const newAtts: ScrapAttachment[] = []

      for (const file of fileList) {
        const dataUrl = await readFileAsDataUrl(file)
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        const attType: ScrapAttachment['type'] = isPdf ? 'tally_receipt' : 'scrap_picture'

        newAtts.push({
          id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          transactionId: transaction.id,
          type: attType,
          fileName: file.name,
          url: dataUrl,
          fileSize: file.size,
        })
      }

      const updatedAttachments = [...attachments, ...newAtts]

      const response = await fetch('/api/scrap-erp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: transaction.id,
          attachments: updatedAttachments,
        }),
      })

      const result = await response.json()
      if (result.success && result.transaction) {
        setLocalAttachments(result.transaction.attachments || updatedAttachments)
        if (onAttachmentsUpdated) {
          onAttachmentsUpdated(result.transaction)
        }
      } else {
        setLocalAttachments(updatedAttachments)
      }
    } catch (err) {
      console.error('Failed to upload attachment:', err)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl overflow-hidden rounded-2xl p-0 backdrop-blur-md">
        <DialogHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-sm font-extrabold text-foreground">
              Media Attachments — {transaction.transactionNumber}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {transaction.locationName} · {transaction.scrapTypeName} ({transaction.weightQty} {transaction.unit})
            </p>
          </div>
          <div className="flex items-center gap-2 pr-6">
            <label className="cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
                disabled={isUploading}
              />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors">
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload Files
              </span>
            </label>
          </div>
        </DialogHeader>

        {attachments.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center space-y-4">
            <div className="h-16 w-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <ImageIcon className="h-8 w-8" />
            </div>
            <div className="max-w-sm space-y-1">
              <h3 className="text-sm font-black text-foreground">No actual images uploaded for this order yet</h3>
              <p className="text-xs text-muted-foreground">
                Historical records imported from Excel register do not have photos attached. You can upload actual weighment slips, material photos, or payment receipts below.
              </p>
            </div>
            <label className="cursor-pointer mt-2">
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
                disabled={isUploading}
              />
              <span className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-black rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all transform hover:scale-[1.02]">
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload Actual Order Photos / Documents
              </span>
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {/* Left 2 Cols: Main Lightbox Viewer */}
            <div className="md:col-span-2 bg-muted/20 p-6 flex flex-col items-center justify-center relative min-h-[340px]">
              <div className="absolute top-3 right-3 flex items-center gap-1 bg-background/90 backdrop-blur-sm p-1 rounded-xl border border-border z-10 shadow-sm">
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
                <div className="w-full flex items-center justify-center overflow-hidden rounded-xl bg-background border border-border p-2 min-h-[280px]">
                  {current.url.startsWith('data:application/pdf') || current.fileName.endsWith('.pdf') ? (
                    <div className="text-center p-8 space-y-3">
                      <p className="text-xs font-bold text-foreground">{current.fileName}</p>
                      <a
                        href={current.url}
                        download={current.fileName}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white"
                      >
                        <Download className="h-3.5 w-3.5" /> Open / Download PDF
                      </a>
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={current.url}
                      alt={current.fileName}
                      className="max-h-[300px] object-contain transition-transform duration-200"
                      style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Right Col: Attachments Thumbnails */}
            <div className="p-4 border-t md:border-t-0 md:border-l border-border space-y-3 bg-card">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground block">
                  Files ({attachments.length})
                </span>
              </div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {attachments.map((att, idx) => (
                  <div
                    key={att.id || idx}
                    onClick={() => {
                      setActiveIdx(idx)
                      setZoom(1)
                      setRotation(0)
                    }}
                    className={`cursor-pointer rounded-xl border p-2.5 flex items-center justify-between text-xs transition-colors ${
                      idx === activeIdx
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 font-bold'
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
