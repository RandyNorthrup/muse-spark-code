// The session board (M77, PLAN.md D49): one row per conversation in the
// window, on either backend, with the worktree it runs in when it has one.
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'

// The backend pair, repeated here instead of imported from protocol.ts: that
// module carries these rows, so importing it would cycle (the dpdm gate).
export const BOARD_BACKENDS = ['museCode', 'modelApi'] as const

/** What the board shows for one conversation. */
export const boardRowSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  backend: z.enum(BOARD_BACKENDS),
  /** `running` while a turn of the conversation is open on the wire. */
  status: z.enum(['running', 'idle']),
  /** The git branch the conversation works on, when the backend names one. */
  branch: z.optional(z.string()),
  /** The worktree folder the conversation runs in, when it runs in one. */
  worktreePath: z.optional(z.string()),
  /** Changed files in that worktree, absent when git could not say. */
  changedFiles: z.optional(z.int().check(z.nonnegative())),
  /** Approvals waiting on the user in this conversation. */
  awaitingApproval: z.boolean(),
})
export type BoardRow = z.infer<typeof boardRowSchema>
