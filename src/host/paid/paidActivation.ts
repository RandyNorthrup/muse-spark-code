import { PAID_FEATURE_SETTINGS, type PaidFeature } from '../../shared/constants'
import type { ExtensionSettings } from '../settings'

export function isActivationPaidSettingOn(
  feature: PaidFeature,
  settings: ExtensionSettings,
): boolean {
  return feature !== 'judge' && settings[PAID_FEATURE_SETTINGS[feature]]
}
