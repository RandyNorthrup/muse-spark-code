// M124 (D106): every tool of design §3, what its own code says it does, and
// whether this build backs it. A tool without a backing owner answers
// `unavailable` with its reason when called and is not listed; it never
// returns an empty success. Descriptions are maintained text
// (CONNECTOR_MODEL_TEXT), never populated from remote content.
import { CONNECTOR_LIMITS, type CONNECTOR_MODEL_TEXT, REPORT_KINDS } from './constants'
import type { ConnectorBackedTool, ConnectorClass, ConnectorScope } from './connector'

type JsonSchema = Readonly<Record<string, unknown>>
type ModelTextKey = keyof typeof CONNECTOR_MODEL_TEXT

export interface ConnectorToolSpec {
  readonly name: string
  readonly toolClass: ConnectorClass
  /** Every scope the grant must hold; content tools add `content:read`. */
  readonly scopes: readonly ConnectorScope[]
  /** Backed tools name their description; unavailable ones name their reason. */
  readonly availability:
    | {
        readonly kind: 'backed'
        readonly tool: ConnectorBackedTool
        readonly description: ModelTextKey
        readonly inputSchema: JsonSchema
      }
    | { readonly kind: 'unavailable'; readonly reason: ModelTextKey }
}

const id = { type: 'string', minLength: 1, maxLength: CONNECTOR_LIMITS.idChars }
const text = { type: 'string', minLength: 1 }
const generation = { type: 'integer', minimum: 0 }
const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: id,
    limit: { type: 'integer', minimum: 1, maximum: CONNECTOR_LIMITS.pageMax },
  },
}
const tags = { type: 'array', items: text, minItems: 1, maxItems: CONNECTOR_LIMITS.tagsMax }
const scope = { type: 'string', enum: ['user', 'workspace'] }

function object(properties: Readonly<Record<string, unknown>>, required: readonly string[]) {
  return { type: 'object', additionalProperties: false, properties, required }
}

function backed(
  name: ConnectorBackedTool,
  toolClass: ConnectorClass,
  scopes: readonly ConnectorScope[],
  description: ModelTextKey,
  inputSchema: JsonSchema,
): ConnectorToolSpec {
  return {
    name,
    toolClass,
    scopes,
    availability: { kind: 'backed', tool: name, description, inputSchema },
  }
}

function unavailable(
  name: string,
  toolClass: ConnectorClass,
  scopes: readonly ConnectorScope[],
  reason: ModelTextKey,
): ConnectorToolSpec {
  return { name, toolClass, scopes, availability: { kind: 'unavailable', reason } }
}

/** Design §3's 22 unconditional tools; the conditional machine Stop is not offered. */
export const CONNECTOR_TOOLS: readonly ConnectorToolSpec[] = [
  unavailable('muse_fleet_status', 'read', ['fleet:read'], 'reasonNoFleetStore'),
  unavailable('muse_agent_outcomes', 'read', ['fleet:read'], 'reasonNoFleetStore'),
  unavailable('muse_receipt_get', 'read', ['evidence:read'], 'reasonNoFleetStore'),
  backed(
    'muse_operation_get',
    'read',
    ['operations:read'],
    'operationGet',
    object({ operationId: id }, ['operationId']),
  ),
  unavailable('muse_lane_start', 'run', ['lanes:run'], 'reasonNoRunPort'),
  unavailable('muse_lane_continue', 'run', ['lanes:run'], 'reasonNoRunPort'),
  unavailable('muse_team_start', 'run', ['teams:run'], 'reasonNoRunPort'),
  unavailable('muse_team_continue', 'run', ['teams:run'], 'reasonNoRunPort'),
  backed(
    'muse_stop',
    'stop',
    ['control:stop'],
    'stop',
    object(
      {
        workspaceId: id,
        target: object({ kind: { type: 'string', enum: ['lane', 'team', 'operation'] }, id }, [
          'kind',
          'id',
        ]),
      },
      ['target'],
    ),
  ),
  unavailable('muse_playbook_advice', 'read', ['advice:read'], 'reasonAdviceNotWired'),
  unavailable('muse_capacity_estimate', 'read', ['advice:read'], 'reasonAdviceNotWired'),
  backed(
    'muse_report',
    'read',
    ['reports:read'],
    'report',
    object(
      {
        workspaceId: id,
        kind: { type: 'string', enum: [...REPORT_KINDS] },
        subjectId: id,
        format: { type: 'string', enum: ['markdown'] },
      },
      ['workspaceId', 'kind', 'format'],
    ),
  ),
  backed(
    'muse_schedule_list',
    'read',
    ['schedules:read'],
    'scheduleList',
    object({ workspaceId: id, page }, ['workspaceId']),
  ),
  unavailable('muse_schedule_create', 'write', ['schedules:write'], 'reasonScheduleGrant'),
  unavailable('muse_schedule_update', 'write', ['schedules:write'], 'reasonScheduleGrant'),
  backed(
    'muse_schedule_cancel',
    'stop',
    ['control:stop'],
    'scheduleCancel',
    object({ workspaceId: id, scheduleId: id }, ['workspaceId', 'scheduleId']),
  ),
  backed(
    'muse_prompt_list',
    'read',
    ['prompts:read'],
    'promptList',
    object({ workspaceId: id, scope, query: text, tags, page }, ['scope']),
  ),
  backed(
    'muse_prompt_get',
    'read',
    ['prompts:read', 'content:read'],
    'promptGet',
    object({ workspaceId: id, promptId: id }, ['promptId']),
  ),
  backed(
    'muse_prompt_save',
    'write',
    ['prompts:write'],
    'promptSave',
    object(
      {
        requestId: id,
        expectedGeneration: generation,
        workspaceId: id,
        scope,
        title: text,
        body: text,
        tags,
      },
      ['requestId', 'expectedGeneration', 'scope', 'title', 'body'],
    ),
  ),
  backed(
    'muse_prompt_prepare',
    'read',
    ['prompts:read', 'content:read'],
    'promptPrepare',
    object(
      {
        workspaceId: id,
        promptId: id,
        expectedGeneration: generation,
        variables: {
          type: 'object',
          maxProperties: CONNECTOR_LIMITS.variablesMax,
          additionalProperties: { type: 'string' },
        },
      },
      ['promptId', 'expectedGeneration', 'variables'],
    ),
  ),
  backed(
    'muse_share_preview',
    'read',
    ['sharing:read', 'content:read'],
    'sharePreview',
    object(
      {
        workspaceId: id,
        source: {
          oneOf: [
            object({ kind: { const: 'prompt' }, promptId: id }, ['kind', 'promptId']),
            object(
              {
                kind: { const: 'chat' },
                sessionId: id,
                mode: { type: 'string', enum: ['conversation', 'full'] },
              },
              ['kind', 'sessionId', 'mode'],
            ),
          ],
        },
        format: { type: 'string', enum: ['markdown', 'html', 'json'] },
      },
      ['source', 'format'],
    ),
  ),
  unavailable('muse_share_publish', 'write', ['sharing:write'], 'reasonPublish'),
]

export function connectorTool(name: string): ConnectorToolSpec | undefined {
  return CONNECTOR_TOOLS.find((tool) => tool.name === name)
}
