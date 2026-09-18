import { z } from 'zod'

export const EvaluationSubmitSchema = z.object({
  customerName: z.string().min(2, 'Name is required'),
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit mobile number'),
  brand: z.string().min(1, 'Brand is required'),
  model: z.string().min(1, 'Model is required'),
  manufacturingYear: z.number().int().min(2000).max(2030),
  fuelType: z.string().optional().default('petrol'),
  transmission: z.string().optional().default('manual'),
  kilometersDriven: z.string().optional().default('40k_70k'),
  mileageExact: z.number().optional().nullable(),
  evaluationDate: z.string().min(1, 'Preferred evaluation date is required'),
  cityArea: z.string().min(1, 'City/Area is required'),
  interestedInNewCar: z.boolean().default(false),
  estimatedPriceMin: z.number().optional().nullable(),
  estimatedPriceMax: z.number().optional().nullable(),
  source: z.string().default('whatsapp_campaign'),
  utmSource: z.string().optional().nullable(),
  utmMedium: z.string().optional().nullable(),
  utmCampaign: z.string().optional().nullable(),
})

export type EvaluationSubmitInput = z.infer<typeof EvaluationSubmitSchema>

export interface VehicleEvaluationRecord {
  id: string
  customerName: string
  mobile: string
  brand: string
  model: string
  manufacturingYear: number
  fuelType: string | null
  transmission: string | null
  kilometersDriven: string | null
  mileageExact: number | null
  evaluationDate: string | null
  cityArea: string
  interestedInNewCar: boolean
  estimatedPriceMin: number | null
  estimatedPriceMax: number | null
  uploadedPhotos: string[] | null
  source: string
  status: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
