// What a panel and its host say to each other about the playbook (M116).
// The journal's read and change are the bridge every editor's panel uses
// (VS Code, WebView2, JCEF and the companion page; M104 binds the same
// schemas to its authenticated host API routes). The VS Code panel adds the
// hello that names the window's journal and the Agent map's rows. Both sides
// parse what they receive (AGENTS.md rule 7).
import * as z from 'zod/mini'
import {
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_RECORD_MAX,
  REVIEW_FINDING_PATH_MAX_CHARS,
} from '../../shared/constants'
import { playbookRecordSchema } from '../../shared/playbook'
import { playbookChangeSchema, playbookSnapshotSchema } from './command'

const requestId = z.int().check(z.gte(1))
const workspaceId = z.string().check(z.trim(), z.minLength(1), z.maxLength(PLAYBOOK_ID_MAX_CHARS))
const scope = {
  bridgeId: z.string().check(z.regex(/^[A-Za-z\d+/]{22}==$/u)),
  workspaceId,
}
export const playbookRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('playbookRead'), ...scope, requestId }),
  z.strictObject({
    type: z.literal('playbookChange'),
    ...scope,
    requestId,
    change: playbookChangeSchema,
  }),
])
export type PlaybookRequest = z.infer<typeof playbookRequestSchema>
export const playbookResponseSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('playbookState'),
    ...scope,
    requestId,
    snapshot: playbookSnapshotSchema,
  }),
  z.strictObject({ type: z.literal('playbookUnavailable'), ...scope, requestId }),
])

// A session id may be longer than a journal id; the governor bounds what it records.
const longId = z.string().check(z.minLength(1), z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS))
/** A child agent's row: the row's own id, and the ids the host recorded it under. */
export const playbookAgentRefSchema = z.strictObject({
  itemId: longId,
  agentId: longId,
  sessionId: longId,
})
export type PlaybookAgentRef = z.infer<typeof playbookAgentRefSchema>
const agentRefs = z.array(playbookAgentRefSchema).check(z.maxLength(PLAYBOOK_RECORD_MAX))
/** The journal records that concern each row, by the row's id. */
export const playbookAgentRecordsSchema = z.record(
  z.string(),
  z.array(playbookRecordSchema).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
)

const hello = z.strictObject({ type: z.literal('playbookHello') })
const agents = z.strictObject({
  type: z.literal('playbookAgents'),
  requestId,
  children: agentRefs,
})
/** Everything the VS Code panel asks its window's playbook. */
export const playbookPanelRequestSchema = z.union([playbookRequestSchema, hello, agents])
export type PlaybookPanelRequest = z.infer<typeof playbookPanelRequestSchema>

/** The window's journal, by an id that scopes the bridge; absent with no folder open. */
export const playbookHelloSchema = z.strictObject({
  type: z.literal('playbookHello'),
  workspaceId: z.optional(workspaceId),
  /**
   * The conversation has a module under review while its mode lets the
   * backend start subagents without asking: the map says so (D96.17).
   */
  spawnGap: z.optional(z.boolean()),
})
/** The rows' records; an empty answer when the journal could not be read. */
export const playbookAgentsSchema = z.strictObject({
  type: z.literal('playbookAgents'),
  requestId,
  records: playbookAgentRecordsSchema,
})
export type PlaybookPanelResponse =
  | z.infer<typeof playbookResponseSchema>
  | z.infer<typeof playbookHelloSchema>
  | z.infer<typeof playbookAgentsSchema>
