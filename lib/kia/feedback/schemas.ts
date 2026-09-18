import { z } from 'zod'
import { FEEDBACK_MODELS } from './constants'
import { isValidIndianMobile, normalizeMobile, tidyText, titleCaseName } from '../walk-in-leads/constants'

export const feedbackSubmitSchema = z.object({
  walkInLeadId: z.string().uuid().nullable().optional(),
  overallRating: z.coerce.number().int().min(1, 'Please select a star rating (1 to 5).').max(5, 'Maximum rating is 5 stars.'),
  staffCourtesyRating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  testDriveRating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  showroomAmbienceRating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  experienceTags: z.array(z.string()).default([]),
  remarks: z.preprocess((val) => (tidyText(val) === '' ? null : tidyText(val)), z.string().max(1000, 'Remarks cannot exceed 1000 characters.').nullable().optional()),
  customerName: z.preprocess((val) => (tidyText(val) === '' ? null : titleCaseName(val)), z.string().max(120, 'Name is too long.').nullable().optional()),
  mobile: z.preprocess(
    (val) => {
      const normalized = normalizeMobile(val)
      return normalized === '' ? null : normalized
    },
    z
      .string()
      .refine((val) => val === null || isValidIndianMobile(val), {
        message: 'Enter a valid 10-digit Indian mobile number.',
      })
      .nullable()
      .optional(),
  ),
  model: z.preprocess((val) => (tidyText(val) === '' ? null : tidyText(val)), z.enum(FEEDBACK_MODELS as unknown as [string, ...string[]]).nullable().optional()),
  consultantName: z.preprocess((val) => (tidyText(val) === '' ? null : titleCaseName(val)), z.string().max(80, 'Consultant name is too long.').nullable().optional()),
  source: z.string().default('SHOWROOM_QR'),
})

export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitSchema>
