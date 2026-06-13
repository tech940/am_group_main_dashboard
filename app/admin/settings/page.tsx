import { redirect } from 'next/navigation'

export default function LegacyAdminSettingsPage() {
  redirect('/admin?tab=settings')
}
