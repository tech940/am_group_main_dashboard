'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

interface RemarksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  actionLabel: string
  actionVariant?: 'default' | 'destructive'
  onConfirm: (remarks: string) => void | Promise<void>
  loading?: boolean
  remarksRequired?: boolean
}

export function RemarksDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  actionVariant = 'default',
  onConfirm,
  loading = false,
  remarksRequired = false,
}: RemarksDialogProps) {
  const [remarks, setRemarks] = useState('')

  const handleConfirm = async () => {
    if (remarksRequired && !remarks.trim()) {
      return
    }
    await onConfirm(remarks)
    setRemarks('')
  }

  const handleCancel = () => {
    setRemarks('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl sm:max-w-[520px]">
        <div className="bg-gradient-to-r from-[#023468] to-[#034b82] px-6 py-5 text-white">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-2xl font-black tracking-tight text-white">{title}</DialogTitle>
            {description && (
              <p className="text-sm leading-6 text-[#edf4fb]">{description}</p>
            )}
          </DialogHeader>
        </div>

        <div className="space-y-5 bg-white px-6 py-6">
          <div className="space-y-2">
            <Label htmlFor="remarks" className="text-sm font-bold text-slate-700">
              Remarks {remarksRequired && <span className="text-red-500">*</span>}
            </Label>
            <Textarea
              id="remarks"
              placeholder="Enter your remarks here (optional)..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={5}
              className="resize-none rounded-2xl border-slate-300 bg-white text-slate-900 shadow-inner placeholder:text-slate-400 focus:border-[#023468] focus:ring-[#023468]"
              disabled={loading}
            />
            {remarksRequired && !remarks.trim() && (
              <p className="text-xs text-red-500">Remarks are required for this action</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
              className="rounded-2xl border-slate-300"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={actionVariant}
              onClick={handleConfirm}
              disabled={loading || (remarksRequired && !remarks.trim())}
              className="rounded-2xl"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : actionLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Made with Bob
