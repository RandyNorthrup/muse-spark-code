import { describe, expect, it } from 'vitest'
import { PERMISSION_MODES } from '../../src/shared/constants'
import {
  approvalModeFor,
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

describe('nextPermissionMode', () => {
  it('cycles through the Claude Code order and wraps', () => {
    expect(nextPermissionMode('manual')).toBe('acceptEdits')
    expect(nextPermissionMode('acceptEdits')).toBe('plan')
    expect(nextPermissionMode('plan')).toBe('auto')
    expect(nextPermissionMode('auto')).toBe('bypassPermissions')
    expect(nextPermissionMode('bypassPermissions')).toBe('manual')
  })
})

describe('isPermissionMode', () => {
  it('accepts the declared modes only', () => {
    expect(isPermissionMode('plan')).toBe(true)
    expect(isPermissionMode('yolo')).toBe(false)
  })
})
