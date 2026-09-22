import { describe, expect, it } from 'vitest'
import { PERMISSION_MODES } from '../../src/shared/constants'
import {
  approvalModeFor,
  availablePermissionModes,
  isPermissionMode,
  nextPermissionMode,
} from '../../src/shared/permissionModes'

describe('approvalModeFor', () => {
  it('maps every mode onto a host approval mode once the approval UI exists', () => {
    expect(PERMISSION_MODES.map((mode) => approvalModeFor(mode, true))).toEqual([
      'promptUnmatched',
      'promptUnmatched',
      'denyUnmatched',
      'onRequest',
      'allowAll',
    ])
  })

  it('collapses prompting modes to denyUnmatched while the approval UI is missing', () => {
    expect(PERMISSION_MODES.map((mode) => approvalModeFor(mode, false))).toEqual([
      'denyUnmatched',
      'denyUnmatched',
      'denyUnmatched',
      'denyUnmatched',
      'allowAll',
    ])
  })
})

describe('availablePermissionModes', () => {
  it('lists Bypass permissions only when the setting allows it', () => {
    expect(availablePermissionModes(true)).toEqual(PERMISSION_MODES)
    expect(availablePermissionModes(false)).toEqual(['manual', 'acceptEdits', 'plan', 'auto'])
  })
})

describe('nextPermissionMode', () => {
  it('cycles through the Claude Code order and wraps, including Bypass when allowed', () => {
    expect(nextPermissionMode('manual', true)).toBe('acceptEdits')
    expect(nextPermissionMode('acceptEdits', true)).toBe('plan')
    expect(nextPermissionMode('plan', true)).toBe('auto')
    expect(nextPermissionMode('auto', true)).toBe('bypassPermissions')
    expect(nextPermissionMode('bypassPermissions', true)).toBe('manual')
  })

  it('skips Bypass when it is not allowed and leaves it if it is current', () => {
    expect(nextPermissionMode('auto', false)).toBe('manual')
    expect(nextPermissionMode('bypassPermissions', false)).toBe('manual')
  })
})

describe('isPermissionMode', () => {
  it('accepts the declared modes only', () => {
    expect(isPermissionMode('plan')).toBe(true)
    expect(isPermissionMode('yolo')).toBe(false)
  })
})
