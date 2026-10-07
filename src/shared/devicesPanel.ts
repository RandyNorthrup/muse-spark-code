// M100 Devices region of the Models & Agents panel.
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from './constants'
import {
  DEVICE_FAILURES,
  deviceCapsSchema,
  deviceEndpointSchema,
  deviceInvitationSchema,
  deviceOfferSchema,
  devicePairingConfirmationSchema,
} from './devices'

const devicePanelId = z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/))
const label = z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.labelChars))
export const DEVICE_STATUSES = [
  'local',
  'connected',
  'paused',
  'offline',
  'uncertain',
  'incompatible',
  'blocked-or-unreachable',
] as const

export const devicesPanelStateSchema = z.discriminatedUnion('enabled', [
  // Off has no rows/discovery switch. U must hide the section, not probe it.
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    discoveryEnabled: z.boolean(),
    devices: z
      .array(
        z.strictObject({
          deviceId: devicePanelId,
          pairId: devicePanelId,
          label,
          fingerprint: z.string().check(z.regex(/^[a-f0-9]{64}$(?![\s\S])/)),
          endpoint: deviceEndpointSchema,
          status: z.enum(DEVICE_STATUSES),
          lastObservedAt: z.optional(
            z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.observationMaxMs)),
          ),
          waitingApprovals: z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.unresolvedAttempts)),
          unresolvedAttempts: z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.unresolvedAttempts)),
          retainedLiabilityUsd: z
            .number()
            .check(z.gte(0), z.lte(DEVICE_LIMITS.spendUsd * DEVICE_LIMITS.unresolvedAttempts)),
          offers: z.array(deviceOfferSchema).check(z.maxLength(DEVICE_LIMITS.repositories)),
        }),
      )
      .check(z.maxLength(DEVICE_LIMITS.pairedDevices)),
  }),
])
export type DevicesPanelState = z.infer<typeof devicesPanelStateSchema>

// These are local UI requests, never transport RPCs or permissions. The host
// picks a trusted repository via its own picker; no path arrives from the UI.
const action = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pair') }),
  z.strictObject({
    kind: z.literal('importInvitation'),
    text: z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.invitationTextChars)),
  }),
  z.strictObject({
    kind: z.literal('confirmFingerprint'),
    invitationId: devicePanelId,
    fingerprint: z.string().check(z.regex(/^[a-f0-9]{64}$(?![\s\S])/)),
  }),
  z.strictObject({
    kind: z.literal('importConfirmation'),
    confirmation: devicePairingConfirmationSchema,
  }),
  z.strictObject({
    kind: z.literal('setAddress'),
    pairId: devicePanelId,
    endpoint: deviceEndpointSchema,
  }),
  z.strictObject({ kind: z.literal('setDiscovery'), enabled: z.boolean() }),
  z.strictObject({
    kind: z.literal('offer'),
    pairId: devicePanelId,
    lanes: z.boolean(),
    checks: z.boolean(),
    caps: deviceCapsSchema,
  }),
  z.strictObject({ kind: z.literal('pauseOffers'), pairId: devicePanelId }),
  z.strictObject({ kind: z.literal('unlink'), pairId: devicePanelId }),
  z.strictObject({ kind: z.literal('resumeQueue'), pairId: devicePanelId, boardId: devicePanelId }),
])
export const deviceWebviewRequestSchema = z.strictObject({
  type: z.literal('deviceRequest'),
  viewId: devicePanelId,
  requestId: devicePanelId,
  revision: z.int().check(z.gte(0)),
  action,
})
export type DeviceWebviewRequest = z.infer<typeof deviceWebviewRequestSchema>
export const deviceHostMessageSchema = z.strictObject({
  type: z.literal('deviceState'),
  // P/I increments this local document's counter for every complete snapshot,
  // including off states and action replies. Wall clocks do not order it.
  revision: z.int().check(z.gte(0)),
  state: devicesPanelStateSchema,
  setup: z.optional(
    z.strictObject({
      viewId: devicePanelId,
      requestId: devicePanelId,
      invitation: z.optional(deviceInvitationSchema),
      confirmation: z.optional(devicePairingConfirmationSchema),
      // Local facts, never copied into offers/discovery/logs. U renders as text.
      listenerApplication: z.optional(label),
      interfaceLabel: z.optional(label),
      failure: z.optional(z.enum(DEVICE_FAILURES)),
    }),
  ),
})
export type DeviceHostMessage = z.infer<typeof deviceHostMessageSchema>

type DeviceParseResult<T> =
  | { readonly ok: true; readonly message: T }
  | { readonly ok: false; readonly error: 'invalid-device-message' }

function parseDevice<T>(schema: z.ZodMiniType<T>, input: unknown): DeviceParseResult<T> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: 'invalid-device-message' }
}

// Fixed failure words avoid reflecting peer text into a local log or report.
export function parseDeviceWebviewRequest(input: unknown): DeviceParseResult<DeviceWebviewRequest> {
  return parseDevice(deviceWebviewRequestSchema, input)
}

export function parseDeviceHostMessage(input: unknown): DeviceParseResult<DeviceHostMessage> {
  return parseDevice(deviceHostMessageSchema, input)
}

// A malformed reply can reject its local wait, never supply state or setup.
// Deliberately parse only the correlation envelope before discarding it.
const replyCorrelation = z.object({
  type: z.literal('deviceState'),
  setup: z.object({ viewId: devicePanelId, requestId: devicePanelId }),
})
export function parseDeviceReplyCorrelation(
  input: unknown,
): Pick<DeviceWebviewRequest, 'viewId' | 'requestId'> | undefined {
  const result = replyCorrelation.safeParse(input)
  return result.success ? result.data.setup : undefined
}

export type DeviceActionResult =
  | { readonly ok: true; readonly message: DeviceHostMessage }
  | { readonly ok: false; readonly reason: 'stale' | 'failed' | 'aborted' | 'busy' }

export interface DeviceViewSource {
  readonly viewId: string
  readonly signal: AbortSignal
}

// U/I binds this to a lazy handler only after explicit setup/enabled offers.
// It must revalidate requests; this interface never supplies an implementation.
export interface DevicesPanelPort {
  request(message: DeviceWebviewRequest, signal?: AbortSignal): Promise<DeviceHostMessage>
}
