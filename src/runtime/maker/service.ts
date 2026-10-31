import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import * as z from 'zod/mini'
import {
  FileMachineStorage,
  MachineRegistry,
  MachineError,
  machineSecretName,
  type MachineRecord,
  type MakerLanPolicy,
} from '../../core/maker/registry'
import { MachineHttp } from '../../core/maker/machines/http'
import { createMoonrakerMachine } from '../../core/maker/machines/moonraker'
import { createOctoprintMachine } from '../../core/maker/machines/octoprint'
import {
  createPrusalinkMachine,
  type PrusaLinkTransport,
} from '../../core/maker/machines/prusalink'
import type { MakerSecrets } from '../../core/maker/ports'
import type { Machine, MachineDeps, MachineSendResult } from '../../core/maker/machines/machine'
import { DeviceLog } from '../../core/maker/deviceLog'
import { claimHardwareLease } from '../../core/maker/lease'
import {
  RUNTIME_MAKER_APPROVAL_MS,
  RUNTIME_MAKER_LOG_BYTES,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_MAX_LINES,
  RUNTIME_MAKER_MM_PER_INCH,
  RUNTIME_MAKER_MODEL_TEXT,
  RUNTIME_MAKER_TIMEOUT_MS,
  SECRET_KEYS,
  UI_TEXT,
  ADDRESS_FAMILIES,
} from '../../shared/constants'
import {
  makerHostMessageSchema,
  makerSurfaceMessageSchema,
  type MakerSurfaceMessage,
} from '../../shared/makerProtocol'
import { fill } from '../../shared/l10n/text'
import type { McpTool } from '../../core/mcp'
import { RuntimeMakerHost, type RuntimeMakerHostDeps } from './runtimeMakerHost'
import { createUserPresence } from './userPresence'
import { nativeSerial, type NativeSerialDeps } from './nativeSerial'
import { stopRuntimeMachines, stopResultText } from './stop'

const toolArgs = z.strictObject({
  machineId: z.string().check(z.minLength(1)),
  payload: z.optional(z.string()),
})
// Admit only RFC1918 and IPv6 ULA literals; everything else remains refused.
const privateV4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/
const privateV6 = /^f[cd][\da-f]{2}:/i
export const runtimeMakerLan: MakerLanPolicy = {
  classify: (address) =>
    (isIP(address) === ADDRESS_FAMILIES.ipv4 && privateV4.test(address)) ||
    (isIP(address) === ADDRESS_FAMILIES.ipv6 && privateV6.test(address))
      ? 'private'
      : 'reserved',
  resolve: async (host) => {
    const entries = await lookup(host, { all: true })
    return entries.map((entry) => entry.address)
  },
}
export interface RuntimeMakerServiceDeps extends Omit<RuntimeMakerHostDeps, 'auditEnable'> {
  readonly stopOnlyFallback?: boolean
  readonly native: Pick<NativeSerialDeps, 'platform' | 'env' | 'packageRoot' | 'classify'>
  readonly lan?: MakerLanPolicy
  /** A host-owned, already approved and leased serial machine connection, supplied by P/W. */
  readonly serialMachine?: (record: MachineRecord, deps: MachineDeps) => Promise<Machine>
  readonly prusalinkTransport?: (record: MachineRecord, secrets: MakerSecrets) => PrusaLinkTransport
}
function isHostUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && typeof error.code === 'string') ||
      error.message.startsWith('lease-') ||
      error.message.startsWith('maker-'))
  )
}

export async function createRuntimeMakerService(deps: RuntimeMakerServiceDeps) {
  const logging: { value?: DeviceLog } = {}
  const hostDeps: RuntimeMakerHostDeps = {
    ...deps,
    presence: deps.presence ?? createUserPresence(deps.native.platform),
    auditEnable: async (reason) => {
      await deviceLog().append({
        machine: 'workspace',
        action: 'observe',
        payload: reason,
        approval: null,
        outcome: 'sent',
      })
    },
  }
  let host: RuntimeMakerHost
  try {
    host = await RuntimeMakerHost.create(hostDeps)
  } catch (error) {
    if (!isHostUnavailable(error)) throw error
    if (deps.stopOnlyFallback !== true) throw error
    host = RuntimeMakerHost.stopOnly(hostDeps)
  }
  const registry = new MachineRegistry(
    new FileMachineStorage(host.storage.machine.directory),
    host.secrets,
    deps.lan ?? runtimeMakerLan,
  )
  function deviceLog(): DeviceLog {
    logging.value ??= new DeviceLog(host.storage.workspace.directory, deps.workspace, {
      maxBytes: RUNTIME_MAKER_LOG_BYTES,
      maxEntryBytes: RUNTIME_MAKER_MAX_BYTES,
      now: Date.now,
      secretValues: async () => {
        const records = await registry.list()
        const values = await Promise.all([
          host.secrets.get(SECRET_KEYS.modelApiKey),
          ...records.map((record) => host.secrets.get(machineSecretName(record.registrationId))),
        ])
        return values.filter((value) => value !== undefined)
      },
    })
    return logging.value
  }
  const serial = nativeSerial({
    ...deps.native,
    dataDirectory: host.storage.machine.directory,
    workspace: deps.workspace,
    host,
    refreshAdmission: () => host.refresh(),
    audit: ({ request, outcome }) =>
      deviceLog().append({
        machine: request.target.port,
        action: request.action,
        payload:
          request.payload.encoding === 'hex'
            ? Buffer.from(request.payload.value, 'hex')
            : request.payload.value,
        approval: request.id,
        outcome: outcome === 'rejected' || outcome === 'changed' ? 'refused' : outcome,
      }),
  })
  const machines = new Map<string, Machine>()
  const leased = new Set<string>()
  const dispatched = new Set<string>()
  async function machine(id: string): Promise<Machine> {
    const record = await registry.get(id)
    const previous = machines.get(record.registrationId)
    if (previous !== undefined) return previous
    const engineDeps: MachineDeps = {
      host,
      log: deviceLog(),
      isLeaseHeld: () => leased.has(record.registrationId),
      policy: {
        gcode: {
          maxBytes: RUNTIME_MAKER_MAX_BYTES,
          maxLines: RUNTIME_MAKER_MAX_LINES,
          mmPerInch: RUNTIME_MAKER_MM_PER_INCH,
        },
        approvalTtlMs: RUNTIME_MAKER_APPROVAL_MS,
        stopDeadlineMs: RUNTIME_MAKER_TIMEOUT_MS,
        requestDeadlineMs: RUNTIME_MAKER_TIMEOUT_MS,
        maxStateChanges: 2,
        now: Date.now,
      },
    }
    const secrets = {
      ...host.secrets,
      get: async (name: string) => {
        const current = await registry.get(id)
        if (current.registrationId !== record.registrationId)
          throw new MachineError('machineTargetChanged')
        return await host.secrets.get(name)
      },
    }
    const http = new MachineHttp(record, deps.lan ?? runtimeMakerLan, secrets, {
      timeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
      maxResponseBytes: RUNTIME_MAKER_MAX_BYTES,
      onGuardedDispatch: () => {
        dispatched.add(record.registrationId)
      },
      beforeGuardedDispatch: async () => {
        await host.refresh()
        const current = await registry.get(id)
        if (current.registrationId !== record.registrationId)
          throw new MachineError('machineTargetChanged')
      },
    })
    let engine: Machine
    switch (record.kind) {
      case 'moonraker': {
        engine = createMoonrakerMachine(record, http, engineDeps)
        break
      }
      case 'octoprint': {
        engine = createOctoprintMachine(record, http, engineDeps)
        break
      }
      case 'prusalink': {
        if (deps.prusalinkTransport === undefined)
          throw new MachineError('prusalink-transport-required')
        engine = createPrusalinkMachine(
          record,
          deps.prusalinkTransport(record, secrets),
          engineDeps,
        )
        break
      }
      default: {
        if (deps.serialMachine === undefined) throw new MachineError('serial-session-required')
        engine = await deps.serialMachine(record, engineDeps)
      }
    }
    machines.set(record.registrationId, engine)
    return engine
  }
  async function stop(id?: string) {
    host.cancelApprovals()
    serial.stop()
    return await stopRuntimeMachines(
      {
        dataDirectory: deps.dataDirectory,
        platform: deps.native.platform,
        secrets: deps.secrets,
        lan: deps.lan ?? runtimeMakerLan,
      },
      id,
    )
  }
  /** The surface and the model tool report Stop the same way. */
  async function stopped(id?: string) {
    const result = await stop(id)
    return {
      outcome: result.physicalStopRequired.length === 0 ? 'stopped' : 'physicalStopRequired',
      message: stopResultText(result),
    }
  }
  async function send(
    id: string,
    payload: string,
    signal: AbortSignal,
  ): Promise<Pick<MachineSendResult, 'outcome' | 'logRecorded'>> {
    await host.refresh()
    signal.throwIfAborted()
    const engine = await machine(id)
    const generation = engine.record.registrationId
    const claim = await claimHardwareLease(
      serial.lease,
      `machine:${generation}`,
      'Muse Spark runtime',
      async () => {
        await engine.stop()
      },
    )
    if (claim.status !== 'acquired') throw new MachineError('machineBusy')
    dispatched.delete(generation)
    leased.add(generation)
    const cancel = () => {
      host.cancelApprovals()
      // Revoke the final write guard. Cancelling an unsent permission is not a machine Stop.
      leased.delete(generation)
      if (dispatched.has(generation))
        void (async () => {
          const [attempt] = await Promise.allSettled([engine.stop()])
          if (attempt.status === 'rejected') {
            host.notify({
              type: 'makerNotice',
              level: 'error',
              message: fill(UI_TEXT.makerStopFailed, { machine: engine.record.name }),
            })
          }
        })()
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      const result = await engine.send(payload)
      return { outcome: result.outcome, logRecorded: result.logRecorded }
    } finally {
      signal.removeEventListener('abort', cancel)
      leased.delete(generation)
      dispatched.delete(generation)
      await claim.release()
    }
  }
  async function state(): Promise<unknown> {
    await host.refresh()
    const registered = await registry.list()
    const summaries = registered
      .filter((record) => record.credentialPendingRemoval !== true)
      .map(({ registrationId, id, name, kind, category, endpoint, limits }) => ({
        registrationId,
        id,
        name,
        kind,
        category,
        endpoint,
        limits,
      }))
    const discovered = host.hardwareEnabled() ? await serial.ports() : []
    const ports = discovered.map((identity) => ({ ...identity, kind: 'serial' as const }))
    host.updatePorts(ports)
    host.stopControls(summaries)
    return makerHostMessageSchema.parse({
      v: 1,
      type: 'makerState',
      isTrusted: host.isTrusted(),
      hardwareEnabled: host.hardwareEnabled(),
      isInteractive: host.isInteractive(),
      machines: summaries,
      ports,
    })
  }
  async function dispatch(raw: MakerSurfaceMessage, signal: AbortSignal): Promise<unknown> {
    const message = makerSurfaceMessageSchema.parse(raw)
    if (message.type === 'makerStop') return await stopped(message.machineId)
    if (message.type === 'makerAnswer') return false
    if (message.type === 'makerHardware') {
      await host.setHardware(message.enabled, message.reason)
      return await state()
    }
    if (message.type === 'makerReady') {
      host.newDocument()
      return await state()
    }
    // MakerApproval itself checks admission, id, digest and completeness.
    if (message.type === 'makerPayloadReviewed') return host.review(message)
    await host.refresh()
    if (!host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
    if (!host.hardwareEnabled()) throw new Error(UI_TEXT.makerHardwareDisabled)
    switch (message.type) {
      case 'makerStatus': {
        const target = await machine(message.machineId)
        return makerHostMessageSchema.parse({
          v: 1,
          type: 'makerStatus',
          machineId: message.machineId,
          status: await target.status(),
        })
      }
      case 'makerSend': {
        const result = await send(message.machineId, message.payload, signal)
        const text = {
          sent: UI_TEXT.execStatus.completed,
          sentWithUnrecordedAudit: UI_TEXT.makerAuditUnrecorded,
          sentOutcomeUnknown: UI_TEXT.makerSentOutcomeUnknown,
        }[result.outcome]
        return makerHostMessageSchema.parse({
          v: 1,
          type: 'makerResult',
          id: message.id,
          outcome: result.outcome,
          message: text,
        })
      }
      case 'makerSerial': {
        const { kind: _kind, ...identity } = message.target
        const { operation, baud, durationMs, dtr, rts, payloadHex } = message
        const result = await serial.execute(
          { operation, baud, durationMs, dtr, rts, payloadHex, identity },
          signal,
        )
        let outcome: 'refused' | 'stopped' | 'failed' | 'sent' = 'refused'
        let text = UI_TEXT.toolRejected
        if (result.status === 'complete') {
          switch (result.capture.reason) {
            case 'stopped': {
              outcome = 'stopped'
              text = UI_TEXT.toolStopped
              break
            }
            case 'failed': {
              outcome = 'failed'
              text = UI_TEXT.toolFailed
              break
            }
            default: {
              outcome = 'sent'
              text = UI_TEXT.execStatus.completed
            }
          }
        }
        return makerHostMessageSchema.parse({
          v: 1,
          type: 'makerResult',
          id: message.id,
          outcome,
          message: text,
        })
      }
      case 'makerAddMachine': {
        await host.requirePresence(UI_TEXT.makerAddMachine, message, message.machine.name)
        if (!host.isInteractive() || !host.isTrusted())
          throw new Error(UI_TEXT.makerUnattendedDenied)
        await registry.register({ ...message.machine, allowPlainHttp: message.allowPlainHttp })
        return await state()
      }
      case 'makerRemoveMachine': {
        const current = await registry.get(message.machineId)
        if (current.registrationId !== message.registrationId)
          throw new MachineError('machineTargetChanged')
        await registry.remove(message.machineId)
        return await state()
      }
      case 'makerOpenLog': {
        return makerHostMessageSchema.parse({
          v: 1,
          type: 'makerDeviceLog',
          entries: await deviceLog().read(),
        })
      }
      default: {
        throw new Error('maker-surface-operation-unavailable')
      }
    }
  }
  function tools(): McpTool[] {
    const canAct = host.hardwareEnabled() && host.isTrusted() && host.isInteractive()
    const schema = {
      type: 'object',
      properties: { machineId: { type: 'string' }, payload: { type: 'string' } },
      required: ['machineId'],
      additionalProperties: false,
    }
    const offered: McpTool[] = [
      {
        name: 'machine_status',
        description: RUNTIME_MAKER_MODEL_TEXT.runtimeMakerStatus,
        inputSchema: schema,
        call: async (raw) => {
          const args = toolArgs.parse(raw)
          await host.refresh()
          const target = await machine(args.machineId)
          return JSON.stringify(await target.status())
        },
      },
      {
        name: 'machine_send',
        description: RUNTIME_MAKER_MODEL_TEXT.runtimeMakerSend,
        inputSchema: { ...schema, required: ['machineId', 'payload'] },
        call: async (raw, signal) => {
          signal.throwIfAborted()
          const args = toolArgs.parse(raw)
          if (args.payload === undefined) throw new Error('maker-payload-required')
          return JSON.stringify(await send(args.machineId, args.payload, signal))
        },
      },
      {
        name: 'machine_stop',
        description: RUNTIME_MAKER_MODEL_TEXT.runtimeMakerStop,
        inputSchema: schema,
        call: async (raw) => {
          return JSON.stringify(await stopped(toolArgs.parse(raw).machineId))
        },
      },
      {
        name: 'device_list',
        description: RUNTIME_MAKER_MODEL_TEXT.runtimeMakerPorts,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        call: async (raw) => {
          z.strictObject({}).parse(raw)
          await host.refresh()
          if (!host.hardwareEnabled() || !host.isTrusted())
            throw new Error(UI_TEXT.makerHardwareDisabled)
          return JSON.stringify(await serial.ports())
        },
      },
      {
        name: 'device_serial',
        description: RUNTIME_MAKER_MODEL_TEXT.runtimeMakerSerial,
        inputSchema: {
          type: 'object',
          properties: {
            operation: { enum: ['read', 'write'] },
            identity: { type: 'object' },
            baud: { type: 'integer' },
            durationMs: { type: 'integer' },
            dtr: { type: 'boolean' },
            rts: { type: 'boolean' },
            payloadHex: { type: 'string' },
          },
          required: ['operation', 'identity', 'baud', 'durationMs', 'dtr', 'rts', 'payloadHex'],
          additionalProperties: false,
        },
        call: async (raw, signal) => {
          await host.refresh()
          return JSON.stringify(await serial.execute(raw, signal))
        },
      },
    ]
    return canAct ? offered : offered.filter((tool) => tool.name === 'machine_stop')
  }
  return {
    host,
    registry,
    state,
    dispatch,
    tools,
    stop,
    serial,
    async close(): Promise<void> {
      host.cancelApprovals()
      await serial.close()
      await host.serialProvider?.release()
    },
  }
}
