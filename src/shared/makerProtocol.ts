// M103 I: our own engine/surface contract, never an external device wire shape.
// Pure schemas: safe in the shared React UI and every Node host.
import * as z from 'zod/mini'
import {
  CHECK_COMMAND_MAX_CHARS,
  CHECK_NAME_MAX_CHARS,
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_FILES,
  MAKER_PRESETS_MAX,
  MAKER_PROJECT_KINDS,
  UNSAFE_ARGUMENT_START,
  MAKER_PROTOCOL_MAX_ID_CHARS,
  MAKER_PROTOCOL_MAX_ITEMS,
  MAKER_PROTOCOL_MAX_TEXT_CHARS,
  MAKER_PROTOCOL_VERSION,
} from './constants'
import { checkCommandSchema } from './checkCommandSchema'

const nonnegative = z.number().check(z.gte(0))
export const makerPointSchema = z.object({ x: z.number(), y: z.number(), z: z.number() })
export const makerLimitsSchema = z
  .strictObject({
    travel: z.optional(z.object({ min: makerPointSchema, max: makerPointSchema })),
    feedMmMin: z.optional(z.number().check(z.positive())),
    extruder: z.optional(nonnegative),
    bed: z.optional(nonnegative),
  })
  .check(
    z.refine(
      (limits) =>
        limits.travel === undefined ||
        (limits.travel.min.x <= limits.travel.max.x &&
          limits.travel.min.y <= limits.travel.max.y &&
          limits.travel.min.z <= limits.travel.max.z),
    ),
  )

const kindSchema = z.enum(MAKER_PROJECT_KINDS)
const labelSchema = z.string().check(z.minLength(1), z.maxLength(CHECK_NAME_MAX_CHARS))
const idSchema = z.string().check(z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS))
export const relativePathSchema = z.string().check(
  z.minLength(1),
  z.maxLength(CHECK_COMMAND_MAX_CHARS),
  z.refine(
    (name) =>
      !/^(?:\/|[a-z]:)/i.test(name) &&
      !name.includes('\\') &&
      !name.split('/').includes('..') &&
      !UNSAFE_ARGUMENT_START.test(name) &&
      !/\p{Cc}/u.test(name),
  ),
)

export const presetSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('command'),
    id: idSchema,
    kind: kindSchema,
    check: z.strictObject(checkCommandSchema.shape),
    cloud: z.boolean(),
  }),
  // The analyser is offline and a portable engine operation, not a guessed CLI command.
  z.strictObject({
    type: z.literal('gcode'),
    id: idSchema,
    kind: z.literal('gcode'),
    name: labelSchema,
    path: relativePathSchema,
  }),
])

/** The same detection event on every maker surface. */
export const presetsOfferedSchema = z.strictObject({
  type: z.literal('presetsOffered'),
  title: z.string().check(z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS)),
  kinds: z.array(kindSchema).check(z.maxLength(MAKER_PROJECT_KINDS.length)),
  skillIds: z
    .array(z.string().check(z.maxLength(CHECK_NAME_MAX_CHARS), z.regex(/^maker_[a-z0-9_]+$/)))
    .check(z.maxLength(MAKER_DETECT_MAX_FILES)),
  presets: z.array(presetSchema).check(z.maxLength(MAKER_PRESETS_MAX)),
  notices: z
    .array(z.string().check(z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS)))
    .check(z.maxLength(MAKER_PROJECT_KINDS.length)),
  isCircuitPyRoot: z.boolean(),
  hasMachineConfig: z.boolean(),
  pi: z.optional(
    z.strictObject({
      model: z.string().check(z.minLength(1), z.maxLength(MAKER_DETECT_MAX_BYTES)),
      temperatureCelsius: z.optional(z.number()),
      throttled: z.optional(z.int().check(z.gte(0))),
    }),
  ),
})
export type MakerPresetsOffered = z.infer<typeof presetsOfferedSchema>
export type MakerCheckPreset = MakerPresetsOffered['presets'][number]

const name = z.string().check(z.minLength(1), z.maxLength(MAKER_PROTOCOL_MAX_ID_CHARS))
const text = z.string().check(z.maxLength(MAKER_PROTOCOL_MAX_TEXT_CHARS))
const timestamp = z.int().check(z.gte(0))
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/))
const positive = z.int().check(z.positive())
const family = z.enum(['esp32', 'rp2040', 'rp2350', 'rp2', 'avr'])
const action = z.enum(['connect', 'program', 'actuate'])
const usbId = z.string().check(z.regex(/^[a-f0-9]{4}$/))
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T

export const makerSerialTargetSchema = z.strictObject({
  kind: z.literal('serial'),
  port: name,
  vid: z.optional(usbId),
  pid: z.optional(usbId),
  serialNumber: z.optional(name),
  description: z.optional(text),
  stablePath: z.optional(name),
})
export const makerMachineTargetSchema = z.strictObject({
  kind: z.literal('machine'),
  registrationId: z.uuid(),
  id: name,
  name,
  endpoint: name,
  identity: name,
})
export const makerTargetSchema = z.discriminatedUnion('kind', [
  makerSerialTargetSchema,
  makerMachineTargetSchema,
  z.strictObject({ kind: z.literal('workspace'), workspace: name }),
])
export type MakerTarget = Immutable<z.infer<typeof makerTargetSchema>>

const bounds = z.strictObject({
  min: z.strictObject(makerPointSchema.shape),
  max: z.strictObject(makerPointSchema.shape),
})
const analysis = z.strictObject({
  classes: z
    .array(z.enum(['offline', 'observe', 'actuate', 'refused']))
    .check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
  bounds: z.optional(bounds),
  maxFeedMmMin: z.number().check(z.gte(0)),
  temperatures: z.strictObject({ extruder: z.optional(z.number()), bed: z.optional(z.number()) }),
  unknown: z.array(name).check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
  refused: z.array(name).check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
  hasMotion: z.boolean(),
})
const approvalFields = { id: z.uuid(), digest, expiresAt: timestamp }
export const makerApprovalRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...approvalFields,
    kind: z.literal('serial'),
    target: makerSerialTargetSchema,
    action,
    payload: z.discriminatedUnion('encoding', [
      z.strictObject({ encoding: z.literal('text'), value: text }),
      z.strictObject({
        encoding: z.literal('hex'),
        value: z
          .string()
          .check(z.maxLength(MAKER_PROTOCOL_MAX_TEXT_CHARS), z.regex(/^(?:[a-f0-9]{2})*$/)),
      }),
    ]),
    baud: positive,
    durationMs: positive,
    dtr: z.boolean(),
    rts: z.boolean(),
    warnsAboutReset: z.literal(true),
    projectTarget: z.optional(
      z.strictObject({
        platformioBoard: z.optional(name),
        idfTarget: z.optional(name),
        fqbn: z.optional(name),
        family: z.optional(family),
      }),
    ),
    flashIdentity: z.strictObject({
      status: z.enum(['match', 'mismatch', 'unknown']),
      deviceFamily: z.optional(family),
      targetFamily: z.optional(family),
    }),
  }),
  z.strictObject({
    ...approvalFields,
    kind: z.literal('machine'),
    target: makerMachineTargetSchema,
    action: z.literal('actuate'),
    payload: text,
    analysis,
  }),
  z.strictObject({
    ...approvalFields,
    kind: z.literal('command'),
    target: makerTargetSchema,
    action,
    payload: text,
  }),
])
export type ApprovalRequest = Immutable<z.infer<typeof makerApprovalRequestSchema>>
export type SerialApprovalRequest = Extract<ApprovalRequest, { kind: 'serial' }>
export type MachineApprovalRequest = Extract<ApprovalRequest, { kind: 'machine' }>

// Echo the complete immutable target, including its registration generation.
// Neither standing choices nor tool-supplied confirm/token fields are accepted.
export const makerApprovalAnswerSchema = z.strictObject({
  id: z.uuid(),
  digest,
  target: makerTargetSchema,
  decision: z.enum(['allow_once', 'reject_once']),
})
export type ApprovalAnswer = z.infer<typeof makerApprovalAnswerSchema>

export const makerMachineSummarySchema = z.strictObject({
  registrationId: z.uuid(),
  id: name,
  name,
  kind: z.enum(['moonraker', 'octoprint', 'prusalink', 'grbl', 'fluidnc', 'marlin']),
  category: z.enum(['printer', 'cnc', 'laser', 'robot']),
  endpoint: name,
  limits: makerLimitsSchema,
})
export type MakerMachineSummary = z.infer<typeof makerMachineSummarySchema>
const machineRegistrationSchema = z.omit(makerMachineSummarySchema, { registrationId: true })

export const makerWarningSchema = z.enum([
  'physicalStopRequired',
  'startupMotion',
  'limitsUnavailable',
  'auditUnrecorded',
  'sentOutcomeUnknown',
])
export type MakerWarning = z.infer<typeof makerWarningSchema>
export const makerNoticeSchema = z.union([
  presetsOfferedSchema,
  makerWarningSchema,
  z.strictObject({
    type: z.literal('makerNotice'),
    level: z.enum(['info', 'warning', 'error']),
    message: text,
  }),
])
export type MakerNotice = z.infer<typeof makerNoticeSchema>

export const makerPreviewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('payload'), title: name, content: text }),
  // An opaque host-owned artifact id. No surface can ask the host to open an arbitrary path.
  z.strictObject({
    kind: z.literal('stl'),
    artifactId: z.uuid(),
    title: name,
    triangles: positive,
    bounds,
  }),
])
export type MakerPreview = z.infer<typeof makerPreviewSchema>

const envelope = { v: z.literal(MAKER_PROTOCOL_VERSION) }
export const makerHostMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('makerApproval'),
    request: makerApprovalRequestSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('makerApprovalClosed'), id: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('makerNotice'), notice: makerNoticeSchema }),
  z.strictObject({ ...envelope, type: z.literal('makerPresets'), event: presetsOfferedSchema }),
  z.strictObject({ ...envelope, type: z.literal('makerPreview'), preview: makerPreviewSchema }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerStatus'),
    machineId: name,
    status: z.strictObject({
      identity: name,
      state: name,
      isHomed: z.boolean(),
      limits: makerLimitsSchema,
      gcode: z.optional(
        z.strictObject({
          position: z.strictObject(makerPointSchema.shape),
          absolute: z.boolean(),
          unit: z.enum(['mm', 'inch']),
          feedMmMin: z.number(),
        }),
      ),
      blockedCommands: z.array(name).check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
      warnings: z.array(makerWarningSchema).check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerState'),
    isTrusted: z.boolean(),
    hardwareEnabled: z.boolean(),
    isInteractive: z.boolean(),
    machines: z.array(makerMachineSummarySchema).check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
    ports: z.array(makerSerialTargetSchema).check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerDeviceLog'),
    // Only user-requested, already scrubbed entries; never a model/export feed.
    entries: z
      .array(
        z.strictObject({
          time: timestamp,
          machine: name,
          action: z.enum(['observe', 'connect', 'program', 'actuate', 'stop']),
          payload: text,
          digest,
          approval: z.nullable(z.uuid()),
          outcome: z.enum([
            'attempt',
            'sent',
            'sentOutcomeUnknown',
            'refused',
            'failed',
            'stopped',
          ]),
        }),
      )
      .check(z.maxLength(MAKER_PROTOCOL_MAX_ITEMS)),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerResult'),
    id: z.uuid(),
    outcome: z.enum([
      'sent',
      'sentWithUnrecordedAudit',
      'sentOutcomeUnknown',
      'stopped',
      'refused',
      'failed',
    ]),
    message: text,
  }),
])
export type MakerHostMessage = Immutable<z.infer<typeof makerHostMessageSchema>>

export const makerSurfaceMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('makerReady') }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerAnswer'),
    answer: makerApprovalAnswerSchema,
  }),
  // Stop is its own message, without an approval or hardware-enabled condition.
  z.strictObject({ ...envelope, type: z.literal('makerStop'), machineId: z.optional(name) }),
  z
    .strictObject({
      ...envelope,
      type: z.literal('makerHardware'),
      enabled: z.boolean(),
      reason: z.optional(
        z.string().check(z.trim(), z.minLength(1), z.maxLength(MAKER_PROTOCOL_MAX_ID_CHARS)),
      ),
    })
    .check(z.refine((message) => !message.enabled || message.reason !== undefined)),
  z.strictObject({ ...envelope, type: z.literal('makerStatus'), machineId: name }),
  // These are action requests only. The engine independently classifies and asks its host.
  z.strictObject({
    ...envelope,
    type: z.literal('makerSend'),
    id: z.uuid(),
    machineId: name,
    payload: text,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerSerial'),
    id: z.uuid(),
    operation: z.enum(['read', 'write']),
    target: makerSerialTargetSchema,
    baud: positive,
    durationMs: positive,
    dtr: z.boolean(),
    rts: z.boolean(),
    payloadHex: z
      .string()
      .check(z.maxLength(MAKER_PROTOCOL_MAX_TEXT_CHARS), z.regex(/^(?:[a-f0-9]{2})*$/)),
  }),
  z.strictObject({ ...envelope, type: z.literal('makerOpenLog') }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerAddMachine'),
    machine: machineRegistrationSchema,
    allowPlainHttp: z.boolean(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('makerRemoveMachine'),
    registrationId: z.uuid(),
    machineId: name,
  }),
  z.strictObject({ ...envelope, type: z.literal('makerChoosePreset'), presetId: name }),
  z.strictObject({ ...envelope, type: z.literal('makerOpenPreview'), artifactId: z.uuid() }),
])
export type MakerSurfaceMessage = z.infer<typeof makerSurfaceMessageSchema>
