// The MSP `Session` object (`session/list` rows, the resume / read / fork
// envelopes and `session/listChanged`) and the history envelope those
// commands serve, narrowed to what the extension reads. Shapes verified
// live 2026-09-22 on Muse Code 1.3.0 (PLAN.md §6 M6, scratchpad probes).

import * as z from 'zod/mini'
import {
  type ItemSnapshot,
  itemSnapshotFields,
  type SessionGoal,
  todoItemSchema,
} from '../../../shared/agentEvents'
import { IDE_PAID_TOOLS } from '../../../shared/constants'

import { sessionActivityFields } from '../../../shared/sessions'
import type { SessionHistoryOutcome } from '../../agent/agentBackend'

/**
 * MSP's `Goal` block (M45, PLAN.md D38) as `session/goalChanged` and a
 * snapshot's `state.goal` carry it (captured live 2026-09-25: the work
 * fields are absent until reported). A `null` work field is read as absent.
 */
export const wireGoalSchema = z.object({
  objective: z.string(),
  status: z.string(),
  percentComplete: z.number(),
  currentWork: z.optional(z.nullable(z.string())),
  nextWork: z.optional(z.nullable(z.string())),
})
type WireGoal = z.infer<typeof wireGoalSchema>

export function toSessionGoal(goal: WireGoal): SessionGoal {
  return {
    objective: goal.objective,
    status: goal.status,
    percentComplete: goal.percentComplete,
    ...(typeof goal.currentWork === 'string' && { currentWork: goal.currentWork }),
    ...(typeof goal.nextWork === 'string' && { nextWork: goal.nextWork }),
  }
}

/**
 * A snapshot's goal, read on its own (the review of PR #29's rule): a goal
 * that is not the captured shape costs the strip, never the resume. `null`
 * is "no goal"; anything unreadable is "cannot say".
 */
function snapshotGoal(raw: unknown): SessionGoal | null | undefined {
  if (raw === null) {
    return null
  }
  const parsed = wireGoalSchema.safeParse(raw)
  return parsed.success ? toSessionGoal(parsed.data) : undefined
}

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
    // An image the extension's own `ide` server bought with the key (M44).
    ...(item.tool !== undefined && IDE_PAID_TOOLS.has(item.tool) && { paid: 'imageGeneration' }),
  }
}

// `history.mode` is what was served, never what was asked: `inline` carries
// the item array, `snapshot` / `anchoredSnapshot` carry the folded state
// (items plus name, todo list and goal), `none` carries nothing (paged
// later). The goal is taken as it comes and read on its own (M45).
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
          goal: z.optional(z.unknown()),
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
  // Only a snapshot can say whether there is a goal: its `goal` is `null`
  // when there is none (live 2026-09-25). Inline history says nothing, nor
  // does a snapshot served as its items alone (msp.d.ts SnapshotState, E8).
  const goal = snapshot?.goal === undefined ? undefined : snapshotGoal(snapshot.goal)
  return {
    mode: history.mode,
    items: items.map((item) => toSnapshot(item)),
    name: snapshot?.name ?? session.name,
    todos: snapshot?.todoList?.items ?? [],
    ...(goal !== undefined && { goal }),
  }
}
