import { redirect } from 'next/navigation'

export default async function LegacyAdminPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const selectedUser = typeof params.user === 'string' ? params.user : ''
  redirect(`/admin?tab=access${selectedUser ? `&user=${encodeURIComponent(selectedUser)}` : ''}`)
}
