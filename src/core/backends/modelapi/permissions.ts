// The Model API backend's permission engine: the four MSP approval modes
// (shared/permissionModes.ts maps the five UI modes onto them) applied to
// the in-process tools, plus the "always allow in this session" rules the
// approval cards can add. `onRequest` (the UI's Auto) behaves as the
// prompting mode with edits allowed, which is what Claude Code's Auto does
// when its classifier has nothing to say; the opt-in Auto reviewer (M78,
// autoReviewer.ts) may answer what no rule settled.
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
// the agent's own rules and skills, other coding agents' hooks and
// settings) never changes without a card.
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
// A shell command meets the policy (M78, PLAN.md D49; permissionPolicy.ts):
//
//   a forbid rule   → refused in every mode, Bypass included
//   Bypass, Plan    → as the mode says
//   a profile on    → asks: the shell escapes the profile's confinement
//   an ask rule     → asks
//   an allow rule   → runs (one plain command only)
//   a session rule  → runs (D24: the exact command line)
//   otherwise       → asks; in Auto the Auto reviewer may answer
//
// Only an ask nothing settled can reach the reviewer: never a forbid, an ask
// rule, the profile's ask, a protected write, a paid call or a child task,
// nor a call a hook demanded a question for (the caller's check).
// A web fetch (M69, PLAN.md D49, the M44b design) is a network tool: it
// changes nothing, but the URL it sends can carry anything the conversation
// holds, so it asks per host in every mode but Bypass (Auto included, as a
// shell command does), "always allow in this session" keyed on the host;
// a PermissionRequest hook may deny it or ask, but its "allow" does not
// replace the card (ModelApiHost.askApproval). Plan refuses it: its rules allow reads of the workspace, not of the
// network. Restricted Mode refuses it before the engine is asked.
//
// A browser check (M81, PLAN.md D49) is judged the same way, per host. A
// host beyond loopback and the user's setting is reached only once the user
// allowed it on a card: that call's, or an "always" chosen on one in this
// session; Bypass alone does not widen it (ModelApiHost asks the card).

import type { ApprovalChoice } from '../../../shared/agentEvents'
import { UI_TEXT } from '../../../shared/constants'
import type { ApprovalMode } from '../../../shared/permissionModes'
import { countSecretMatches } from '../../redact'
import { type CommandRule, isEvaluator, judgeCommand } from './commandRules'
import type { PermissionPolicy } from './permissionPolicy'
import { commandShape, type ShellDialect } from './shellSyntax'

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

/**
 * The choices an approval card offers for a tool call (MSP vocabulary):
 * "Allow for this session" only where a session rule could answer later.
 */
export function choicesFor(
  toolName: string,
  command?: string,
  hasSessionChoice = true,
): readonly ApprovalChoice[] {
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
    ...(hasSessionChoice
      ? [
          {
            choiceId: APPROVAL_CHOICE_IDS.allowSession,
            label: sessionLabel,
            decision: 'approvedPolicyAmendment',
            scope: 'session',
            rulePreview: sessionLabel,
          },
        ]
      : []),
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
  /** The shell the command is for (M78); bash when not said. */
  readonly dialect?: ShellDialect | undefined
  /** An edit whose target is a protected path (D24). */
  readonly isProtected?: boolean
  /** An MCP tool its server marks read-only (M50). */
  readonly isReadOnly?: boolean
}

/** What settled a shell command's verdict beyond the mode (M78, M92e). */
export type SettledBy =
  | 'forbidRule'
  | 'askRule'
  | 'allowRule'
  | 'profile'
  | 'complexCommand'
  /** M92e (PLAN.md D71): the command holds a detected secret, so it always asks. */
  | 'secretDetected'

/** The verdict on a call, and what the card and the Auto reviewer may do about an ask. */
export interface PermissionJudgement {
  readonly verdict: PermissionVerdict
  /** A command rule or the permission profile, when one of them settled it. */
  readonly settledBy?: SettledBy | undefined
  /** The rule that settled it. */
  readonly rule?: CommandRule | undefined
  /** An ask nothing settled, in Auto: the Auto reviewer may answer it (M78). */
  readonly isReviewable: boolean
  /** The card may offer "Allow for this session": never for an ask rule or under a profile. */
  readonly hasSessionChoice: boolean
}

/** No rules, no profile: what the engine judges by when the policy is not given. */
export const NO_POLICY: PermissionPolicy = {
  commandRules: [],
  profileName: undefined,
  files: {
    denyGlobs: [],
    isDenyAll: false,
    extraRoots: [],
    isDenied: () => false,
  },
  problems: [],
}

// The classes whose ask the Auto reviewer may answer: what runs code the
// workspace's files do not describe. Edits run in Auto anyway, protected
// ones always ask; paid calls and child tasks ask in the paid-use popup.
const REVIEWABLE_CLASSES: ReadonlySet<ToolClass> = new Set(['shell', 'mcp'])
const REVIEWED_MODE: ApprovalMode = 'onRequest'

/** An ask nothing settled: the reviewer may answer it in Auto, and the card offers a session rule. */
function unsettledAsk(isReviewable: boolean): PermissionJudgement {
  return { verdict: 'ask', isReviewable, hasSessionChoice: true }
}

/** A verdict with nothing for the reviewer or a session rule to answer. */
function settled(
  verdict: PermissionVerdict,
  settledBy?: SettledBy,
  rule?: CommandRule,
): PermissionJudgement {
  return { verdict, settledBy, rule, isReviewable: false, hasSessionChoice: false }
}

/** The mode plus the rules a session accumulated. */
export class PermissionEngine {
  private readonly allowed = new Set<string>()

  public constructor(private mode: ApprovalMode) {}

  /** A shell command: the mode, the rules, the profile and the session's rules, in that order. */
  private judgeShell(
    byMode: PermissionVerdict,
    query: PermissionQuery & { readonly command: string },
    policy: PermissionPolicy,
  ): PermissionJudgement {
    const { decision, rule } = judgeCommand(
      policy.commandRules,
      query.command,
      query.dialect ?? 'bash',
    )
    if (decision === 'forbid') {
      return settled('deny', 'forbidRule', rule)
    }
    if (byMode === 'deny') {
      return settled(byMode)
    }
    // M92e (PLAN.md D71): a command holding a detected secret always asks.
    // No allow rule, session rule, profile or ask rule runs it on its own;
    // the card shows the value redacted with no session choice, and the Auto
    // reviewer never sees it. Read from the one shared table in redact.ts.
    if (countSecretMatches(query.command, []) > 0) {
      return settled('ask', 'secretDetected', rule)
    }
    if (byMode !== 'ask') {
      return settled(byMode)
    }
    if (policy.profileName !== undefined) {
      return settled('ask', 'profile')
    }
    if (decision === 'ask') {
      return settled('ask', 'askRule', rule)
    }
    if (decision === 'allow') {
      return settled('allow', 'allowRule', rule)
    }
    if (this.allowed.has(ruleKey(query.toolName, query.command))) {
      return settled('allow')
    }
    const dialect = query.dialect ?? 'bash'
    const shape = commandShape(query.command, dialect)
    if (
      !shape.isPlain ||
      shape.commands.length !== 1 ||
      isEvaluator(shape.commands[0] ?? [], dialect)
    ) {
      return {
        verdict: 'ask',
        settledBy: 'complexCommand',
        isReviewable: false,
        hasSessionChoice: true,
      }
    }
    return unsettledAsk(this.mode === REVIEWED_MODE)
  }

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

  /**
   * Whether the user chose "always allow" for this call on a card in this
   * session, whatever the mode says: what widens a browser check beyond
   * loopback when no card is shown (M81), since Bypass alone never does.
   */
  public isAllowedForSession(query: PermissionQuery): boolean {
    return this.allowed.has(ruleKey(query.toolName, query.command))
  }

  public judge(query: PermissionQuery, policy: PermissionPolicy = NO_POLICY): PermissionJudgement {
    const isProtected = query.isProtected === true
    const isMcp = query.toolClass === 'mcp'
    const isShell = query.toolClass === 'shell'
    const byMode = verdictFor(this.mode, query.toolClass, isProtected, query.isReadOnly === true)
    if (
      isMcp &&
      byMode !== 'deny' &&
      this.mode !== 'allowAll' &&
      policy.profileName !== undefined
    ) {
      // A server's read-only hint does not confine it to our file rules.
      return settled('ask', 'profile')
    }
    const { command } = query
    if (isShell && command !== undefined) {
      return this.judgeShell(byMode, { ...query, command }, policy)
    }
    if (isShell && byMode === 'ask') {
      return {
        verdict: 'ask',
        settledBy: 'complexCommand',
        isReviewable: false,
        hasSessionChoice: true,
      }
    }
    if (byMode !== 'ask') {
      return settled(byMode)
    }
    // A session rule never answers for a protected write or a paid call
    // (D24, D30); the card still offers one, as it always has.
    if (isProtected || query.toolClass === 'paid' || query.toolClass === 'spawn') {
      return { verdict: 'ask', isReviewable: false, hasSessionChoice: true }
    }
    return this.allowed.has(ruleKey(query.toolName, command))
      ? settled('allow')
      : unsettledAsk(this.mode === REVIEWED_MODE && REVIEWABLE_CLASSES.has(query.toolClass))
  }

  public verdict(query: PermissionQuery, policy: PermissionPolicy = NO_POLICY): PermissionVerdict {
    return this.judge(query, policy).verdict
  }
}
