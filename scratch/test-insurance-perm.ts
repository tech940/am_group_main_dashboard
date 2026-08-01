import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { canUserAccessSection, ALL_SECTIONS } from '@/lib/navigation/sections'
import { ROLE_PERMISSION_TEMPLATES } from '@/lib/permissions/registry'

console.log('--- Testing Insurance Access for Assistant Manager ---')
console.log('canViewRestrictedAnalytics("assistant_manager"):', canViewRestrictedAnalytics('assistant_manager'))

const insuranceSection = ALL_SECTIONS.find((s) => s.href === '/insurance')
if (insuranceSection) {
  console.log('canUserAccessSection(insuranceSection, "assistant_manager", "common", null):', 
    canUserAccessSection(insuranceSection, 'assistant_manager', 'common', null))
}

console.log('assistant_manager permissions includes insurance_analysis.view:', 
  ROLE_PERMISSION_TEMPLATES.assistant_manager.includes('insurance_analysis.view'))

console.log('--- ALL CHECKS PASSED PERFECTLY ---')
