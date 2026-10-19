import { describe, expect, it } from 'vitest'
import {
  MUSE_ASK_ME_PROFILE,
  MUSE_AUTO_REVIEW_PROFILE,
  PERMISSION_MODES,
  UI_TEXT,
} from '../../src/shared/constants'
import {
  approvalModeFor,
  availablePermissionModes,
  composerModeForApprovalMode,
  isPermissionMode,
  mspPermissionProfile,
  mspStartPermissionProfile,
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

describe('mspPermissionProfile', () => {
  it('asks the person in Manual, keeps the judge for Auto, and leaves the rest to the mode', () => {
    // Manual and Edit automatically review with `:ask-me`, so an unmatched
    // command raises an approval instead of letting Muse Code's judge allow
    // it (seen live as `allow:llm_judge` on 1.4.7, 2026-10-18).
    expect(mspPermissionProfile('promptUnmatched')).toBe(MUSE_ASK_ME_PROFILE)
    // Auto's words promise the judge's simple-command allows.
    expect(mspPermissionProfile('onRequest')).toBe(MUSE_AUTO_REVIEW_PROFILE)
    // Plan refuses and Bypass allows: the mode itself decides, no reviewer.
    expect(mspPermissionProfile('denyUnmatched')).toBeUndefined()
    expect(mspPermissionProfile('allowAll')).toBeUndefined()
    expect(mspPermissionProfile('a-future-mode')).toBeUndefined()
  })
})

describe('mspStartPermissionProfile', () => {
  it('keeps the host default on a headless start whatever the mode asks for', () => {
    // Headless acceptEdits (exec) starts `promptUnmatched`, whose reviewer
    // would be `:ask-me`; exec rejects every approval, so the start must
    // carry no profile and keep the host default `:auto-review`, as before.
    for (const mode of ['promptUnmatched', 'onRequest', 'denyUnmatched', 'allowAll']) {
      expect(mspStartPermissionProfile(mode, true)).toBeUndefined()
    }
  })

  it('selects the mode’s reviewer on an interactive start', () => {
    expect(mspStartPermissionProfile('promptUnmatched', false)).toBe(MUSE_ASK_ME_PROFILE)
    expect(mspStartPermissionProfile('onRequest', false)).toBe(MUSE_AUTO_REVIEW_PROFILE)
    expect(mspStartPermissionProfile('denyUnmatched', false)).toBeUndefined()
    expect(mspStartPermissionProfile('allowAll', false)).toBeUndefined()
  })
})

describe('composerModeForApprovalMode', () => {
  it('keeps the preferred mode when it selects the running wire mode', () => {
    expect(composerModeForApprovalMode('promptUnmatched', 'manual', true)).toBe('manual')
    expect(composerModeForApprovalMode('promptUnmatched', 'acceptEdits', true)).toBe('acceptEdits')
    expect(composerModeForApprovalMode('onRequest', 'auto', true)).toBe('auto')
    expect(composerModeForApprovalMode('denyUnmatched', 'plan', true)).toBe('plan')
    expect(composerModeForApprovalMode('allowAll', 'bypassPermissions', true)).toBe(
      'bypassPermissions',
    )
  })

  it('falls back to the first menu mode on the wire mode', () => {
    // Manual before Edit automatically: the asking-safe one.
    expect(composerModeForApprovalMode('promptUnmatched', 'auto', true)).toBe('manual')
    expect(composerModeForApprovalMode('onRequest', 'manual', true)).toBe('auto')
    expect(composerModeForApprovalMode('denyUnmatched', 'manual', true)).toBe('plan')
  })

  it('finds nothing for an unknown wire mode, so the surface refuses the send', () => {
    expect(composerModeForApprovalMode('', 'manual', true)).toBeUndefined()
    expect(composerModeForApprovalMode('a-future-mode', 'manual', true)).toBeUndefined()
  })

  it('maps through the no-approval-UI collapse', () => {
    // Without the approval UI Manual behaves as deny: showing it for a
    // refusing host is true, and Plan still resolves to itself.
    expect(composerModeForApprovalMode('denyUnmatched', 'manual', false)).toBe('manual')
    expect(composerModeForApprovalMode('denyUnmatched', 'plan', false)).toBe('plan')
  })
})
