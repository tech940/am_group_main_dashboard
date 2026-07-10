'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { FileText, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type VendorOption = {
  name?: string | null
  images?: Array<string | File> | null
}

export type PurchaseOrderDocumentSource = {
  id: string
  orderNumber?: string | null
  order_number?: string | null
  department?: string | null
  subDepartment?: string | null
  sub_department?: string | null
  requestedBy?: string | null
  requested_by?: string | null
  vendorName?: string | null
  vendor_name?: string | null
  amount?: string | number | null
  supportingImages?: Array<string | File> | null
  supporting_images?: string[] | null
  vendorImages?: Array<string | File> | null
  vendor_images?: string[] | null
  vendorDetails?: VendorOption[] | null
  vendor_details?: VendorOption[] | null
  billImages?: Array<string | File> | null
  bill_images?: string[] | null
  grnImages?: Array<string | File> | null
  grn_images?: string[] | null
  accountsImages?: Array<string | File> | null
  accounts_images?: string[] | null
  quotation1Url?: string | null
  quotation_1_url?: string | null
  quotation2Url?: string | null
  quotation_2_url?: string | null
  quotation3Url?: string | null
  quotation_3_url?: string | null
  invoice1Url?: string | null
  invoice_1_url?: string | null
  invoice2Url?: string | null
  invoice_2_url?: string | null
  invoice3Url?: string | null
  invoice_3_url?: string | null
  invoice4Url?: string | null
  invoice_4_url?: string | null
  paymentScreenshotUrl?: string | null
  payment_screenshot_url?: string | null
}

type PreviewDocument = {
  file: string
  label: string
}

function isPdfUrl(value: string) {
  return value.toLowerCase().split('?')[0].endsWith('.pdf')
}

function isImageUrl(value: string) {
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(value.toLowerCase().split('?')[0])
}

function isPreviewableFile(value: string) {
  return isImageUrl(value) || isPdfUrl(value)
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
  if (orderId) params.set('orderId', orderId)
  return `/api/purchase-orders/file?${params.toString()}`
}

function asFileList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function addFiles(target: PreviewDocument[], label: string, files: unknown) {
  asFileList(files).forEach((file) => target.push({ file, label }))
}

function addFile(target: PreviewDocument[], label: string, file: unknown) {
  if (typeof file === 'string' && file.trim()) {
    target.push({ file, label })
  }
}

export function getPurchaseOrderTransactionLabel(order: PurchaseOrderDocumentSource) {
  const orderNumber = order.orderNumber || order.order_number || order.id
  const department = order.department || 'Department not set'
  const requester = order.requestedBy || order.requested_by || 'Requester not set'
  const vendor = order.vendorName || order.vendor_name || 'Vendor pending'
  return `${orderNumber} | ${department} | ${requester} | ${vendor}`
}

export function getPurchaseOrderDocuments(order: PurchaseOrderDocumentSource): PreviewDocument[] {
  const documents: PreviewDocument[] = []
  addFiles(documents, 'Request Images', order.supportingImages || order.supporting_images)
  addFiles(documents, 'Vendor Images', order.vendorImages || order.vendor_images)
  addFiles(documents, 'Bill Images', order.billImages || order.bill_images)
  addFiles(documents, 'GRN Documents', order.grnImages || order.grn_images)
  addFiles(documents, 'Accounts Documents', order.accountsImages || order.accounts_images)

  const vendorOptions = order.vendorDetails || order.vendor_details || []
  vendorOptions.forEach((vendor, vendorIndex) => {
    addFiles(documents, vendor.name ? `Vendor: ${vendor.name}` : `Vendor Option ${vendorIndex + 1}`, vendor.images)
  })

  addFile(documents, 'Quotation 1', order.quotation1Url || order.quotation_1_url)
  addFile(documents, 'Quotation 2', order.quotation2Url || order.quotation_2_url)
  addFile(documents, 'Quotation 3', order.quotation3Url || order.quotation_3_url)
  addFile(documents, 'Invoice 1', order.invoice1Url || order.invoice_1_url)
  addFile(documents, 'Invoice 2', order.invoice2Url || order.invoice_2_url)
  addFile(documents, 'Invoice 3', order.invoice3Url || order.invoice_3_url)
  addFile(documents, 'Invoice 4', order.invoice4Url || order.invoice_4_url)
  addFile(documents, 'Payment Screenshot', order.paymentScreenshotUrl || order.payment_screenshot_url)

  const seen = new Set<string>()
  return documents.filter((document) => {
    const normalizedFile = document.file.split('?')[0].trim().toLowerCase()
    if (seen.has(normalizedFile)) return false
    seen.add(normalizedFile)
    return true
  })
}

export function PurchaseOrderImagePreviewButton({
  order,
  className,
}: {
  order: PurchaseOrderDocumentSource
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [failedFiles, setFailedFiles] = useState<Set<string>>(new Set())
  const documents = useMemo(() => getPurchaseOrderDocuments(order), [order])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const transactionLabel = getPurchaseOrderTransactionLabel(order)
  const activeFile = selectedFile || documents[0]?.file || ''
  const activeDocument = documents.find((document) => document.file === activeFile)
  const activePreviewUrl = activeFile ? getSavedFilePreviewUrl(activeFile, order.id) : ''
  const activeIsPdf = activeFile ? isPdfUrl(activeFile) : false
  const activeIsImage = activeFile ? isImageUrl(activeFile) : false
  const disabled = documents.length === 0
  const hoverTitle = disabled
    ? `No documents available for ${transactionLabel}`
    : `View ${documents.length} document${documents.length === 1 ? '' : 's'} for ${transactionLabel}`
  const activeFailed = activeFile ? failedFiles.has(activeFile) : false

  useEffect(() => {
    if (!loadingFile) return

    const timeout = window.setTimeout(() => {
      setLoadingFile((current) => (current === loadingFile ? null : current))
      setFailedFiles((current) => {
        const next = new Set(current)
        next.add(loadingFile)
        return next
      })
    }, 10000)

    return () => window.clearTimeout(timeout)
  }, [loadingFile])

  const openPreview = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (disabled) return
    const firstFile = documents[0]?.file || null
    setSelectedFile(firstFile)
    setLoadingFile(firstFile && isPreviewableFile(firstFile) ? firstFile : null)
    setOpen(true)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) return
    setLoadingFile(null)
    setFailedFiles(new Set())
  }

  const markLoaded = () => {
    setLoadingFile(null)
    if (!activeFile) return
    setFailedFiles((current) => {
      if (!current.has(activeFile)) return current
      const next = new Set(current)
      next.delete(activeFile)
      return next
    })
  }

  const markFailed = () => {
    setLoadingFile(null)
    if (!activeFile) return
    setFailedFiles((current) => {
      const next = new Set(current)
      next.add(activeFile)
      return next
    })
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={openPreview}
        disabled={disabled}
        aria-label={hoverTitle}
        title={hoverTitle}
        className={cn(
          'relative h-8 w-8 rounded-xl border-[var(--dashboard-primary-border)] bg-white p-0 text-[var(--dashboard-action-bg)] shadow-sm hover:bg-[var(--dashboard-primary-soft)] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300',
          className
        )}
      >
        <ImageIcon className="h-3.5 w-3.5" />
        {!disabled && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--dashboard-action-bg)] px-1 text-[9px] font-black text-[var(--dashboard-action-fg)]">
            {Math.min(documents.length, 9)}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-[1040px]">
          <DialogHeader className="border-b border-slate-200 bg-[var(--dashboard-action-bg)] px-5 py-4 text-[var(--dashboard-action-fg)]">
            <div className="pr-10">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-75">Purchase Order Documents</p>
              <DialogTitle className="mt-1 text-xl font-black text-[var(--dashboard-action-fg)]">
                {order.orderNumber || order.order_number || order.id}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs font-semibold text-[var(--dashboard-action-fg)]/75">
                {transactionLabel}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="grid max-h-[calc(88vh-96px)] grid-cols-1 overflow-hidden bg-slate-50 md:grid-cols-[260px_1fr]">
            <div className="max-h-64 overflow-y-auto border-b border-slate-200 bg-white p-3 md:max-h-none md:border-b-0 md:border-r">
              <div className="space-y-2">
                {documents.map((document, index) => {
                  const isActive = document.file === activeFile
                  return (
                    <button
                      key={`${document.label}-${document.file}`}
                      type="button"
                      title={`${document.label} - ${getFileName(document.file, index)} - ${transactionLabel}`}
                      onClick={() => {
                        setSelectedFile(document.file)
                        setLoadingFile(isPreviewableFile(document.file) ? document.file : null)
                        setFailedFiles((current) => {
                          if (!current.has(document.file)) return current
                          const next = new Set(current)
                          next.delete(document.file)
                          return next
                        })
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition',
                        isActive
                          ? 'border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-[var(--dashboard-primary-border)]'
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                        {isPdfUrl(document.file) ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black">{document.label}</p>
                        <p className="truncate text-[10px] font-bold opacity-70">
                          {getFileName(document.file, index)}
                          {failedFiles.has(document.file) ? ' - preview issue' : ''}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="relative flex min-h-[58vh] items-center justify-center overflow-auto p-4">
              {loadingFile === activeFile && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/45 backdrop-blur-[1px]">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center shadow-xl">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--dashboard-action-bg)]" />
                    <p className="mt-2 text-xs font-black uppercase tracking-widest text-slate-500">Loading preview</p>
                  </div>
                </div>
              )}
              {activeFailed ? (
                <div className="max-w-md rounded-3xl border border-amber-200 bg-white p-6 text-center shadow-xl">
                  <FileText className="mx-auto h-10 w-10 text-amber-600" />
                  <h3 className="mt-3 text-lg font-black text-slate-950">Preview not available</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    This document may be too large, still syncing, or not a browser-previewable image/PDF.
                  </p>
                  <a
                    href={activePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="app-primary-action mt-4 inline-flex rounded-2xl px-4 py-2 text-xs font-black"
                  >
                    Open file
                  </a>
                </div>
              ) : activeIsImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activePreviewUrl}
                  alt={`${activeDocument?.label || 'Document'} preview for ${transactionLabel}`}
                  className="max-h-[68vh] max-w-full rounded-2xl object-contain shadow-2xl"
                  onLoad={markLoaded}
                  onError={markFailed}
                />
              ) : activeIsPdf ? (
                <iframe
                  src={activePreviewUrl}
                  title={`${activeDocument?.label || 'PDF'} preview for ${transactionLabel}`}
                  className="h-[68vh] w-full rounded-2xl bg-white shadow-2xl"
                  onLoad={markLoaded}
                  onError={markFailed}
                />
              ) : (
                <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl">
                  <FileText className="mx-auto h-10 w-10 text-[var(--dashboard-action-bg)]" />
                  <h3 className="mt-3 text-lg font-black text-slate-950">Open document</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    This file type is best viewed in a separate browser tab.
                  </p>
                  <a
                    href={activePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="app-primary-action mt-4 inline-flex rounded-2xl px-4 py-2 text-xs font-black"
                  >
                    Open file
                  </a>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
