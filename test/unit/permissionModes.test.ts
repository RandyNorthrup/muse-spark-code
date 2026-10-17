import { describe, expect, it } from 'vitest'
import { PERMISSION_MODES, UI_TEXT } from '../../src/shared/constants'
import {
  approvalModeFor,
  availablePermissionModes,
  isPermissionMode,
  nextPermissionMode,
  type AutoReviewers,
  permissionModeDetail,
} from '../../src/shared/permissionModes'

const none: AutoReviewers = { museCode: false, modelApi: false }
const museCodeOnly: AutoReviewers = { museCode: true, modelApi: false }
const modelApiOnly: AutoReviewers = { museCode: false, modelApi: true }
const both: AutoReviewers = { museCode: true, modelApi: true }

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

describe('permissionModeDetail (D24, D69)', () => {
  it('says on Muse Code what each mode does under muse serve', () => {
    expect(permissionModeDetail('acceptEdits', 'museCode')).toBe(
      UI_TEXT.permissionModeDetails.acceptEdits,
    )
    expect(UI_TEXT.permissionModeDetails.acceptEdits).toContain(UI_TEXT.permissionModes.manual)
    // Auto: Muse Code's own skip of simple commands, plus the reviewer while it is on.
    expect(permissionModeDetail('auto', 'museCode')).toBe(UI_TEXT.permissionModeDetails.auto)
    expect(permissionModeDetail('auto', 'museCode', museCodeOnly)).toBe(
      UI_TEXT.museCodeReviewedAutoDetail,
    )
    expect(permissionModeDetail('auto', undefined, museCodeOnly)).toBe(
      UI_TEXT.museCodeReviewedAutoDetail,
    )
    // The Model API's paid reviewer never words Auto on Muse Code.
    expect(permissionModeDetail('auto', 'museCode', modelApiOnly)).toBe(
      UI_TEXT.permissionModeDetails.auto,
    )
    // No line promises a safety check Muse Code does not run under serve (0.11.0).
    for (const mode of PERMISSION_MODES) {
      for (const reviewers of [none, museCodeOnly, modelApiOnly, both]) {
        expect(permissionModeDetail(mode, 'museCode', reviewers)).not.toMatch(/safety check/iu)
      }
    }
  })

  it('keeps the Model API backend’s own lines, which the Muse Code reviewer never changes', () => {
    expect(permissionModeDetail('acceptEdits', 'modelApi')).toBe(
      UI_TEXT.modelApiPermissionModeDetails.acceptEdits,
    )
    expect(permissionModeDetail('auto', 'modelApi', museCodeOnly)).toBe(
      UI_TEXT.modelApiPermissionModeDetails.auto,
    )
    expect(permissionModeDetail('plan', 'modelApi')).toBe(
      UI_TEXT.modelApiPermissionModeDetails.plan,
    )
  })

  // musecode-write-asks (probed 2026-10-04): Plan is `denyUnmatched`, which
  // refuses commands and protected writes but lets Muse Code's file tools
  // edit files, so its line must not promise a plan before any edit.
  it('says on Muse Code that Plan does not stop the file tools', () => {
    const plan = permissionModeDetail('plan', 'museCode')
    expect(plan).toBe(UI_TEXT.permissionModeDetails.plan)
    expect(plan).toContain('can still edit files without asking')
    expect(plan).not.toBe(permissionModeDetail('plan', 'modelApi'))
  })

  it('names the paid Auto reviewer on the Model API while it is on (M78)', () => {
    expect(permissionModeDetail('auto', 'modelApi', modelApiOnly)).toBe(
      UI_TEXT.modelApiReviewedAutoDetail,
    )
    expect(permissionModeDetail('auto', 'modelApi', both)).toBe(UI_TEXT.modelApiReviewedAutoDetail)
    expect(UI_TEXT.modelApiReviewedAutoDetail).not.toBe(UI_TEXT.modelApiPermissionModeDetails.auto)
    // Only Auto has a reviewer; every other mode keeps its line.
    const others = PERMISSION_MODES.filter((each) => each !== 'auto')
    for (const mode of others) {
      expect(permissionModeDetail(mode, 'modelApi', both)).toBe(
        permissionModeDetail(mode, 'modelApi'),
      )
    }
  })
})
