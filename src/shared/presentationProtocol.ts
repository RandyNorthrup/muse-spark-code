import * as z from 'zod/mini'
import { MHP_PRESENTATION } from './constants'
import { hunkSchema } from './hostApi/data'
import { webviewToHostMessageSchema } from './protocol'

const id = z.string().check(z.minLength(1), z.maxLength(MHP_PRESENTATION.maximumIdChars))
const text = z.string().check(z.maxLength(MHP_PRESENTATION.maximumTextChars))
const ids = z.array(id).check(z.maxLength(MHP_PRESENTATION.maximumRecords))
const plan = z.strictObject({ fileName: id, relativePath: text, title: text })
const action = z.strictObject({ id, title: text })
const managerEntry = z.strictObject({
  id,
  title: text,
  detail: text,
  actions: z.array(action).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
})
const role = z.strictObject({
  id,
  name: text,
  providerId: id,
  modelId: id,
  status: text,
  capabilities: ids,
})
const traffic = z.strictObject({
  id,
  sourceId: id,
  targetId: id,
  at: z.number().check(z.gte(0), z.lte(MHP_PRESENTATION.maximumDateMs)),
  summary: text,
})
export const presentationStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('plans'),
    plans: z.array(plan).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
  }),
  z.strictObject({
    kind: z.literal('roles'),
    roles: z.array(role).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
    traffic: z.array(traffic).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
  }),
  z.strictObject({
    kind: z.literal('manager'),
    manager: z.enum(['skills', 'mcp', 'hooks', 'memory', 'worktrees', 'rules', 'agents']),
    title: text.check(z.minLength(1)),
    entries: z.array(managerEntry).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
    actions: z.array(action).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
  }),
  z.strictObject({
    kind: z.literal('diff'),
    reviewId: id,
    title: text,
    hunks: z.array(hunkSchema).check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
  }),
  z.strictObject({
    kind: z.literal('walkthrough'),
    steps: z
      .array(
        z.strictObject({
          id,
          title: text,
          detail: text,
          actionTitle: text,
          action: webviewToHostMessageSchema,
        }),
      )
      .check(z.maxLength(MHP_PRESENTATION.maximumRecords)),
  }),
])
export type PresentationState = z.infer<typeof presentationStateSchema>
export const presentationRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('presentationReady') }),
  z.strictObject({ type: z.literal('presentationReload') }),
  z.strictObject({
    type: z.literal('presentationError'),
    code: z.literal('MHP_PRESENTATION_RENDER_FAILED'),
  }),
  z.strictObject({
    type: z.literal('planAction'),
    requestId: id,
    action: z.enum(['read', 'open', 'implement']),
    fileName: id,
  }),
  z.strictObject({
    type: z.literal('managerAction'),
    requestId: id,
    entryId: z.optional(id),
    actionId: id,
  }),
  z.strictObject({ type: z.literal('openRole'), requestId: id, roleId: id }),
  z.strictObject({
    type: z.literal('diffDecision'),
    requestId: id,
    reviewId: id,
    hunkId: id,
    decision: z.enum(['accept', 'reject', 'cancel']),
  }),
  z.strictObject({ type: z.literal('walkthroughAction'), requestId: id, stepId: id }),
])
export type PresentationRequest = z.infer<typeof presentationRequestSchema>
export const presentationMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('presentationState'), state: presentationStateSchema }),
  z.strictObject({
    type: z.literal('presentationResult'),
    requestId: id,
    result: z.discriminatedUnion('ok', [
      z.strictObject({
        ok: z.literal(true),
        text: z.optional(z.string().check(z.maxLength(MHP_PRESENTATION.maximumTextChars))),
      }),
      z.strictObject({ ok: z.literal(false), code: z.literal('MHP_PRESENTATION_ACTION_FAILED') }),
    ]),
  }),
])
export type PresentationMessage = z.infer<typeof presentationMessageSchema>
