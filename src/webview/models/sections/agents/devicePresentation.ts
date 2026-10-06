import { UI_TEXT } from '../../../../shared/constants'
import type { DEVICE_FAILURES } from '../../../../shared/devices'
import type { DEVICE_STATUSES } from '../../../../shared/modelsPanel'

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
    case 'revoked':
    case 'unpaired': {
      return UI_TEXT.devices.fingerprintChanged
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
