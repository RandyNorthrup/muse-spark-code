// What a Model API session is when the window is gone (PLAN.md D14): the
// replayed conversation, the transcript, the patches behind Open diff and
// Revert, and the row the history list shows. The host keeps one file per
// session (host/backend/fileSessionStore.ts); this module is the shape,
// its validation, and the store interface the host implements. Pure.

import * as z from 'zod/mini'
import { uploadedMediaRefSchema, type UploadedMediaRef } from '../../../shared/media'
import {
  type ItemSnapshot,
  itemSnapshotFields,
  type TodoItem,
  todoItemSchema,
} from '../../../shared/agentEvents'
import {
  AGENT_SOURCES,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  STORED_SESSION_VERSION,
} from '../../../shared/constants'
import { APPROVAL_MODES, type ApprovalMode } from '../../../shared/permissionModes'
import type { AgentRuntime } from '../../context/customAgents'
import type { SessionRecord } from '../../agent/agentBackend'
import { type GoalRecord, goalRecordSchema } from './goalRecord'
import type { SessionBudgetJournal } from './sessionBudget'
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
  /** The transcript user card that supplied this exact replay message (M53). */
  readonly userMessageId?: string
  /** Identifies a background task's terminal model note across fork cuts. */
  readonly backgroundTaskId?: string
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

export interface StoredChild {
  readonly id: string
  readonly role: string
  readonly objective: string
  readonly itemId: string
  readonly parentTurnId: string
  readonly checkpointRecording?: boolean | undefined
  readonly startedAt: number
  readonly state: 'queued' | 'running' | 'interrupted' | 'result_ready' | 'closed'
  readonly result?: {
    readonly summary: string
    readonly text?: string
    readonly errorKind?: string
  }
  readonly terminal?: string
  /** The file policy's revision at the spawn (M78): its results reach the parent only under it. */
  readonly policyRevision?: string
  readonly pendingMessages: readonly string[]
  readonly session: StoredSession
}

/**
 * A completed child's result not yet in a request, with the file policy's
 * revision its child ran under (M78). Plain text is a result saved before
 * revisions were: it is withheld.
 */
export type StoredPendingChildResult =
  string | { readonly childId: string; readonly text: string; readonly policyRevision?: string }

/** One session on disk. Optional fields are absent, never null. */
export interface StoredSession {
  readonly version: typeof STORED_SESSION_VERSION
  readonly sessionId: string
  /** SHA-256 digest of the owning Model API key; absent on legacy files. */
  readonly accountId?: string
  /** M105: durable upload references only; source bytes and paths never belong here. */
  readonly fileRefs?: readonly UploadedMediaRef[]
  readonly sideChat?: boolean
  /**
   * Built from an imported session-export file (M84, PLAN.md D49), or forked
   * from one: its history is untrusted, so it starts asking whenever it is
   * opened.
   */
  readonly imported?: true
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: ApprovalMode
  readonly effort: string
  /**
   * A custom agent's narrowed run (M76): present on a child spawned with an
   * agent, so a resume or fork keeps its prompt, tools and ceiling. Absent
   * on parents, plain children, and sessions saved before M76's review.
   */
  readonly agent?: AgentRuntime
  readonly name?: string
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly turnIds: readonly string[]
  /** Last completed turn covered by the accepted compaction summary (M53). */
  readonly compactedThroughTurnId?: string
  readonly forkedFrom?: string
  readonly firstPrompt?: string
  readonly todos: readonly TodoItem[]
  /** The session goal (M45, PLAN.md D38); absent when there is none. */
  readonly goal?: GoalRecord
  readonly replay: readonly StoredReplayItem[]
  readonly transcript: readonly StoredTranscriptItem[]
  /** Patch documents by output reference (`tool_patch-<itemId>`). */
  readonly outputs: Readonly<Record<string, string>>
  readonly usage: StoredUsage
  /** Dollars the session's own requests spent (M82); absent when none. */
  readonly budgetSpentUsd?: number
  /** Controlled first fork snapshot: copied history predates this conversation's zero spend. */
  readonly budgetIsFreshFork?: true
  /**
   * Observation packing's ledger (M73): the estimated tokens packed sends
   * left out. Absent where the session never packed, and in a file saved
   * before the ledger was kept, which resumes at zero.
   */
  readonly packedTokensAvoided?: number
  readonly hookTokensAdded?: number
  /** Children are nested in the parent's file; they do not appear in History. */
  readonly children?: readonly StoredChild[]
  /** Completed children whose results have not entered the next model request. */
  readonly pendingChildResults?: readonly StoredPendingChildResult[]
  readonly spawnCommands?: Readonly<Record<string, string>>
}

/**
 * What the history list needs of a stored session, without its conversation
 * (PLAN.md D26): a window keeps these in memory and loads a session whole
 * only when it is resumed, forked or read.
 */
export interface StoredSessionHeader {
  readonly sessionId: string
  readonly accountId?: string
  readonly sideChat?: boolean
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
  /** Shared request liabilities and spend; required for a finite cap. */
  readonly budget?: SessionBudgetJournal
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
    ...(stored.accountId !== undefined && { accountId: stored.accountId }),
    ...(stored.sideChat === true && { sideChat: true }),
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
// A PDF the conversation carries (M54): replayed as it went, so its bytes stay with the session.
const inputFilePartSchema = z.object({
  type: z.literal('input_file'),
  filename: z.string(),
  file_data: z.string(),
})
const outputTextPartSchema = z.object({ type: z.literal('output_text'), text: z.string() })
const inputMessageSchema = z.object({
  type: z.literal('message'),
  role: z.enum(['user', 'assistant', 'developer']),
  phase: z.optional(z.enum(MESSAGE_PHASES)),
  content: z.array(
    z.union([inputTextPartSchema, inputImagePartSchema, inputFilePartSchema, outputTextPartSchema]),
  ),
})
const functionCallOutputSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string(),
  // Content parts when an MCP tool returned pictures (M50).
  output: z.union([z.string(), z.array(z.union([inputTextPartSchema, inputImagePartSchema]))]),
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

const storedUsageSchema = z.object({
  inputTokens: z.number().check(z.nonnegative()),
  outputTokens: z.number().check(z.nonnegative()),
  cachedTokens: z.number().check(z.nonnegative()),
  reasoningTokens: z.number().check(z.nonnegative()),
})

const storedSessionFields = {
  version: z.literal(STORED_SESSION_VERSION),
  sessionId: z.string(),
  // Legacy sessions remain readable for retention, but are never admitted.
  accountId: z.optional(z.string().check(z.regex(/^[a-f0-9]{64}$/))),
  fileRefs: z.optional(z.array(uploadedMediaRefSchema)),
  sideChat: z.optional(z.boolean()),
  imported: z.optional(z.literal(true)),
  workspaceRoot: z.string(),
  modelId: z.string(),
  approvalMode: z.enum(APPROVAL_MODES),
  effort: z.string(),
  // Optional, so a session saved before M76's review still reads.
  agent: z.optional(
    z.object({
      id: z.string(),
      source: z.enum(AGENT_SOURCES),
      prompt: z.string(),
      toolAllowlist: z.optional(z.array(z.string())),
      effort: z.enum(EFFORT_LEVELS),
      approvalMode: z.optional(z.enum(APPROVAL_MODES)),
      permissionMode: z.optional(z.enum(PERMISSION_MODES)),
    }),
  ),
  name: z.optional(z.string()),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  turnIds: z.array(z.string()),
  compactedThroughTurnId: z.optional(z.string()),
  forkedFrom: z.optional(z.string()),
  firstPrompt: z.optional(z.string()),
  todos: z.array(todoItemSchema),
  // Optional, so a session saved before M45 still reads.
  goal: z.optional(goalRecordSchema),
  replay: z.array(
    z.object({
      turnId: z.string(),
      item: storedInputItemSchema,
      userMessageId: z.optional(z.string()),
      backgroundTaskId: z.optional(z.string()),
    }),
  ),
  // Each item keeps its optional `recordedAt` (M87, PLAN.md D66): the time the
  // host stamped on a user message or reply; a file saved before has none.
  transcript: z.array(
    z.object({
      turnId: z.string(),
      item: z.object({
        ...itemSnapshotFields,
        usage: z.optional(storedUsageSchema),
        costUsd: z.optional(z.number().check(z.nonnegative())),
      }),
    }),
  ),
  outputs: z.record(z.string(), z.string()),
  usage: storedUsageSchema,
  // Optional, so a session saved before M82 still reads; never below zero,
  // which would give the cap room it does not have.
  budgetSpentUsd: z.optional(z.number().check(z.nonnegative())),
  budgetIsFreshFork: z.optional(z.literal(true)),
  // Optional, so a session saved before M73 kept its ledger still reads; a
  // corrupt value is dropped before validation (withoutCorruptEstimate).
  packedTokensAvoided: z.optional(z.int().check(z.nonnegative())),
  hookTokensAdded: z.optional(z.int().check(z.nonnegative())),
} as const

export const storedSessionSchema = z.object({
  ...storedSessionFields,
  children: z.optional(
    z.array(
      z.object({
        id: z.string(),
        role: z.string(),
        objective: z.string(),
        itemId: z.string(),
        parentTurnId: z.string(),
        checkpointRecording: z.optional(z.boolean()),
        startedAt: z.number(),
        state: z.enum(['queued', 'running', 'interrupted', 'result_ready', 'closed']),
        result: z.optional(
          z.object({
            summary: z.string(),
            text: z.optional(z.string()),
            errorKind: z.optional(z.string()),
          }),
        ),
        terminal: z.optional(z.string()),
        policyRevision: z.optional(z.string()),
        pendingMessages: z.array(z.string()),
        session: z.object(storedSessionFields),
      }),
    ),
  ),
  pendingChildResults: z.optional(
    z.array(
      z.union([
        z.string(),
        z.object({
          childId: z.string(),
          text: z.string(),
          policyRevision: z.optional(z.string()),
        }),
      ]),
    ),
  ),
  spawnCommands: z.optional(z.record(z.string(), z.string())),
})

export type StoredSessionParse =
  | { readonly ok: true; readonly session: StoredSession }
  | { readonly ok: false; readonly reason: string }

/**
 * A missing or corrupt packed-token estimate restarts at zero without losing
 * the conversation (M73). zod's `catch` would do this too, but it keeps
 * zod's `navigator` probe in the host bundles (scripts/check-host-globals.mjs).
 */
function withoutCorruptEstimate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('packedTokensAvoided' in raw)) {
    return raw
  }
  const value: unknown = raw.packedTokensAvoided
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return raw
  }
  const { packedTokensAvoided: _dropped, ...rest } = raw
  return rest
}

/** Validates one parsed JSON document. */
export function parseStoredSession(raw: unknown): StoredSessionParse {
  const result = storedSessionSchema.safeParse(withoutCorruptEstimate(raw))
  if (!result.success) {
    return { ok: false, reason: z.prettifyError(result.error) }
  }
  // Optional fields are absent in a StoredSession, never undefined.
  const {
    accountId,
    fileRefs,
    name,
    forkedFrom,
    firstPrompt,
    compactedThroughTurnId,
    goal,
    sideChat,
    imported,
    children,
    pendingChildResults,
    spawnCommands,
    budgetSpentUsd,
    budgetIsFreshFork,
    agent,
    packedTokensAvoided,
    hookTokensAdded,
    ...rest
  } = result.data
  const replay = rest.replay.map(({ backgroundTaskId, userMessageId, ...entry }) => ({
    ...entry,
    ...(userMessageId !== undefined && { userMessageId }),
    ...(backgroundTaskId !== undefined && { backgroundTaskId }),
  }))
  const restoredChildren: StoredChild[] = []
  const storedChildren = children ?? []
  for (const child of storedChildren) {
    const parsedChild = parseStoredSession(child.session)
    if (!parsedChild.ok) {
      return parsedChild
    }
    const { result: childResult, terminal, policyRevision, session: _session, ...childRest } = child
    restoredChildren.push({
      ...childRest,
      session: parsedChild.session,
      ...(policyRevision !== undefined && { policyRevision }),
      ...(childResult !== undefined && {
        result: {
          summary: childResult.summary,
          ...(childResult.text !== undefined && { text: childResult.text }),
          ...(childResult.errorKind !== undefined && { errorKind: childResult.errorKind }),
        },
      }),
      ...(terminal !== undefined && { terminal }),
    })
  }
  return {
    ok: true,
    session: {
      ...rest,
      ...(accountId !== undefined && { accountId }),
      ...(fileRefs !== undefined && { fileRefs }),
      replay,
      ...(name !== undefined && { name }),
      ...(forkedFrom !== undefined && { forkedFrom }),
      ...(firstPrompt !== undefined && { firstPrompt }),
      ...(compactedThroughTurnId !== undefined && { compactedThroughTurnId }),
      ...(goal !== undefined && { goal }),
      ...(budgetSpentUsd !== undefined && { budgetSpentUsd }),
      ...(budgetIsFreshFork === true && { budgetIsFreshFork }),
      ...(sideChat === true && { sideChat: true }),
      ...(imported === true && { imported: true }),
      ...(children !== undefined && { children: restoredChildren }),
      ...(pendingChildResults !== undefined && {
        pendingChildResults: pendingChildResults.map((pending) =>
          typeof pending === 'string'
            ? pending
            : {
                childId: pending.childId,
                text: pending.text,
                ...(pending.policyRevision !== undefined && {
                  policyRevision: pending.policyRevision,
                }),
              },
        ),
      }),
      ...(spawnCommands !== undefined && { spawnCommands }),
      ...(agent !== undefined && { agent }),
      ...(packedTokensAvoided !== undefined && { packedTokensAvoided }),
      ...(hookTokensAdded !== undefined && { hookTokensAdded }),
    },
  }
}

const IDLE = 'idle'

/** The history-list row of a session that is not loaded in this window. */
export function recordOf(stored: StoredSessionHeader): SessionRecord {
  return {
    sessionId: stored.sessionId,
    ...(stored.sideChat === true && { sideChat: true }),
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
