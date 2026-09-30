// The Model API backend's permission engine: the four MSP approval modes
// (shared/permissionModes.ts maps the five UI modes onto them) applied to
// the in-process tools, plus the "always allow in this session" rules the
// approval cards can add. There is no LLM judge here, so `onRequest` (the
// UI's Auto) behaves as the prompting mode with edits allowed, which is
// what Claude Code's Auto does when its classifier has nothing to say.
//
//   allowAll         → ordinary tools run; paid calls and child tasks ask
//   onRequest        → reads and edits run, shell commands ask
//   promptUnmatched  → reads run, edits and shell commands ask (Manual);
//                      the controller answers edit approvals itself in
//                      Edit-automatically mode, as it does for Muse Code
//   denyUnmatched    → reads run, everything else is refused (Plan)
//
// A paid call (M34, PLAN.md D30: image generation; M48: a child task) asks
// in every mode, Bypass included, never through a card or a session rule:
// the paid-use popup asks (M58, PLAN.md D48), whose "Allow always in this
// workspace" is the only way it stops asking. Plan refuses it, since it
// writes a file or starts an agent.
//
// A protected write (PLAN.md D24) asks in every mode but Bypass and Plan,
// session rules included: a file that configures or runs code outside the
// edit itself (git's hooks and config, the editor's tasks, CI workflows,
// the agent's own rules and skills) never changes without a card.
//
// An MCP server's tool (M50, PLAN.md D42) is arbitrary code: it asks like a
// shell command, "always allow in this session" included, and Plan refuses
// it. A tool its server marks read-only (`annotations.readOnlyHint`) runs
// without a card in Auto, as Muse Code runs it under on-request approvals
// (its 1.2.1 changelog), and asks in Plan instead of being refused.
//
// A memory write (M49, D41: `add_memory`, `edit_memory`) is an edit, never
// a protected one, although the project's notes sit under `.agents`: the
// tools write only Markdown notes under a memory root, so Manual asks, Auto
// and Edit automatically write, and Plan refuses, as for any edit.
//
// A web fetch (M69, PLAN.md D49, the M44b design) is a network tool: it
// changes nothing, but the URL it sends can carry anything the conversation
// holds, so it asks per host in every mode but Bypass (Auto included, as a
// shell command does), "always allow in this session" keyed on the host;
// a PermissionRequest hook may deny it or ask, but its "allow" does not
// replace the card (ModelApiHost.askApproval). Plan refuses it: its rules allow reads of the workspace, not of the
// network. Restricted Mode refuses it before the engine is asked.

import type { ApprovalChoice } from '../../../shared/agentEvents'
import { UI_TEXT } from '../../../shared/constants'
import type { ApprovalMode } from '../../../shared/permissionModes'

export type ToolClass =
  'read' | 'edit' | 'shell' | 'interactive' | 'paid' | 'mcp' | 'spawn' | 'network'

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

/** An MCP server's tool: a shell command's rules, eased for one its server marks read-only. */
function mcpVerdict(mode: ApprovalMode, isReadOnly: boolean): PermissionVerdict {
  switch (mode) {
    case 'allowAll': {
      return 'allow'
    }
    case 'onRequest': {
      return isReadOnly ? 'allow' : 'ask'
    }
    case 'denyUnmatched': {
      return isReadOnly ? 'ask' : 'deny'
    }
    case 'promptUnmatched': {
      return 'ask'
    }
  }
}

/** A web fetch: Bypass runs it, Plan refuses it, every other mode asks per host. */
function networkVerdict(mode: ApprovalMode): PermissionVerdict {
  switch (mode) {
    case 'allowAll': {
      return 'allow'
    }
    case 'denyUnmatched': {
      return 'deny'
    }
    case 'onRequest':
    case 'promptUnmatched': {
      return 'ask'
    }
  }
}

/** What the mode says about a tool of this class, before session rules. */
export function verdictFor(
  mode: ApprovalMode,
  toolClass: ToolClass,
  isProtected = false,
  isReadOnly = false,
): PermissionVerdict {
  if (toolClass === 'paid') {
    return mode === 'denyUnmatched' ? 'deny' : 'ask'
  }
  if (toolClass === 'mcp') {
    return mcpVerdict(mode, isReadOnly)
  }
  if (toolClass === 'spawn') {
    return mode === 'denyUnmatched' ? 'deny' : 'ask'
  }
  if (toolClass === 'network') {
    return networkVerdict(mode)
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

/** One call as the engine judges it. */
export interface PermissionQuery {
  readonly toolName: string
  readonly toolClass: ToolClass
  /**
   * What a session rule matches whole: a shell call's exact command line, a
   * web fetch's host (M69).
   */
  readonly command?: string | undefined
  /** An edit whose target is a protected path (D24). */
  readonly isProtected?: boolean
  /** An MCP tool its server marks read-only (M50). */
  readonly isReadOnly?: boolean
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
    const byMode = verdictFor(this.mode, query.toolClass, isProtected, query.isReadOnly === true)
    // A session rule never answers for a paid call (D30).
    if (
      byMode !== 'ask' ||
      isProtected ||
      query.toolClass === 'paid' ||
      query.toolClass === 'spawn'
    ) {
      return byMode
    }
    return this.allowed.has(ruleKey(query.toolName, query.command)) ? 'allow' : 'ask'
  }
}
