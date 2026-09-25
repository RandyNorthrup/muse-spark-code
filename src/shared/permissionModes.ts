// Claude Code permission modes → Muse Session Protocol approval modes.
//
// MSP is "select, never create": a client picks one of four host-defined
// modes and cannot describe a policy on the wire. The Claude Code vocabulary
// is richer, so two of its modes are compositions:
//
//   manual            → promptUnmatched   (the CLI's `--approval-mode untrusted`:
//                                          ask for every action no rule allows)
//   acceptEdits       → promptUnmatched + the extension answers file-edit
//                                          approvals itself (M4)
//   plan              → denyUnmatched     (read and reason only)
//   auto              → onRequest         (the CLI's default: the LLM judge
//                                          reviews prompt-bound calls and the
//                                          host asks only when the tool needs it)
//   bypassPermissions → allowAll          (the CLI's `never`)
//
// The CLI names come from `muse --help` (Muse Code 1.3.0, 2026-09-21):
// "Tool approval mode: untrusted|on-request|never (default: on-request)". The
// live behaviour of each mode is verified when the approval cards land (M4);
// until then any mode that would make the host wait on a decision the UI
// cannot give collapses to `denyUnmatched`, which is what M2 shipped with.
//
// Bypass permissions is offered only while the
// `museSpark.allowDangerouslySkipPermissions` setting is on, exactly as the
// Claude Code extension gates it behind `allowDangerouslySkipPermissions`.

import { PERMISSION_MODES, type PermissionMode, UI_TEXT } from './constants'
import type { BackendKind } from './protocol'

/** The Modes menu's line for a mode on the backend in use (PLAN.md D24). */
export function permissionModeDetail(
  mode: PermissionMode,
  backend: BackendKind | undefined,
): string {
  // The Model API backend words only the modes that behave differently there.
  const modelApiDetails: Readonly<Partial<Record<PermissionMode, string>>> =
    UI_TEXT.modelApiPermissionModeDetails
  return (
    (backend === 'modelApi' ? modelApiDetails[mode] : undefined) ??
    UI_TEXT.permissionModeDetails[mode]
  )
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

/** Modes whose MSP counterpart needs the approval cards before it is safe. */
const PROMPTING_MODES: ReadonlySet<ApprovalMode> = new Set(['promptUnmatched', 'onRequest'])

/**
 * The MSP mode to select for a UI permission mode. `hasApprovalUi` is false
 * until M4 renders `approval/requested`; while it is false a prompting mode
 * would hang the turn, so it degrades to `denyUnmatched`.
 */
export function approvalModeFor(mode: PermissionMode, hasApprovalUi: boolean): ApprovalMode {
  const mapped = FULL_MAPPING[mode]
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
