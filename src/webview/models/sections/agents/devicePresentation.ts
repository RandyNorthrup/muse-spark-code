import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import { formatDateTime } from '../../../../shared/l10n/text'
import type { DEVICE_FAILURES } from '../../../../shared/devices'
import type { DEVICE_STATUSES } from '../../../../shared/devicesPanel'

export function deviceStatusText(status: (typeof DEVICE_STATUSES)[number]): string {
  return status === 'blocked-or-unreachable' ? UI_TEXT.devices.blocked : UI_TEXT.devices[status]
}

export function deviceFailureText(failure: (typeof DEVICE_FAILURES)[number]): string {
  switch (failure) {
    case 'blocked-or-unreachable': {
      return UI_TEXT.devices.blocked
    }
    case 'incompatible': {
      return UI_TEXT.devices.protocolMismatch
    }
    case 'unsupported-host': {
      return UI_TEXT.devices.unsupportedHost
    }
    case 'storage': {
      return UI_TEXT.devices.storageUnavailable
    }
    case 'reconcile-required':
    case 'uncertain': {
      return UI_TEXT.devices.unresolvedHelp
    }
    case 'approval-required':
    case 'paid-consent-required': {
      return UI_TEXT.devices.localApprovalHelp
    }
    case 'revoked': {
      return UI_TEXT.devices.revokedHelp
    }
    case 'unpaired': {
      return UI_TEXT.devices.unpairedHelp
    }
    case 'capacity': {
      return UI_TEXT.devices.capacityHelp
    }
    case 'grant': {
      return UI_TEXT.devices.grantHelp
    }
    case 'invalid-frame':
    case 'payload-changed': {
      return UI_TEXT.devices.invalidMessage
    }
  }
}

export function deviceObservationText(observedAt: number): string {
  if (
    !Number.isSafeInteger(observedAt) ||
    observedAt < 0 ||
    observedAt > DEVICE_LIMITS.observationMaxMs
  )
    return UI_TEXT.devices.unknown
  try {
    return formatDateTime(observedAt)
  } catch (error) {
    if (error instanceof RangeError) return UI_TEXT.devices.unknown
    throw error
  }
}
