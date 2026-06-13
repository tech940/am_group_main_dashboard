import { redirect } from 'next/navigation'

export default function LegacyAdminUsersPage() {
  redirect('/admin?tab=users')
}
