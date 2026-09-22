// The Model API backend's permission engine: the four MSP approval modes
// (shared/permissionModes.ts maps the five UI modes onto them) applied to
// the in-process tools, plus the "always allow in this session" rules the
// approval cards can add. There is no LLM judge here, so `onRequest` (the
// UI's Auto) behaves as the prompting mode with edits allowed, which is
// what Claude Code's Auto does when its classifier has nothing to say.
//
//   allowAll         → everything runs (Bypass permissions)
//   onRequest        → reads and edits run, shell commands ask
//   promptUnmatched  → reads run, edits and shell commands ask (Manual);
//                      the controller answers edit approvals itself in
//                      Edit-automatically mode, as it does for Muse Code
//   denyUnmatched    → reads run, everything else is refused (Plan)

import type { ApprovalChoice } from '../../../shared/agentEvents'
import { UI_TEXT } from '../../../shared/constants'
import type { ApprovalMode } from '../../../shared/permissionModes'

export type ToolClass = 'read' | 'edit' | 'shell' | 'interactive'

export type PermissionVerdict = 'allow' | 'ask' | 'deny'

const EDIT_PROMPTING_MODES: ReadonlySet<ApprovalMode> = new Set(['promptUnmatched'])

export const APPROVAL_CHOICE_IDS = {
  allowOnce: 'allow_once',
  allowSession: 'allow_session',
  abort: 'abort',
} as const

/** What the mode says about a tool of this class, before session rules. */
export function verdictFor(mode: ApprovalMode, toolClass: ToolClass): PermissionVerdict {
  if (mode === 'allowAll' || toolClass === 'read' || toolClass === 'interactive') {
    return 'allow'
  }
  if (mode === 'denyUnmatched') {
    return 'deny'
  }
  if (toolClass === 'edit') {
    return EDIT_PROMPTING_MODES.has(mode) ? 'ask' : 'allow'
  }
  return 'ask'
}

/** The choices an approval card offers for a tool call (MSP vocabulary). */
export function choicesFor(toolName: string): readonly ApprovalChoice[] {
  return [
    {
      choiceId: APPROVAL_CHOICE_IDS.allowOnce,
      label: UI_TEXT.allowOnce,
      decision: 'approved',
      scope: 'once',
    },
    {
      choiceId: APPROVAL_CHOICE_IDS.allowSession,
      label: `${UI_TEXT.allowSessionPrefix} ${toolName}`,
      decision: 'approvedPolicyAmendment',
      scope: 'session',
      rulePreview: `${UI_TEXT.allowSessionPrefix} ${toolName}`,
    },
    {
      choiceId: APPROVAL_CHOICE_IDS.abort,
      label: UI_TEXT.reject,
      decision: 'abort',
      scope: 'once',
      acceptsFeedback: true,
    },
  ]
}

/** The mode plus the rules a session accumulated. */
export class PermissionEngine {
  private readonly allowedTools = new Set<string>()

  public constructor(private mode: ApprovalMode) {}

  public setMode(mode: ApprovalMode): void {
    this.mode = mode
  }

  public get currentMode(): ApprovalMode {
    return this.mode
  }

  /** A card's "always allow in this session" decision. */
  public allowForSession(toolName: string): void {
    this.allowedTools.add(toolName)
  }

  public verdict(toolName: string, toolClass: ToolClass): PermissionVerdict {
    const byMode = verdictFor(this.mode, toolClass)
    return byMode === 'ask' && this.allowedTools.has(toolName) ? 'allow' : byMode
  }
}
