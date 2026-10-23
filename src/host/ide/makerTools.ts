import { randomUUID } from 'node:crypto'
import type { McpTool } from '../../core/mcp'
import type { MakerHost } from '../../core/maker/ports'
import {
  MAKER_HOST_MODEL_TEXT,
  MAKER_PROTOCOL_VERSION,
  MCP_ANNOTATIONS_READ_ONLY,
} from '../../shared/constants'
import {
  makerHostMessageSchema,
  makerSurfaceMessageSchema,
  type MakerSurfaceMessage,
} from '../../shared/makerProtocol'

type Action = Extract<MakerSurfaceMessage, { type: 'makerSerial' | 'makerStatus' | 'makerSend' }>
export interface IdeMakerToolsDeps {
  readonly host: Pick<MakerHost, 'isTrusted' | 'hardwareEnabled' | 'isInteractive' | 'notify'>
  /** Selected model's tool-calling capability, not a provider name. */
  readonly canUseTools: () => boolean
  readonly hasMachines: () => boolean
  /** W binds only to protected engine methods. No raw transport is exposed. */
  readonly action: (message: Action, signal: AbortSignal) => Promise<unknown>
  readonly listDevices: (signal: AbortSignal) => Promise<unknown>
  /** Bind to host.stop: cancel native approval before the engine's fixed Stop. */
  readonly stop: (machineId: string | undefined) => Promise<void>
}

function isOn(deps: IdeMakerToolsDeps): boolean {
  return deps.host.isTrusted() && deps.host.hardwareEnabled() && deps.canUseTools()
}

const machineId = { type: 'string', minLength: 1 }
const serialProperties = {
  target: {
    type: 'object',
    properties: {
      kind: { const: 'serial' },
      port: { type: 'string' },
      vid: { type: 'string' },
      pid: { type: 'string' },
      serialNumber: { type: 'string' },
      stablePath: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['kind', 'port'],
    additionalProperties: false,
  },
  baud: { type: 'integer', minimum: 1 },
  durationMs: { type: 'integer', minimum: 1 },
  dtr: { type: 'boolean' },
  rts: { type: 'boolean' },
}
function schema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  return { type: 'object', properties, required, additionalProperties: false }
}

function argumentsFor(
  args: Readonly<Record<string, unknown>>,
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (Object.keys(args).some((key) => !Object.hasOwn(properties, key)))
    throw new Error(MAKER_HOST_MODEL_TEXT.unavailable)
  return args
}

function answer(
  raw: unknown,
  expected: 'makerState' | 'makerStatus' | 'makerResult',
  deps: IdeMakerToolsDeps,
): string {
  const message = makerHostMessageSchema.parse(raw)
  if (message.type !== expected) throw new Error(MAKER_HOST_MODEL_TEXT.unavailable)
  if (message.type === 'makerResult') {
    // The informational UI never holds an already known tool outcome.
    if (message.outcome === 'sentOutcomeUnknown' || message.outcome === 'sentWithUnrecordedAudit') {
      void Promise.allSettled([
        (async () => {
          await deps.host.notify(
            message.outcome === 'sentOutcomeUnknown' ? 'sentOutcomeUnknown' : 'auditUnrecorded',
          )
        })(),
      ])
    } else if (message.outcome === 'failed' || message.outcome === 'refused') {
      throw new Error(message.message)
    }
  }
  return JSON.stringify(message)
}

/** Listed lazily with the maker host; credentials and UI answers have no tool. */
export function ideMakerTools(deps: IdeMakerToolsDeps): readonly McpTool[] {
  if (!deps.canUseTools()) return []
  const action = async (raw: unknown, signal: AbortSignal): Promise<string> => {
    const message = makerSurfaceMessageSchema.parse(raw)
    if (
      message.type !== 'makerSerial' &&
      message.type !== 'makerStatus' &&
      message.type !== 'makerSend'
    )
      throw new Error(MAKER_HOST_MODEL_TEXT.unavailable)
    if (!isOn(deps)) throw new Error(MAKER_HOST_MODEL_TEXT.hardwareDisabled)
    if (message.type !== 'makerStatus' && !deps.host.isInteractive())
      throw new Error(MAKER_HOST_MODEL_TEXT.unattendedDenied)
    signal.throwIfAborted()
    return answer(
      await deps.action(message, signal),
      message.type === 'makerStatus' ? 'makerStatus' : 'makerResult',
      deps,
    )
  }
  const tools: McpTool[] = []
  if (isOn(deps))
    tools.push(
      {
        name: 'device_list',
        description: MAKER_HOST_MODEL_TEXT.deviceList,
        inputSchema: schema({}, []),
        annotations: MCP_ANNOTATIONS_READ_ONLY,
        call: async (args, signal) => {
          makerSurfaceMessageSchema.parse({
            ...argumentsFor(args, {}),
            v: MAKER_PROTOCOL_VERSION,
            type: 'makerReady',
          })
          if (!isOn(deps)) throw new Error(MAKER_HOST_MODEL_TEXT.hardwareDisabled)
          signal.throwIfAborted()
          return answer(await deps.listDevices(signal), 'makerState', deps)
        },
      },
      {
        name: 'serial_read',
        description: MAKER_HOST_MODEL_TEXT.serialRead,
        inputSchema: schema(serialProperties, ['target', 'baud', 'durationMs', 'dtr', 'rts']),
        call: async (args, signal) =>
          await action(
            {
              ...argumentsFor(args, serialProperties),
              v: MAKER_PROTOCOL_VERSION,
              type: 'makerSerial',
              id: randomUUID(),
              operation: 'read',
              payloadHex: '',
            },
            signal,
          ),
      },
      {
        name: 'serial_write',
        description: MAKER_HOST_MODEL_TEXT.serialWrite,
        inputSchema: schema(
          { ...serialProperties, payloadHex: { type: 'string', pattern: '^(?:[a-f0-9]{2})*$' } },
          ['target', 'baud', 'durationMs', 'dtr', 'rts', 'payloadHex'],
        ),
        call: async (args, signal) =>
          await action(
            {
              ...argumentsFor(args, { ...serialProperties, payloadHex: true }),
              v: MAKER_PROTOCOL_VERSION,
              type: 'makerSerial',
              id: randomUUID(),
              operation: 'write',
            },
            signal,
          ),
      },
      {
        name: 'machine_status',
        description: MAKER_HOST_MODEL_TEXT.machineStatus,
        inputSchema: schema({ machineId }, ['machineId']),
        annotations: MCP_ANNOTATIONS_READ_ONLY,
        call: async (args, signal) =>
          await action(
            {
              ...argumentsFor(args, { machineId }),
              v: MAKER_PROTOCOL_VERSION,
              type: 'makerStatus',
            },
            signal,
          ),
      },
      {
        name: 'machine_send',
        description: MAKER_HOST_MODEL_TEXT.machineSend,
        inputSchema: schema({ machineId, payload: { type: 'string' } }, ['machineId', 'payload']),
        call: async (args, signal) =>
          await action(
            {
              ...argumentsFor(args, { machineId, payload: true }),
              v: MAKER_PROTOCOL_VERSION,
              type: 'makerSend',
              id: randomUUID(),
            },
            signal,
          ),
      },
    )
  if (isOn(deps) || deps.hasMachines())
    tools.push({
      name: 'machine_stop',
      description: MAKER_HOST_MODEL_TEXT.machineStop,
      inputSchema: schema({ machineId }, []),
      call: async (args) => {
        const message = makerSurfaceMessageSchema.parse({
          ...argumentsFor(args, { machineId }),
          v: MAKER_PROTOCOL_VERSION,
          type: 'makerStop',
        })
        if (message.type !== 'makerStop') throw new Error(MAKER_HOST_MODEL_TEXT.unavailable)
        await deps.stop(message.machineId)
        return JSON.stringify({
          v: MAKER_PROTOCOL_VERSION,
          type: 'makerResult',
          id: randomUUID(),
          outcome: 'stopped',
          message: MAKER_HOST_MODEL_TEXT.stopped,
        })
      },
    })
  return tools
}
