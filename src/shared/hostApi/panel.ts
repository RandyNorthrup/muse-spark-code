// Reviewed MHP 1.5 boundaries reuse the current shared UI payload schemas.
import * as z from 'zod/mini'
import { MHP, MHP_PANEL } from '../constants'
import { hostToWebviewMessageSchema, webviewToHostMessageSchema } from '../protocol'
import { presentationRequestSchema, presentationMessageSchema } from '../presentationProtocol'
import { tasksHostMessageSchema, tasksWebviewMessageSchema } from '../tasksProtocol'
import { whatsNewMessageSchema } from '../whatsNewMessages'
import { offeredCapabilitiesSchema } from './capabilities'
import { integerSchema, jsonValueSchema, surfaceKindSchema } from './data'
import { MhpPanelError } from './panelError'

const opaqueId = z.string().check(z.minLength(1))
export const panelSurfaceKindSchema = z.union([surfaceKindSchema, z.enum(['usage', 'maker'])])
export const panelBindingSchema = z.strictObject({
  surface: opaqueId,
  sessionId: opaqueId,
  surfaceKind: panelSurfaceKindSchema,
})
export type MhpPanelBinding = z.infer<typeof panelBindingSchema>
export const panelToHostPayloadSchema = z.union([
  webviewToHostMessageSchema,
  tasksWebviewMessageSchema,
  whatsNewMessageSchema,
  presentationRequestSchema,
])
export const panelToPanelPayloadSchema = z.union([
  hostToWebviewMessageSchema,
  tasksHostMessageSchema,
  presentationMessageSchema,
])
const envelope = {
  mhp: z.literal(MHP_PANEL.wireVersion),
  kind: z.literal('panel'),
  surface: opaqueId,
  seq: integerSchema.check(z.gte(1)),
}
export const panelEnvelopeSchema = z.discriminatedUnion('direction', [
  z.strictObject({
    ...envelope,
    direction: z.literal('toHost'),
    payload: panelToHostPayloadSchema,
  }),
  z.strictObject({
    ...envelope,
    direction: z.literal('toPanel'),
    payload: panelToPanelPayloadSchema,
  }),
])
export type MhpPanelEnvelope = z.infer<typeof panelEnvelopeSchema>

// What's New is rendered HTML and has no state-request/host-message
// vocabulary. null requests a fresh render; other surfaces replay an existing
// shared request after their listener is ready.
// Found by type, never by position: the protocol union's order is not a contract.
function webviewRequestSchema(type: string) {
  return (
    webviewToHostMessageSchema.def.options.find(
      (schema) => schema.shape.type.safeParse(type).success,
    ) ?? z.never()
  )
}
export const panelStateRequestSchema = z.union([
  webviewRequestSchema('ready'),
  tasksWebviewMessageSchema.def.options[0],
  webviewRequestSchema('readUsage'),
  presentationRequestSchema.def.options[0],
  z.null(),
])
const lifecycle = {
  mhp: z.literal(MHP_PANEL.wireVersion),
  kind: z.literal('surface'),
  ...panelBindingSchema.shape,
}
export const panelLifecycleSchema = z.discriminatedUnion('event', [
  z.strictObject({ ...lifecycle, event: z.literal('opened') }),
  z.strictObject({ ...lifecycle, event: z.literal('ready') }),
  z.strictObject({
    ...lifecycle,
    event: z.literal('reloaded'),
    stateRequest: panelStateRequestSchema,
  }),
  z.strictObject({ ...lifecycle, event: z.literal('hidden') }),
  z.strictObject({
    ...lifecycle,
    event: z.literal('closed'),
    droppedMessages: integerSchema,
  }),
])

export const panelErrorSchema = z.strictObject({
  mhp: z.literal(MHP_PANEL.wireVersion),
  kind: z.literal('panelError'),
  surface: z.nullable(opaqueId),
  seq: z.nullable(integerSchema),
  code: z.enum([
    'MHP_PANEL_INVALID_ENVELOPE',
    'MHP_PANEL_INVALID_PAYLOAD',
    'MHP_PANEL_UNKNOWN_SURFACE',
    'MHP_PANEL_OUT_OF_ORDER',
    'MHP_PANEL_TOO_LARGE',
    'MHP_PANEL_NOT_READY',
    'MHP_PANEL_WRONG_DIRECTION',
    'MHP_PANEL_BACKPRESSURE',
    'MHP_PANEL_BINDING_MISMATCH',
    'MHP_PANEL_INVALID_LIFECYCLE',
  ]),
})
export { MhpPanelError } from './panelError'

/** SSE id of a panel envelope: surface, direction and sequence. */
export function panelEventId(message: unknown): string | undefined {
  const panel = panelEnvelopeSchema.safeParse(message)
  return panel.success
    ? `${encodeURIComponent(panel.data.surface)}:${panel.data.direction}:${String(panel.data.seq)}`
    : undefined
}

// Pure admission guard: callers supply registry/sequence state and advance it
// only after acceptance. Rejected messages never reach a listener or queue.
export function parseMhpPanelEnvelope(
  value: unknown,
  context: {
    binding: MhpPanelBinding | undefined
    expectedSeq: number
    direction: MhpPanelEnvelope['direction']
    ready: boolean
  },
): MhpPanelEnvelope {
  const header = z
    .strictObject({ ...envelope, direction: z.enum(['toHost', 'toPanel']), payload: z.unknown() })
    .safeParse(value)
  const refuse = (code: z.infer<typeof panelErrorSchema>['code']): never => {
    throw new MhpPanelError({
      mhp: MHP_PANEL.wireVersion,
      kind: 'panelError',
      surface: header.success ? header.data.surface : null,
      seq: header.success ? header.data.seq : null,
      code,
    })
  }
  if (!header.success) return refuse('MHP_PANEL_INVALID_ENVELOPE')
  let bytes: number
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch (error) {
    // JSON.stringify answers a BigInt or a cycle with a TypeError: an
    // unserializable envelope. Anything else keeps its kind.
    if (error instanceof TypeError) return refuse('MHP_PANEL_INVALID_PAYLOAD')
    throw error
  }
  if (bytes > MHP_PANEL.maximumEnvelopeBytes) return refuse('MHP_PANEL_TOO_LARGE')
  if (context.binding?.surface !== header.data.surface) return refuse('MHP_PANEL_UNKNOWN_SURFACE')
  if (header.data.direction !== context.direction) return refuse('MHP_PANEL_WRONG_DIRECTION')
  if (header.data.seq !== context.expectedSeq) return refuse('MHP_PANEL_OUT_OF_ORDER')
  if (!context.ready) return refuse('MHP_PANEL_NOT_READY')
  const parsed = panelEnvelopeSchema.safeParse(value)
  if (!parsed.success) return refuse('MHP_PANEL_INVALID_PAYLOAD')
  const { surfaceKind } = context.binding
  let payloadSchema: z.ZodMiniType
  switch (surfaceKind) {
    case 'tasks': {
      payloadSchema =
        parsed.data.direction === 'toHost' ? tasksWebviewMessageSchema : tasksHostMessageSchema
      break
    }
    case 'plans':
    case 'manager':
    case 'roles':
    case 'traffic':
    case 'diff':
    case 'walkthrough': {
      payloadSchema =
        parsed.data.direction === 'toHost' ? presentationRequestSchema : presentationMessageSchema
      break
    }
    case 'whatsNew': {
      payloadSchema = parsed.data.direction === 'toHost' ? whatsNewMessageSchema : z.never()
      break
    }
    default: {
      payloadSchema =
        parsed.data.direction === 'toHost' ? webviewToHostMessageSchema : hostToWebviewMessageSchema
    }
  }
  return payloadSchema.safeParse(parsed.data.payload).success
    ? parsed.data
    : refuse('MHP_PANEL_INVALID_PAYLOAD')
}

export function parseMhpSurfaceNotification(value: unknown, binding: MhpPanelBinding | undefined) {
  const frame = panelLifecycleSchema.parse(value)
  const refuse = (code: z.infer<typeof panelErrorSchema>['code']): never => {
    throw new MhpPanelError({
      mhp: MHP_PANEL.wireVersion,
      kind: 'panelError',
      surface: frame.surface,
      seq: null,
      code,
    })
  }
  if (frame.event === 'opened') {
    if (binding !== undefined) return refuse('MHP_PANEL_INVALID_LIFECYCLE')
  } else {
    if (binding === undefined) return refuse('MHP_PANEL_UNKNOWN_SURFACE')
    if (
      binding.surface !== frame.surface ||
      binding.sessionId !== frame.sessionId ||
      binding.surfaceKind !== frame.surfaceKind
    )
      return refuse('MHP_PANEL_BINDING_MISMATCH')
  }
  if (frame.event === 'reloaded') {
    const requestSchemas: Partial<Record<MhpPanelBinding['surfaceKind'], z.ZodMiniType>> = {
      tasks: tasksWebviewMessageSchema.def.options[0],
      plans: presentationRequestSchema.def.options[0],
      manager: presentationRequestSchema.def.options[0],
      roles: presentationRequestSchema.def.options[0],
      traffic: presentationRequestSchema.def.options[0],
      diff: presentationRequestSchema.def.options[0],
      walkthrough: presentationRequestSchema.def.options[0],
      whatsNew: z.null(),
      usage: webviewRequestSchema('readUsage'),
    }
    const requestSchema = requestSchemas[frame.surfaceKind] ?? webviewRequestSchema('ready')
    if (!requestSchema.safeParse(frame.stateRequest).success)
      return refuse('MHP_PANEL_INVALID_LIFECYCLE')
  }
  return frame
}

// The editor initiates initialize; the runtime answers with the sole reviewed version.
export const panelInitializeResultSchema = z.strictObject({
  jsonrpc: z.literal(MHP.jsonRpcVersion),
  id: z.union([opaqueId, integerSchema]),
  result: z.strictObject({
    protocolVersion: z.literal(MHP.version),
    capabilities: offeredCapabilitiesSchema,
  }),
})

export const embeddedBridgeStateSchema = jsonValueSchema
// Post-admission queue totals, validated before enqueueing any frame. This is
// an admission contract, not a queue or stream implementation.
export const panelQueueBudgetSchema = z.strictObject({
  bytes: integerSchema.check(z.lte(MHP_PANEL.maximumQueuedBytes)),
  messages: integerSchema.check(z.lte(MHP_PANEL.maximumQueuedMessages)),
})
export interface MuseEmbeddedHost {
  /** Validate and enqueue; throw on a local refusal, with remote errors as panelError frames. */
  postMessage(payload: z.infer<typeof panelToHostPayloadSchema>): void
  /** Subscribe before ready. The returned function removes only this listener. */
  onMessage(listener: (payload: z.infer<typeof panelToPanelPayloadSchema>) => void): () => void
  getState(): z.infer<typeof embeddedBridgeStateSchema> | undefined
  setState(state: z.infer<typeof embeddedBridgeStateSchema>): void
}
