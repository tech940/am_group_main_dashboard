'use client'

import { ScrapTransaction } from '@/lib/scrap-erp/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Building2,
  DollarSign,
  UserCheck,
  CreditCard,
  User,
  Calendar,
  Eye,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export function ScrapRecordDetailModal({
  transaction,
  isOpen,
  onClose,
  onOpenGallery,
}: {
  transaction: ScrapTransaction | null
  isOpen: boolean
  onClose: () => void
  onOpenGallery?: (txn: ScrapTransaction) => void
}) {
  if (!transaction) return null

  const isDue = Math.round(Number(transaction.outstandingAmount || 0)) >= 1

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] lg:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl p-6">
        <DialogHeader className="shrink-0 border-b border-border pb-4 pr-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-black text-foreground border-border">
                  {transaction.transactionNumber}
                </Badge>
                <Badge variant="secondary" className="text-xs font-bold">
                  {transaction.groupName || 'JAM'}
                </Badge>
                {isDue ? (
                  <Badge variant="destructive" className="text-xs font-extrabold flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Outstanding Due
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs font-extrabold text-foreground border-border flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Fully Settled
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-lg font-black text-foreground mt-1">
                Scrap Disposal Full Transaction Record
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Recorded on {transaction.soldDate || transaction.timestamp.slice(0, 10)}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 pt-2 pr-1 space-y-4">
          {/* Financial Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
            <Card className="bg-muted/40 border-border">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-extrabold uppercase text-muted-foreground">Total Valuation</span>
                <div className="text-xl font-black text-foreground">
                  {formatINR(transaction.calculatedTotal)}
                </div>
                <p className="text-[10px] text-muted-foreground font-semibold">
                  {transaction.weightQty} {transaction.unit} × ₹{transaction.ratePerUnit}/unit
                </p>
              </CardContent>
            </Card>

            <Card className="bg-muted/40 border-border">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-extrabold uppercase text-muted-foreground">Amount Received</span>
                <div className="text-xl font-black text-foreground">
                  {formatINR(transaction.amountReceived)}
                </div>
                <p className="text-[10px] text-muted-foreground font-semibold">
                  Payment Mode: {transaction.paymentModeName}
                </p>
              </CardContent>
            </Card>

            <Card className={isDue ? 'bg-destructive/10 border-destructive/30' : 'bg-muted/40 border-border'}>
              <CardContent className="p-4 space-y-1">
                <span className={`text-[11px] font-extrabold uppercase ${isDue ? 'text-destructive' : 'text-muted-foreground'}`}>
                  Balance Outstanding
                </span>
                <div className={`text-xl font-black ${isDue ? 'text-destructive' : 'text-foreground'}`}>
                  {formatINR(transaction.outstandingAmount)}
                </div>
                <p className="text-[10px] text-muted-foreground font-semibold">
                  {isDue ? 'Requires follow-up collection' : 'Zero pending balance'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Sections Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column 1: Classification & Material */}
            <Card className="border border-border bg-card">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-xs font-black uppercase text-foreground border-b border-border pb-2 flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" /> Origin & Scrap Classification
                </h4>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Dealership Group:</span>
                    <span className="font-bold text-foreground">{transaction.groupName || 'JAM'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Department:</span>
                    <span className="font-bold text-foreground">{transaction.departmentName}</span>
                  </div>
                </div>

                <div className="text-xs">
                  <span className="text-muted-foreground block text-[11px]">Dealership Location:</span>
                  <span className="font-extrabold text-foreground">{transaction.locationName}</span>
                </div>

                <div className="border-t border-border pt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Scrap Material Category:</span>
                    <span className="font-extrabold text-foreground">{transaction.scrapTypeName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Unit of Measure:</span>
                    <span className="font-bold text-foreground">{transaction.unit}</span>
                  </div>
                </div>

                <div className="text-xs">
                  <span className="text-muted-foreground block text-[11px]">Item Description:</span>
                  <span className="font-semibold text-foreground">{transaction.description || 'N/A'}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-border pt-2">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Weight / Quantity:</span>
                    <span className="font-black text-foreground">{transaction.weightQty.toLocaleString('en-IN')} {transaction.unit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Rate per Unit:</span>
                    <span className="font-black text-foreground">₹{transaction.ratePerUnit}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Column 2: Buyer & Payment Handover */}
            <Card className="border border-border bg-card">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-xs font-black uppercase text-foreground border-b border-border pb-2 flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4" /> Buyer & Payment Handover
                </h4>

                <div className="text-xs">
                  <span className="text-muted-foreground block text-[11px]">Sold To (Buyer / Merchant):</span>
                  <span className="font-extrabold text-foreground text-sm">{transaction.soldTo || 'N/A'}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-border pt-2">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Sold Date:</span>
                    <span className="font-bold text-foreground">{transaction.soldDate || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Sold By Employee:</span>
                    <span className="font-bold text-foreground">{transaction.soldByName || 'N/A'}</span>
                  </div>
                </div>

                <div className="border-t border-border pt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Payment Mode:</span>
                    <Badge variant="outline" className="font-bold text-[10px] mt-0.5">
                      {transaction.paymentModeName}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Payment Handover To:</span>
                    <span className="font-extrabold text-foreground flex items-center gap-1">
                      <UserCheck className="h-3 w-3 text-foreground" /> {transaction.paymentHandoverToName}
                    </span>
                  </div>
                </div>

                <div className="border-t border-border pt-2 text-xs">
                  <span className="text-muted-foreground block text-[11px]">Remarks & Notes:</span>
                  <span className="font-medium text-foreground italic">{transaction.remarks || 'No remarks recorded.'}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Attachments Section */}
          <Card className="border border-border bg-card">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="text-xs font-black uppercase text-foreground flex items-center gap-1.5">
                  <Eye className="h-4 w-4" /> Attached Verification Documents
                </h4>
                {onOpenGallery && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenGallery(transaction)}
                    className="h-7 text-xs font-bold rounded-xl"
                  >
                    View Gallery
                  </Button>
                )}
              </div>

              {transaction.attachments && transaction.attachments.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {transaction.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-border bg-muted/30 p-2.5 flex items-center justify-between text-xs hover:border-primary transition-all"
                    >
                      <span className="font-bold text-foreground truncate max-w-[140px]">{att.fileName}</span>
                      <Badge variant="secondary" className="text-[9px]">
                        {att.type}
                      </Badge>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic py-2">
                  No document attachments uploaded for this transaction.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
