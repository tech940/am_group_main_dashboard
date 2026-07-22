'use client'

import { ScrapTransaction } from '@/lib/scrap-erp/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Eye, Info } from 'lucide-react'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export function ScrapDrilldownModal({
  title,
  rows,
  isOpen,
  onClose,
  onOpenGallery,
  onSelectTransaction,
}: {
  title: string
  rows: ScrapTransaction[]
  isOpen: boolean
  onClose: () => void
  onOpenGallery: (txn: ScrapTransaction) => void
  onSelectTransaction: (txn: ScrapTransaction) => void
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] lg:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <DialogHeader className="shrink-0 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>{title}</span>
              <Badge variant="outline" className="text-xs font-bold">
                {rows.length} Records
              </Badge>
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0 pt-2">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 dark:bg-slate-900/80">
                <TableHead className="text-xs font-black">Date</TableHead>
                <TableHead className="text-xs font-black">Txn #</TableHead>
                <TableHead className="text-xs font-black">Location</TableHead>
                <TableHead className="text-xs font-black">Category</TableHead>
                <TableHead className="text-xs font-black text-right">Valuation</TableHead>
                <TableHead className="text-xs font-black text-right">Received</TableHead>
                <TableHead className="text-xs font-black text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => {
                    onClose()
                    onSelectTransaction(row)
                  }}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <TableCell className="text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {row.soldDate || row.timestamp.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-xs font-black text-slate-900 dark:text-slate-100">
                    {row.transactionNumber}
                  </TableCell>
                  <TableCell className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {row.locationName}
                  </TableCell>
                  <TableCell className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {row.scrapTypeName}
                  </TableCell>
                  <TableCell className="text-xs font-black text-right text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                    {formatINR(row.calculatedTotal)}
                  </TableCell>
                  <TableCell className="text-xs font-black text-right text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {formatINR(row.amountReceived)}
                  </TableCell>
                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          onClose()
                          onSelectTransaction(row)
                        }}
                        className="h-7 w-7 text-slate-500 hover:text-slate-900"
                        title="View Details"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenGallery(row)}
                        className="h-7 w-7 text-slate-500 hover:text-slate-900"
                        title="View Photos"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
