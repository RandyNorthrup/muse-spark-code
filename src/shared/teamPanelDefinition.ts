// M96 U1: application messages, not vendor wire frames. No credentials or
// provider definitions cross this boundary. Nested draft objects are strict.
import * as z from 'zod/mini'
import {
  AGENT_ID_PATTERN,
  TEAM_TOOL_GROUPS,
  TEAM_EXPORT_FORMAT,
  TEAM_PANEL_EXPORT_VERSION,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  AGENT_FILE_MAX_BYTES,
} from './constants'
import {
  teamAgentRefSchema,
  teamCapSchema,
  teamModelSettingsSchema,
  teamRoleConfigSchema,
  teamSnapshotSchema,
} from './team'
import { teamTreeSchema } from './teamView'

const id = z.string().check(z.minLength(1))
const text = z.string().check(z.maxLength(TEAM_ROLE_WHEN_TO_USE_MAX_CHARS))
export const teamTemplateSchema = z.enum(['solo', 'pair', 'full', 'custom'])
const agent = z.strictObject(teamAgentRefSchema.shape)
const settings = z.strictObject(teamModelSettingsSchema.shape)
const cap = z.strictObject(teamCapSchema.shape)
const entry = z.strictObject({
  id,
  agent: z.optional(agent),
  concurrent: z.int().check(z.gte(1)),
  caps: z.array(cap),
  settings: z.optional(settings),
})
const teamEditorRoleSchema = z.strictObject({
  ...teamRoleConfigSchema.shape,
  role: id.check(z.regex(AGENT_ID_PATTERN)),
  pool: z.array(entry),
  purpose: z.optional(text),
  done: z.optional(text),
  guidance: z.optional(z.string().check(z.maxLength(AGENT_FILE_MAX_BYTES))),
  custom: z.optional(z.boolean()),
})
export const teamEditorDocumentSchema = z
  .strictObject({
    ...teamSnapshotSchema.shape,
    roles: z.array(teamEditorRoleSchema),
    orchestrator: z.optional(
      z.strictObject({ agent: z.optional(agent), settings: z.optional(settings) }),
    ),
    template: teamTemplateSchema,
  })
  .check(
    z.refine(
      (snapshot) =>
        snapshot.orchestratorModel === undefined ||
        snapshot.orchestrator?.agent === undefined ||
        snapshot.orchestratorModel === snapshot.orchestrator.agent.model,
    ),
  )
export type TeamEditorDocument = z.infer<typeof teamEditorDocumentSchema>
export type TeamEditorRole = z.infer<typeof teamEditorRoleSchema>
const control = z.strictObject({
  key: z.enum([
    'effort',
    'thinking',
    'thinkingBudget',
    'tier',
    'outputCap',
    'temperature',
    'topP',
    'verbosity',
    'parallelToolCalls',
    'windowCap',
  ]),
  label: z.string(),
  note: z.string(),
  kind: z.enum(['boolean', 'number', 'choice']),
  choices: z.optional(z.array(z.string())),
  min: z.optional(z.number()),
  max: z.optional(z.number()),
})
export type TeamSettingControl = z.infer<typeof control>
export const teamPanelOfferSchema = z.strictObject({
  ref: id,
  label: z.string(),
  agent,
  toolCalling: z.boolean(),
  contextWindow: z.optional(z.number().check(z.gte(1))),
  imageInput: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  inputRate: z.optional(z.number().check(z.gte(0))),
  outputRate: z.optional(z.number().check(z.gte(0))),
  cachedRate: z.optional(z.number().check(z.gte(0))),
  ceiling: z.int().check(z.gte(1)),
  controls: z.array(control),
})
export type TeamPanelOffer = z.infer<typeof teamPanelOfferSchema>
export const teamPreviewSampleSchema = z.enum([
  'feature-tests',
  'research-library',
  'review-branch',
])
const suggestion = z.strictObject({
  kind: z.enum(['roleModel', 'roleBudget', 'reviewVendor', 'poolFallback']),
  role: id,
  reason: z.string(),
  modelRef: z.optional(z.string()),
  amount: z.optional(z.number()),
})
const roleView = z.strictObject({
  role: id,
  name: z.string(),
  generated: z.string(),
  allowedTools: z.array(z.enum(TEAM_TOOL_GROUPS)),
  issues: z.array(z.string()),
  warnings: z.array(z.string()),
  reasons: z.record(z.string(), z.string()),
})
export const teamPanelSliceSchema = z.strictObject({
  document: teamEditorDocumentSchema,
  offers: z.array(teamPanelOfferSchema),
  roleViews: z.array(roleView),
  suggestions: z.array(suggestion),
  levelCosts: z.record(z.string(), z.string()),
  sample: teamPreviewSampleSchema,
  preview: z.strictObject({
    cost: z.string(),
    switches: z.string(),
    steps: z.array(z.strictObject({ role: id, model: id, switched: z.boolean() })),
    unstaffed: z.array(z.string()),
  }),
  dirty: z.boolean(),
  hasSavedConfiguration: z.boolean(),
  issues: z.array(z.string()),
  notice: z.optional(z.string()),
  defaultRef: z.string(),
  maxWorkers: z.int().check(z.gte(1)),
  dryRunCost: z.optional(z.string()),
})
export type TeamPanelSlice = z.infer<typeof teamPanelSliceSchema>
export const teamAgentsSliceSchema = z.strictObject({ tree: z.optional(teamTreeSchema) })
const roleFields = z.strictObject({
  workspace: teamEditorRoleSchema.shape.workspace,
  tools: teamEditorRoleSchema.shape.tools,
  writePaths: teamEditorRoleSchema.shape.writePaths,
  report: teamEditorRoleSchema.shape.report,
  delegates: teamEditorRoleSchema.shape.delegates,
  exhausted: teamEditorRoleSchema.shape.exhausted,
  continueOnNext: teamEditorRoleSchema.shape.continueOnNext,
  permissionMode: teamEditorRoleSchema.shape.permissionMode,
  purpose: teamEditorRoleSchema.shape.purpose,
  done: teamEditorRoleSchema.shape.done,
  guidance: teamEditorRoleSchema.shape.guidance,
})
const entryFields = z.strictObject({
  concurrent: z.optional(z.int().check(z.gte(1))),
  settings: z.optional(settings),
})
const teamPanelMessageSchemas = [
  z.strictObject({ type: z.literal('roles/template'), template: teamTemplateSchema }),
  z.strictObject({ type: z.literal('roles/addRole'), role: id.check(z.regex(AGENT_ID_PATTERN)) }),
  z.strictObject({ type: z.literal('roles/removeRole'), role: id }),
  z.strictObject({ type: z.literal('roles/updateRole'), role: id, fields: roleFields }),
  z.strictObject({ type: z.literal('roles/addEntry'), role: id, modelRef: id }),
  z.strictObject({ type: z.literal('roles/removeEntry'), role: id, entryId: id }),
  z.strictObject({
    type: z.literal('roles/moveEntry'),
    role: id,
    entryId: id,
    to: z.int().check(z.gte(0)),
  }),
  z.strictObject({
    type: z.literal('roles/updateEntry'),
    role: id,
    entryId: id,
    fields: entryFields,
  }),
  z.strictObject({
    type: z.literal('roles/cap'),
    role: id,
    entryId: id,
    index: z.int().check(z.gte(0)),
    cap: z.optional(cap),
  }),
  z.strictObject({
    type: z.literal('roles/orchestrator'),
    modelRef: z.optional(id),
    settings: z.optional(settings),
  }),
  z.strictObject({ type: z.literal('roles/intensity'), level: teamSnapshotSchema.shape.intensity }),
  z.strictObject({ type: z.literal('roles/reapply'), role: id }),
  z.strictObject({
    type: z.literal('roles/suggestion'),
    role: id,
    kind: suggestion.shape.kind,
    decision: z.enum(['accept', 'dismiss']),
  }),
  z.strictObject({ type: z.literal('roles/preview'), sample: teamPanelSliceSchema.shape.sample }),
  z.strictObject({ type: z.literal('roles/try') }),
  z.strictObject({ type: z.literal('roles/save') }),
  z.strictObject({ type: z.literal('roles/reset') }),
  z.strictObject({ type: z.literal('roles/import') }),
  z.strictObject({ type: z.literal('roles/export') }),
  z.strictObject({ type: z.literal('agents/stopTask'), taskId: id }),
  z.strictObject({ type: z.literal('agents/stopAll') }),
  z.strictObject({ type: z.literal('agents/resetEntry'), entryId: id }),
  z.strictObject({ type: z.literal('agents/transcript'), taskId: id }),
  z.strictObject({ type: z.literal('agents/diff'), taskId: id }),
  z.strictObject({
    type: z.literal('agents/merge'),
    taskId: id,
    decision: z.enum(['merge', 'discard']),
  }),
] as const
export const teamPanelMessageSchema = z.discriminatedUnion('type', teamPanelMessageSchemas)
export type TeamPanelMessage = z.infer<typeof teamPanelMessageSchema>

export const teamPanelExportSchema = z.strictObject({
  format: z.literal(TEAM_EXPORT_FORMAT),
  version: z.literal(TEAM_PANEL_EXPORT_VERSION),
  document: teamEditorDocumentSchema,
})
