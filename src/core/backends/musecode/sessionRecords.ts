// The MSP `Session` object (`session/list` rows, the resume / read / fork
// envelopes and `session/listChanged`) and the history envelope those
// commands serve, narrowed to what the extension reads. Shapes verified
// live 2026-09-22 on Muse Code 1.3.0 (PLAN.md §6 M6, scratchpad probes).

import * as z from 'zod/mini'
import { type ItemSnapshot, itemSnapshotFields, todoItemSchema } from '../../../shared/agentEvents'
import { sessionActivityFields } from '../../../shared/sessions'
import type { SessionHistoryOutcome } from '../../agent/agentBackend'

export const sessionRecordSchema = z.object({
  sessionId: z.string(),
  /** Allocated name; absent until the host names the session. */
  name: z.optional(z.string()),
  /** Derived display title (the first prompt for unnamed sessions). */
  title: z.optional(z.string()),
  firstUserPrompt: z.optional(z.string()),
  ...sessionActivityFields,
  forkedFrom: z.optional(z.nullable(z.object({ sessionId: z.string() }))),
  workspaceRoot: z.optional(z.nullable(z.string())),
  /** The running foreground turn; `null` when idle (msp.d.ts Session.activeTurnId, D26). */
  activeTurnId: z.optional(z.nullable(z.string())),
})

// The wire item is the snapshot with `turnId` nullable (`null` on userShell)
// and the user message's `displayText` (its presentation form, M5).
export const wireItemSchema = z.object({
  ...itemSnapshotFields,
  turnId: z.optional(z.nullable(z.string())),
  displayText: z.optional(z.nullable(z.string())),
})
export type WireItem = z.infer<typeof wireItemSchema>

/**
 * Drops the `null` turn (userShell) so the snapshot's `turnId` stays a
 * string; a user message's `displayText` replaces its model-visible text
 * (the M5 editor context is never shown as typed text).
 */
export function toSnapshot(item: WireItem): ItemSnapshot {
  const { turnId, displayText, ...rest } = item
  return {
    ...rest,
    ...(typeof turnId === 'string' && { turnId }),
    ...(typeof displayText === 'string' && { text: displayText }),
  }
}

// `history.mode` is what was served, never what was asked: `inline` carries
// the item array, `snapshot` / `anchoredSnapshot` carry the folded state
// (items plus name and todo list), `none` carries nothing (paged later).
const historySchema = z.object({
  mode: z.string(),
  items: z.optional(z.nullable(z.array(wireItemSchema))),
  snapshot: z.optional(
    z.nullable(
      z.object({
        state: z.object({
          items: z.array(wireItemSchema),
          name: z.optional(z.nullable(z.string())),
          todoList: z.optional(z.nullable(z.object({ items: z.array(todoItemSchema) }))),
        }),
      }),
    ),
  ),
  noneReason: z.optional(z.string()),
})

/** The envelope `session/resume`, `session/read` and `session/fork` share. */
export const sessionEnvelopeSchema = z.object({
  session: sessionRecordSchema,
  history: historySchema,
  viewCursor: z.string(),
  // Late-joiner pointers at unsettled prompts (tdd SS2.5.2); their payloads
  // follow as re-issued server requests and from `approval/listPending`.
  pendingRequests: z.optional(z.array(z.object({ kind: z.string() }))),
})
export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>

export const sessionListResultSchema = z.object({
  sessions: z.array(sessionRecordSchema),
  nextCursor: z.nullable(z.string()),
})

export const sessionListChangedSchema = z.object({ session: sessionRecordSchema })
export const sessionClosedSchema = z.object({ sessionId: z.string(), reason: z.string() })

export const sessionRenameResultSchema = z.object({
  status: z.string(),
  name: z.optional(z.string()),
})

export function historyOutcome(envelope: SessionEnvelope): SessionHistoryOutcome {
  const { history, session } = envelope
  const snapshot = history.snapshot?.state
  const items = history.items ?? snapshot?.items ?? []
  return {
    mode: history.mode,
    items: items.map((item) => toSnapshot(item)),
    name: snapshot?.name ?? session.name,
    todos: snapshot?.todoList?.items ?? [],
  }
}
