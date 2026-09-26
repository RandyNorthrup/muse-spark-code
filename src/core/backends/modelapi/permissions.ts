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
//
// A paid call (M34, PLAN.md D30: image generation) asks in every mode,
// Bypass included, with no "always allow"; Plan refuses it, since it writes
// a file. The price is the user's to accept each time.
//
// A protected write (PLAN.md D24) asks in every mode but Bypass and Plan,
// session rules included: a file that configures or runs code outside the
// edit itself (git's hooks and config, the editor's tasks, CI workflows,
// the agent's own rules and skills) never changes without a card.
//
// A memory write (M49, D41: `add_memory`, `edit_memory`) is an edit, never
// a protected one, although the project's notes sit under `.agents`: the
// tools write only Markdown notes under a memory root, so Manual asks, Auto
// and Edit automatically write, and Plan refuses, as for any edit.

import type { ApprovalChoice } from '../../../shared/agentEvents'
import { PROTECTED_PATH_SEGMENTS, PROTECTED_FILE_NAMES, UI_TEXT } from '../../../shared/constants'
import type { ApprovalMode } from '../../../shared/permissionModes'

export type ToolClass = 'read' | 'edit' | 'shell' | 'interactive' | 'paid'

export type PermissionVerdict = 'allow' | 'ask' | 'deny'

const EDIT_PROMPTING_MODES: ReadonlySet<ApprovalMode> = new Set(['promptUnmatched'])

export const APPROVAL_CHOICE_IDS = {
  allowOnce: 'allow_once',
  allowSession: 'allow_session',
  abort: 'abort',
} as const

const KNOWN_CHOICE_IDS: ReadonlySet<string> = new Set(Object.values(APPROVAL_CHOICE_IDS))

/** Whether a card's choice id is one this engine offered (anything else is refused). */
export function isKnownChoice(choiceId: string): boolean {
  return KNOWN_CHOICE_IDS.has(choiceId)
}

/**
 * Whether a workspace-relative path (forward slashes, links resolved) is a
 * protected write. Case is ignored: Windows and macOS file systems fold it.
 */
export function isProtectedPath(canonicalRelative: string): boolean {
  const segments = canonicalRelative.toLowerCase().split('/')
  const name = segments.at(-1) ?? ''
  if (PROTECTED_FILE_NAMES.has(name)) {
    return true
  }
  // The run may sit anywhere (a nested repository's `.git`) and may be the
  // file itself (a `.git` file points git at another directory).
  return segments.some((_segment, index) =>
    PROTECTED_PATH_SEGMENTS.some(
      (protectedSegments) =>
        protectedSegments.length <= segments.length - index &&
        protectedSegments.every((part, offset) => segments[index + offset] === part),
    ),
  )
}

/** What the mode says about a tool of this class, before session rules. */
export function verdictFor(
  mode: ApprovalMode,
  toolClass: ToolClass,
  isProtected = false,
): PermissionVerdict {
  if (toolClass === 'paid') {
    return mode === 'denyUnmatched' ? 'deny' : 'ask'
  }
  if (mode === 'allowAll' || toolClass === 'read' || toolClass === 'interactive') {
    return 'allow'
  }
  if (mode === 'denyUnmatched') {
    return 'deny'
  }
  if (toolClass === 'edit') {
    return isProtected || EDIT_PROMPTING_MODES.has(mode) ? 'ask' : 'allow'
  }
  return 'ask'
}

/** The session-rule key a call is judged by: the exact command line for a shell. */
function ruleKey(toolName: string, command: string | undefined): string {
  return command === undefined ? toolName : `${toolName}\u{0}${command}`
}

/** The choices an approval card offers for a tool call (MSP vocabulary). */
export function choicesFor(toolName: string, command?: string): readonly ApprovalChoice[] {
  const sessionLabel =
    command === undefined
      ? `${UI_TEXT.allowSessionPrefix} ${toolName}`
      : `${UI_TEXT.allowSessionPrefix} ${command}`
  return [
    {
      choiceId: APPROVAL_CHOICE_IDS.allowOnce,
      label: UI_TEXT.allowOnce,
      decision: 'approved',
      scope: 'once',
    },
    {
      choiceId: APPROVAL_CHOICE_IDS.allowSession,
      label: sessionLabel,
      decision: 'approvedPolicyAmendment',
      scope: 'session',
      rulePreview: sessionLabel,
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

/** The choices for a paid call (M34): this once, or not at all; never for the session. */
export function paidChoices(): readonly ApprovalChoice[] {
  return choicesFor('').filter((choice) => choice.choiceId !== APPROVAL_CHOICE_IDS.allowSession)
}

/** One call as the engine judges it. */
export interface PermissionQuery {
  readonly toolName: string
  readonly toolClass: ToolClass
  /** The exact command line of a shell call; session rules match it whole. */
  readonly command?: string | undefined
  /** An edit whose target is a protected path (D24). */
  readonly isProtected?: boolean
}

/** The mode plus the rules a session accumulated. */
export class PermissionEngine {
  private readonly allowed = new Set<string>()

  public constructor(private mode: ApprovalMode) {}

  public setMode(mode: ApprovalMode): void {
    this.mode = mode
  }

  public get currentMode(): ApprovalMode {
    return this.mode
  }

  /**
   * A card's "always allow in this session" decision: the tool for edits
   * and questions, the exact command line for a shell call (the CLI keys its
   * shell rules on the command too).
   */
  public allowForSession(toolName: string, command?: string): void {
    this.allowed.add(ruleKey(toolName, command))
  }

  public verdict(query: PermissionQuery): PermissionVerdict {
    const isProtected = query.isProtected === true
    const byMode = verdictFor(this.mode, query.toolClass, isProtected)
    // A session rule never answers for a paid call (D30).
    if (byMode !== 'ask' || isProtected || query.toolClass === 'paid') {
      return byMode
    }
    return this.allowed.has(ruleKey(query.toolName, query.command)) ? 'allow' : 'ask'
  }
}
