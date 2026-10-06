// The Muse Code judge's hidden session (M98 lane S, PLAN.md D77): a fresh
// hidden session per batch, never M90's reviewer session and never a fork or
// resume of the main session. It starts with `session/start` in the same
// `muse serve`, in its own empty temporary folder (deleted after the batch,
// so workspace allow rules do not apply), in Plan mode (`denyUnmatched`,
// like M90's side session) with no MCP servers, and the judged text fenced
// as data in a standalone prompt. No `vscode` import.

import type { StartSessionOptions } from '../../agent/agentBackend'
import { mspApprovalMode } from '../../../shared/permissionModes'

// What a judge turn carries without the judge acting (as M90's 2026-10-03
// capture for the reviewer): the turn prompt's own echo, Muse Code's reminder
// agents (they run in child sessions of their own after every turn),
// thinking, and the reply. Any other item is the side session doing
// something, and fails closed: M90's item guard cancels the session on any
// tool item. It reacts after the CLI's notification, so it cannot prove that
// no command ran (the narrowed claim, PLAN.md D77 §9).
export const JUDGE_TURN_ITEM_KINDS: ReadonlySet<string> = new Set([
  'userMessage',
  'reminderChild',
  'reasoning',
  'agentMessage',
])

/** Whether an item kind lets the judge turn continue. Anything else cancels. */
export function isJudgeTurnItemAllowed(kind: string): boolean {
  return JUDGE_TURN_ITEM_KINDS.has(kind)
}

/**
 * The `session/start` options for one judge batch: the batch's own empty
 * temporary folder, the conversation's model (never another model), and Plan
 * mode. No MCP servers are passed at all, so the session gets none.
 */
export function judgeSessionOptions(modelId: string, workspaceRoot: string): StartSessionOptions {
  return {
    workspaceRoot,
    modelId,
    approvalMode: mspApprovalMode('plan'),
  }
}
