// Claude Code permission modes → Muse Session Protocol approval modes.
//
// MSP is "select, never create": a client picks one of four host-defined
// modes and cannot describe a policy on the wire. The Claude Code vocabulary
// is richer, so two of its modes are compositions:
//
//   manual            → promptUnmatched   (the CLI's `--approval-mode untrusted`:
//                                          ask for every action no rule allows;
//                                          Muse Code still edits workspace
//                                          files without asking, M4)
//   acceptEdits       → promptUnmatched + the extension answers file-edit
//                                          approvals itself (M4); Muse Code
//                                          asks none under `muse serve`, so on
//                                          it this is Manual (PLAN.md D69)
//   plan              → denyUnmatched     (read and reason only)
//   auto              → onRequest         (under `muse serve` Muse Code skips
//                                          only the commands it classifies as
//                                          simple and asks for the rest: the
//                                          LLM judge `muse --help` names runs
//                                          only in its interactive and `exec`
//                                          commands, D69; the panel's own
//                                          reviewer answers what it can, M90)
//   bypassPermissions → allowAll          (the CLI's `never`)
//
// The CLI names come from `muse --help` (Muse Code 1.3.0, 2026-09-21):
// "Tool approval mode: untrusted|on-request|never (default: on-request)".
// What each mode does under `muse serve` was read from the CLI's own session
// log and trace and a live probe on 1.4.2 (2026-10-03, PLAN.md D69); the Modes
// menu says it per backend (`permissionModeDetail`). Any mode that would make
// the host wait on a decision the UI cannot give collapses to `denyUnmatched`
// while `hasApprovalUi` is false, which is what M2 shipped with.
//
// Bypass permissions is offered only while the
// `museSpark.allowDangerouslySkipPermissions` setting is on, exactly as the
// Claude Code extension gates it behind `allowDangerouslySkipPermissions`.

import { PERMISSION_MODES, type PermissionMode, UI_TEXT } from './constants'
import type { BackendKind } from './protocol'

/**
 * The Modes menu's line for a mode on the backend in use (PLAN.md D24, D69).
 * `hasReviewer`: the Auto reviewer on Muse Code is on (M90); the ACP agent
 * has none.
 */
export function permissionModeDetail(
  mode: PermissionMode,
  backend: BackendKind | undefined,
  hasReviewer = false,
): string {
  if (backend === 'modelApi') {
    // The Model API backend words only the modes that behave differently there.
    const modelApiDetails: Readonly<Partial<Record<PermissionMode, string>>> =
      UI_TEXT.modelApiPermissionModeDetails
    return modelApiDetails[mode] ?? UI_TEXT.permissionModeDetails[mode]
  }
  return mode === 'auto' && hasReviewer
    ? UI_TEXT.museCodeReviewedAutoDetail
    : UI_TEXT.permissionModeDetails[mode]
}

export const APPROVAL_MODES = ['allowAll', 'promptUnmatched', 'onRequest', 'denyUnmatched'] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]

const FULL_MAPPING: Readonly<Record<PermissionMode, ApprovalMode>> = {
  manual: 'promptUnmatched',
  acceptEdits: 'promptUnmatched',
  plan: 'denyUnmatched',
  auto: 'onRequest',
  bypassPermissions: 'allowAll',
}

/** The MSP mode a UI permission mode selects, with approval UI present. */
export function mspApprovalMode(mode: PermissionMode): ApprovalMode {
  return FULL_MAPPING[mode]
}

/** Modes whose MSP counterpart needs the approval cards before it is safe. */
const PROMPTING_MODES: ReadonlySet<ApprovalMode> = new Set(['promptUnmatched', 'onRequest'])

/**
 * The MSP mode to select for a UI permission mode. `hasApprovalUi` is false
 * until M4 renders `approval/requested`; while it is false a prompting mode
 * would hang the turn, so it degrades to `denyUnmatched`.
 */
export function approvalModeFor(mode: PermissionMode, hasApprovalUi: boolean): ApprovalMode {
  const mapped = mspApprovalMode(mode)
  return !hasApprovalUi && PROMPTING_MODES.has(mapped) ? 'denyUnmatched' : mapped
}

/** The modes the Modes menu lists, in the Claude Code order. */
export function availablePermissionModes(
  canBypass: boolean,
): readonly [PermissionMode, ...PermissionMode[]] {
  const [first, ...rest] = PERMISSION_MODES
  return canBypass
    ? PERMISSION_MODES
    : [first, ...rest.filter((mode) => mode !== 'bypassPermissions')]
}

/**
 * Shift+Tab: the next available mode in the Claude Code order. A current mode
 * that is no longer available (Bypass after the setting was turned off)
 * cycles to the first one.
 */
export function nextPermissionMode(mode: PermissionMode, canBypass: boolean): PermissionMode {
  const modes = availablePermissionModes(canBypass)
  // Past the last mode, or a mode no longer listed (indexOf -1), the cycle
  // wraps to the first one; the list is never empty.
  return modes[modes.indexOf(mode) + 1] ?? modes[0]
}

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value)
}

// The modes that ask before a command runs: Manual asks, Plan refuses.
const ASKING_MODES: ReadonlySet<PermissionMode> = new Set(['manual', 'plan'])

/**
 * The mode a conversation built on untrusted content opens in (PLAN.md D49,
 * M84): the current mode when it already asks, else Manual, or Plan when
 * `museSpark.initialPermissionMode` is Plan, whatever else that setting
 * says. Only the user's own mode change relaxes it.
 */
export function untrustedStartMode(
  current: PermissionMode,
  initial: PermissionMode,
): PermissionMode {
  if (ASKING_MODES.has(current)) {
    return current
  }
  return initial === 'plan' ? 'plan' : 'manual'
}
