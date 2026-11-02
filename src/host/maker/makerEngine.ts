// The VS Code window's maker engine (RLF-M103WIRE): the hardware latch, the
// machine registry, the device log, serial sessions and machine operations
// behind MakerCommands and the `ide` maker tools. It mirrors the runtime
// service's guarantees (src/runtime/maker/service.ts) on this window's
// storage and secrets; the native host object stays the approval UI. No
// `vscode` import: the native pickers live in ../vscode/maker/makerDevicesUi.
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { errorNameForLog } from '../../core/logging'
import { DeviceLog, type DeviceLogEntry } from '../../core/maker/deviceLog'
import { claimHardwareLease } from '../../core/maker/lease'
import {
  FileMachineStorage,
  MachineError,
  MachineRegistry,
  machineSecretName,
  type MachineRecord,
  type MakerLanPolicy,
} from '../../core/maker/registry'
import { MachineHttp } from '../../core/maker/machines/http'
import type { Machine, MachineDeps, MachineSendResult } from '../../core/maker/machines/machine'
import { createMoonrakerMachine } from '../../core/maker/machines/moonraker'
import { createOctoprintMachine, requestOctoprintAppKey } from '../../core/maker/machines/octoprint'
import {
  createPrusalinkMachine,
  type PrusaLinkTransport,
} from '../../core/maker/machines/prusalink'
import type { MakerHost, MakerSecrets } from '../../core/maker/ports'
import type { SerialIdentity } from '../../core/maker/serial/identity'
import {
  MAKER_HOST_STATE_KEY,
  MAKER_PROTOCOL_VERSION,
  OCTOPRINT_APPKEYS_APP,
  OCTOPRINT_APPKEYS_POLL_MS,
  OCTOPRINT_APPKEYS_TIMEOUT_MS,
  RUNTIME_MAKER_APPROVAL_MS,
  RUNTIME_MAKER_LOG_BYTES,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_MAX_LINES,
  RUNTIME_MAKER_MM_PER_INCH,
  RUNTIME_MAKER_TIMEOUT_MS,
  SECRET_KEYS,
  UI_TEXT,
} from '../../shared/constants'
import {
  makerHostMessageSchema,
  type MakerMachineSummary,
  type MakerSurfaceMessage,
} from '../../shared/makerProtocol'
import { fill } from '../../shared/l10n/text'
import type { Logger } from '../logger'
import { nativeSerial } from '../../runtime/maker/nativeSerial'
import { runtimeMakerLan } from '../../runtime/maker/service'
import { stopResultText, stopRuntimeMachines } from '../../runtime/maker/stop'

export type MakerEngineRegistration = Extract<MakerSurfaceMessage, { type: 'makerAddMachine' }>
export type MakerEngineRemoval = Extract<MakerSurfaceMessage, { type: 'makerRemoveMachine' }>
export type MakerEngineAction = Extract<
  MakerSurfaceMessage,
  { type: 'makerSerial' | 'makerStatus' | 'makerSend' }
>

export interface MakerEngineDeps {
  readonly storage: MakerHost['storage']
  readonly secrets: MakerSecrets
  readonly host: MakerHost & { cancelApprovals(): void }
  readonly log: Logger
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly packageRoot: string
  /** Parent of storage.machine.directory: Stop re-reads the registry and leases under it. */
  readonly dataDirectory: string
  /** The window's folder, when one is open; the device log's exclusion bound. */
  readonly workspaceRoot: string | undefined
  readonly lan?: MakerLanPolicy
  /** A host-owned, already approved and leased serial machine connection. */
  readonly serialMachine?: (record: MachineRecord, deps: MachineDeps) => Promise<Machine>
  readonly prusalinkTransport?: (record: MachineRecord, secrets: MakerSecrets) => PrusaLinkTransport
  /** The host opens the OctoPrint auth-dialog URL, after same-origin validation here. */
  readonly openAuthDialog: (url: string) => Promise<void>
}

const grantSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().check(z.minLength(1)),
  time: z.number(),
})

export class MakerEngine {
  static async create(deps: MakerEngineDeps): Promise<MakerEngine> {
    const engine = new MakerEngine(deps)
    await engine.refresh()
    return engine
  }

  private enabled = false
  private enableGeneration = 0
  private logging: DeviceLog | undefined
  private readonly registry: MachineRegistry
  private readonly serial: ReturnType<typeof nativeSerial>
  private readonly machines = new Map<string, Machine>()
  private readonly leased = new Set<string>()
  private readonly dispatched = new Set<string>()
  private readonly lan: MakerLanPolicy

  private constructor(private readonly deps: MakerEngineDeps) {
    this.lan = deps.lan ?? runtimeMakerLan
    this.registry = new MachineRegistry(
      new FileMachineStorage(deps.storage.machine.directory),
      deps.secrets,
      this.lan,
    )
    this.serial = nativeSerial({
      platform: deps.platform,
      env: deps.env,
      packageRoot: deps.packageRoot,
      dataDirectory: deps.storage.machine.directory,
      // No folder open: the helper scope excludes the engine's own data
      // directory, which is never a legitimate helper location.
      workspace: deps.workspaceRoot ?? deps.dataDirectory,
      host: deps.host,
      refreshAdmission: () => this.refresh(),
      audit: ({ request, outcome }) =>
        this.deviceLog().append({
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
  }

  private deviceLog(): DeviceLog {
    this.logging ??= new DeviceLog(this.deps.storage.workspace.directory, this.deps.workspaceRoot, {
      maxBytes: RUNTIME_MAKER_LOG_BYTES,
      maxEntryBytes: RUNTIME_MAKER_MAX_BYTES,
      now: Date.now,
      secretValues: async () => {
        const records = await this.registry.list()
        const values = await Promise.all([
          this.deps.secrets.get(SECRET_KEYS.modelApiKey),
          ...records.map((record) =>
            this.deps.secrets.get(machineSecretName(record.registrationId)),
          ),
        ])
        return values.filter((value) => value !== undefined)
      },
    })
    return this.logging
  }

  private attended(): boolean {
    return this.deps.host.isTrusted() && this.deps.host.isInteractive()
  }

  private requireAttended(): void {
    if (!this.attended()) throw new Error(UI_TEXT.makerUnattendedDenied)
  }

  private async updateStopControls(): Promise<void> {
    try {
      await this.deps.host.stopControls(await this.summaries())
    } catch (error: unknown) {
      this.deps.log.error(`Maker stop controls update failed: ${errorNameForLog(error)}`)
    }
  }

  private async summaries(): Promise<readonly MakerMachineSummary[]> {
    const registered = await this.registry.list()
    return registered
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
  }

  private async openAuthDialog(endpoint: string, url: string): Promise<void> {
    let dialog: URL
    let target: URL
    try {
      dialog = new URL(url)
      target = new URL(endpoint)
    } catch (error: unknown) {
      // The URL constructor refuses malformed input with a TypeError; anything else is a bug.
      if (!(error instanceof TypeError)) throw error
      throw new MachineError('machineResponse')
    }
    if (dialog.origin !== target.origin) throw new MachineError('machineResponse')
    await this.deps.openAuthDialog(dialog.href)
  }

  private async machine(id: string): Promise<Machine> {
    const record = await this.registry.get(id)
    const previous = this.machines.get(record.registrationId)
    if (previous !== undefined) return previous
    const engineDeps: MachineDeps = {
      host: this.deps.host,
      log: this.deviceLog(),
      isLeaseHeld: () => this.leased.has(record.registrationId),
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
      ...this.deps.secrets,
      get: async (name: string) => {
        const current = await this.registry.get(id)
        if (current.registrationId !== record.registrationId)
          throw new MachineError('machineTargetChanged')
        return await this.deps.secrets.get(name)
      },
    }
    const http = new MachineHttp(record, this.lan, secrets, {
      timeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
      maxResponseBytes: RUNTIME_MAKER_MAX_BYTES,
      onGuardedDispatch: () => {
        this.dispatched.add(record.registrationId)
      },
      beforeGuardedDispatch: async () => {
        await this.refresh()
        const current = await this.registry.get(id)
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
        if (this.deps.prusalinkTransport === undefined)
          throw new MachineError('prusalink-transport-required')
        engine = createPrusalinkMachine(
          record,
          this.deps.prusalinkTransport(record, secrets),
          engineDeps,
        )
        break
      }
      default: {
        if (this.deps.serialMachine === undefined) throw new MachineError('serial-session-required')
        engine = await this.deps.serialMachine(record, engineDeps)
      }
    }
    this.machines.set(record.registrationId, engine)
    return engine
  }

  /** The engine's independent Stop: approvals, serial owners, then every machine. Never gated. */

  private async send(
    id: string,
    payload: string,
    signal: AbortSignal,
  ): Promise<Pick<MachineSendResult, 'outcome' | 'logRecorded'>> {
    await this.refresh()
    signal.throwIfAborted()
    const engine = await this.machine(id)
    const generation = engine.record.registrationId
    const claim = await claimHardwareLease(
      this.serial.lease,
      `machine:${generation}`,
      'Muse Spark window',
      async () => {
        await engine.stop()
      },
    )
    if (claim.status !== 'acquired') throw new MachineError('machineBusy')
    this.dispatched.delete(generation)
    this.leased.add(generation)
    const cancel = () => {
      this.deps.host.cancelApprovals()
      // Revoke the final write guard. Cancelling an unsent permission is not a machine Stop.
      this.leased.delete(generation)
      if (this.dispatched.has(generation))
        void (async () => {
          const [attempt] = await Promise.allSettled([engine.stop()])
          if (attempt.status === 'rejected') {
            // The notice itself never rejects: the host swallows delivery failures.
            void this.deps.host.notify({
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
      this.leased.delete(generation)
      this.dispatched.delete(generation)
      await claim.release()
    }
  }

  /** The tool list's state: registry summaries plus serial ports while enabled. */

  isHardwareEnabled(): boolean {
    return this.enabled
  }

  async refresh(): Promise<void> {
    this.enabled = false
    // Unreadable authority stays off; it must not prevent independent Stop controls.
    const [stored] = await Promise.allSettled([
      this.deps.storage.workspace.get(MAKER_HOST_STATE_KEY),
    ])
    if (stored.status === 'fulfilled') {
      const grant = grantSchema.safeParse(stored.value)
      this.enabled = grant.success && grant.data.enabled
    }
    if (!this.enabled || !this.deps.host.isTrusted() || !this.deps.host.isInteractive())
      this.deps.host.cancelApprovals()
  }

  /** The window's latch: the native reason prompt is the attended step, audited before it lands. */
  async setHardware(isEnabled: boolean, reason?: string): Promise<void> {
    if (!isEnabled) {
      this.enableGeneration += 1
      this.enabled = false
      this.deps.host.cancelApprovals()
      await this.deps.storage.workspace.delete(MAKER_HOST_STATE_KEY)
      await this.updateStopControls()
      return
    }
    if (!this.deps.host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
    if (!this.deps.host.isInteractive()) throw new Error(UI_TEXT.makerUnattendedDenied)
    if (reason === undefined || reason.trim() === '') throw new Error(UI_TEXT.makerHardwareReason)
    this.enableGeneration += 1
    const generation = this.enableGeneration
    await this.deviceLog().append({
      machine: 'workspace',
      action: 'observe',
      payload: reason.trim(),
      approval: null,
      outcome: 'sent',
    })
    if (generation !== this.enableGeneration || !this.attended())
      throw new Error(UI_TEXT.makerUnattendedDenied)
    await this.deps.storage.workspace.update(MAKER_HOST_STATE_KEY, {
      enabled: isEnabled,
      reason: reason.trim(),
      time: Date.now(),
    })
    this.enabled = true
    await this.updateStopControls()
  }

  async listMachines(): Promise<readonly MakerMachineSummary[]> {
    await this.refresh()
    return await this.summaries()
  }

  async listPorts(): Promise<readonly SerialIdentity[]> {
    await this.refresh()
    return this.enabled ? await this.serial.ports() : []
  }

  async registerMachine(message: MakerEngineRegistration, key: string | undefined): Promise<void> {
    await this.refresh()
    this.requireAttended()
    await this.registry.register(
      { ...message.machine, allowPlainHttp: message.allowPlainHttp },
      key,
    )
    await this.deps.host.notify({
      type: 'makerNotice',
      level: 'info',
      message: fill(UI_TEXT.makerMachineAdded, { name: message.machine.name }),
    })
    await this.updateStopControls()
  }

  /**
  OctoPrint enrollment without a pasted key: the person approves in
  OctoPrint's UI (a browser dialog opens) while the client polls. Every
  outcome is said; only a grant registers.
  */
  async registerOctoprintReadOnly(message: MakerEngineRegistration): Promise<void> {
    await this.refresh()
    this.requireAttended()
    const endpoint = message.machine.endpoint
    const http = new MachineHttp(
      { ...message.machine, allowPlainHttp: message.allowPlainHttp, registrationId: randomUUID() },
      this.lan,
      this.deps.secrets,
      { timeoutMs: RUNTIME_MAKER_TIMEOUT_MS, maxResponseBytes: RUNTIME_MAKER_MAX_BYTES },
    )
    const result = await requestOctoprintAppKey({
      http,
      app: OCTOPRINT_APPKEYS_APP,
      pollIntervalMs: OCTOPRINT_APPKEYS_POLL_MS,
      timeoutMs: OCTOPRINT_APPKEYS_TIMEOUT_MS,
      onAuthDialog: async (url) => {
        await this.openAuthDialog(endpoint, url)
        await this.deps.host.notify({
          type: 'makerNotice',
          level: 'info',
          message: fill(UI_TEXT.makerAppKeysApprove, { app: OCTOPRINT_APPKEYS_APP }),
        })
      },
    })
    if (result.status !== 'granted') {
      await this.deps.host.notify({
        type: 'makerNotice',
        level: 'warning',
        message:
          result.status === 'unsupported'
            ? UI_TEXT.makerAppKeysUnsupported
            : UI_TEXT.makerAppKeysDenied,
      })
      return
    }
    await this.registry.register(
      { ...message.machine, allowPlainHttp: message.allowPlainHttp },
      result.apiKey,
    )
    await this.deps.host.notify({
      type: 'makerNotice',
      level: 'info',
      message: fill(UI_TEXT.makerMachineAdded, { name: message.machine.name }),
    })
    await this.updateStopControls()
  }

  async removeMachine(message: MakerEngineRemoval): Promise<void> {
    await this.refresh()
    this.requireAttended()
    const current = await this.registry.get(message.machineId)
    if (current.registrationId !== message.registrationId)
      throw new MachineError('machineTargetChanged')
    await this.registry.remove(message.machineId)
    await this.updateStopControls()
  }

  async readDeviceLog(): Promise<readonly DeviceLogEntry[]> {
    return await this.deviceLog().read()
  }

  /** The engine's independent Stop: approvals, serial owners, then every machine. Never gated. */
  async stop(machineId?: string): Promise<void> {
    this.deps.host.cancelApprovals()
    this.serial.stop()
    const result = await stopRuntimeMachines(
      {
        dataDirectory: this.deps.dataDirectory,
        platform: this.deps.platform,
        secrets: this.deps.secrets,
        lan: this.lan,
      },
      machineId,
    )
    if (result.physicalStopRequired.length > 0)
      await this.deps.host.notify({
        type: 'makerNotice',
        level: 'warning',
        message: stopResultText(result),
      })
    await this.updateStopControls()
  }

  /** The tool list's state: registry summaries plus serial ports while enabled. */
  async listDevices(): Promise<unknown> {
    await this.refresh()
    const summaries = await this.summaries()
    const discovered = this.enabled ? await this.serial.ports() : []
    const ports = discovered.map((identity) => ({ ...identity, kind: 'serial' as const }))
    await this.deps.host.stopControls(summaries)
    return makerHostMessageSchema.parse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerState',
      isTrusted: this.deps.host.isTrusted(),
      hardwareEnabled: this.enabled,
      isInteractive: this.deps.host.isInteractive(),
      machines: summaries,
      ports,
    })
  }

  /** The tool calls' dispatch: serial, status and send. Anything else refuses. */
  async action(message: MakerEngineAction, signal: AbortSignal): Promise<unknown> {
    await this.refresh()
    if (!this.deps.host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
    if (!this.enabled) throw new Error(UI_TEXT.makerHardwareDisabled)
    switch (message.type) {
      case 'makerStatus': {
        const target = await this.machine(message.machineId)
        return makerHostMessageSchema.parse({
          v: MAKER_PROTOCOL_VERSION,
          type: 'makerStatus',
          machineId: message.machineId,
          status: await target.status(),
        })
      }
      case 'makerSend': {
        const result = await this.send(message.machineId, message.payload, signal)
        const text = {
          sent: UI_TEXT.execStatus.completed,
          sentWithUnrecordedAudit: UI_TEXT.makerAuditUnrecorded,
          sentOutcomeUnknown: UI_TEXT.makerSentOutcomeUnknown,
        }[result.outcome]
        return makerHostMessageSchema.parse({
          v: MAKER_PROTOCOL_VERSION,
          type: 'makerResult',
          id: message.id,
          outcome: result.outcome,
          message: text,
        })
      }
      case 'makerSerial': {
        const { kind: _kind, ...identity } = message.target
        const { operation, baud, durationMs, dtr, rts, payloadHex } = message
        const result = await this.serial.execute(
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
          v: MAKER_PROTOCOL_VERSION,
          type: 'makerResult',
          id: message.id,
          outcome,
          message: text,
        })
      }
      default: {
        throw new MachineError('maker-surface-operation-unavailable')
      }
    }
  }

  async close(): Promise<void> {
    this.deps.host.cancelApprovals()
    await this.serial.close()
    await this.deps.host.serialProvider?.release()
  }
}
