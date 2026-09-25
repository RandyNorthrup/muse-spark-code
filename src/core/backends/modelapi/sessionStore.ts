// What a Model API session is when the window is gone (PLAN.md D14): the
// replayed conversation, the transcript, the patches behind Open diff and
// Revert, and the row the history list shows. The host keeps one file per
// session (host/backend/fileSessionStore.ts); this module is the shape,
// its validation, and the store interface the host implements. Pure.

import * as z from 'zod/mini'
import {
  type ItemSnapshot,
  itemSnapshotFields,
  type TodoItem,
  todoItemSchema,
} from '../../../shared/agentEvents'
import { STORED_SESSION_VERSION } from '../../../shared/constants'
import { APPROVAL_MODES, type ApprovalMode } from '../../../shared/permissionModes'
import type { SessionRecord } from '../../agent/agentBackend'
import {
  functionCallItemSchema,
  type InputItem,
  MESSAGE_PHASES,
  reasoningItemSchema,
  webSearchActionSchema,
} from './schemas'

export interface StoredReplayItem {
  readonly turnId: string
  readonly item: InputItem
}

export interface StoredTranscriptItem {
  readonly turnId: string
  readonly item: ItemSnapshot
}

export interface StoredUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
  readonly reasoningTokens: number
}

/** One session on disk. Optional fields are absent, never null. */
export interface StoredSession {
  readonly version: typeof STORED_SESSION_VERSION
  readonly sessionId: string
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: ApprovalMode
  readonly effort: string
  readonly name?: string
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly turnIds: readonly string[]
  readonly forkedFrom?: string
  readonly firstPrompt?: string
  readonly todos: readonly TodoItem[]
  readonly replay: readonly StoredReplayItem[]
  readonly transcript: readonly StoredTranscriptItem[]
  /** Patch documents by output reference (`tool_patch-<itemId>`). */
  readonly outputs: Readonly<Record<string, string>>
  readonly usage: StoredUsage
}

/**
 * What the history list needs of a stored session, without its conversation
 * (PLAN.md D26): a window keeps these in memory and loads a session whole
 * only when it is resumed, forked or read.
 */
export interface StoredSessionHeader {
  readonly sessionId: string
  readonly workspaceRoot: string
  readonly name?: string
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly forkedFrom?: string
  readonly firstPrompt?: string
  readonly turnCount: number
}

/** Where sessions live between windows; the host supplies the files. */
export interface SessionStore {
  /** Every readable session's header; a corrupt file is skipped (and logged), never fatal. */
  list(): Promise<readonly StoredSessionHeader[]>
  /** One session in full; undefined when it is gone or no longer reads. */
  load(sessionId: string): Promise<StoredSession | undefined>
  save(session: StoredSession): Promise<void>
  remove(sessionId: string): Promise<void>
}

export function headerOf(stored: StoredSession): StoredSessionHeader {
  return {
    sessionId: stored.sessionId,
    workspaceRoot: stored.workspaceRoot,
    ...(stored.name !== undefined && { name: stored.name }),
    createdAt: stored.createdAt,
    lastActivityAt: stored.lastActivityAt,
    ...(stored.forkedFrom !== undefined && { forkedFrom: stored.forkedFrom }),
    ...(stored.firstPrompt !== undefined && { firstPrompt: stored.firstPrompt }),
    turnCount: stored.turnIds.length,
  }
}

const inputTextPartSchema = z.object({ type: z.literal('input_text'), text: z.string() })
const inputImagePartSchema = z.object({
  type: z.literal('input_image'),
  image_url: z.string(),
  detail: z.literal('auto'),
})
const outputTextPartSchema = z.object({ type: z.literal('output_text'), text: z.string() })
const inputMessageSchema = z.object({
  type: z.literal('message'),
  role: z.enum(['user', 'assistant', 'developer']),
  phase: z.optional(z.enum(MESSAGE_PHASES)),
  content: z.array(z.union([inputTextPartSchema, inputImagePartSchema, outputTextPartSchema])),
})
const functionCallOutputSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string(),
  output: z.string(),
})
const webSearchCallReplaySchema = z.object({
  type: z.literal('web_search_call'),
  id: z.optional(z.string()),
  status: z.string(),
  action: z.optional(webSearchActionSchema),
})
const storedInputItemSchema = z.union([
  inputMessageSchema,
  functionCallOutputSchema,
  functionCallItemSchema,
  reasoningItemSchema,
  webSearchCallReplaySchema,
])

export const storedSessionSchema = z.object({
  version: z.literal(STORED_SESSION_VERSION),
  sessionId: z.string(),
  workspaceRoot: z.string(),
  modelId: z.string(),
  approvalMode: z.enum(APPROVAL_MODES),
  effort: z.string(),
  name: z.optional(z.string()),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  turnIds: z.array(z.string()),
  forkedFrom: z.optional(z.string()),
  firstPrompt: z.optional(z.string()),
  todos: z.array(todoItemSchema),
  replay: z.array(z.object({ turnId: z.string(), item: storedInputItemSchema })),
  transcript: z.array(z.object({ turnId: z.string(), item: z.object(itemSnapshotFields) })),
  outputs: z.record(z.string(), z.string()),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedTokens: z.number(),
    reasoningTokens: z.number(),
  }),
})

export type StoredSessionParse =
  | { readonly ok: true; readonly session: StoredSession }
  | { readonly ok: false; readonly reason: string }

/** Validates one parsed JSON document. */
export function parseStoredSession(raw: unknown): StoredSessionParse {
  const result = storedSessionSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, reason: z.prettifyError(result.error) }
  }
  // Optional fields are absent in a StoredSession, never undefined.
  const { name, forkedFrom, firstPrompt, ...rest } = result.data
  return {
    ok: true,
    session: {
      ...rest,
      ...(name !== undefined && { name }),
      ...(forkedFrom !== undefined && { forkedFrom }),
      ...(firstPrompt !== undefined && { firstPrompt }),
    },
  }
}

const IDLE = 'idle'

/** The history-list row of a session that is not loaded in this window. */
export function recordOf(stored: StoredSessionHeader): SessionRecord {
  return {
    sessionId: stored.sessionId,
    ...(stored.name !== undefined && { name: stored.name }),
    ...(stored.firstPrompt !== undefined && {
      title: stored.firstPrompt,
      firstUserPrompt: stored.firstPrompt,
    }),
    createdAt: stored.createdAt,
    updatedAt: stored.lastActivityAt,
    lastActivityAt: stored.lastActivityAt,
    status: IDLE,
    turnCount: stored.turnCount,
    forkedFrom: stored.forkedFrom === undefined ? null : { sessionId: stored.forkedFrom },
    workspaceRoot: stored.workspaceRoot,
  }
}
