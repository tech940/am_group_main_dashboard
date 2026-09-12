import { redirect } from 'next/navigation'

/**
 * AM Diamond and AM Diamond Honda were the same dealership under two brand keys. `honda` is the key the
 * permission registry and every user assignment use, so this path now points at that form instead of
 * offering a second one for the same branches.
 */
export default function DiamondApprovalsSubmitPage() {
  redirect('/brands/honda/approvals/submit')
}
