// The machine-engine construction both maker services share (RLF-M103WIRE):
// the runtime service (src/runtime/maker/service.ts) and the VS Code
// window's engine (src/host/maker/makerEngine.ts) build identical machine
// engines, guard sends with the same lease and shape the same tool results.
// One copy keeps the two paths' guarantees identical.
import { Buffer } from 'node:buffer'
import type { DeviceLog } from './deviceLog'
import { claimHardwareLease, type LeaseDependencies } from './lease'
import {
  MachineError,
  type MachineRecord,
  type MachineRegistry,
  type MakerLanPolicy,
} from './registry'
import { MachineHttp } from './machines/http'
import type { Machine, MachineDeps, MachineSendResult } from './machines/machine'
import { createMoonrakerMachine } from './machines/moonraker'
import { createOctoprintMachine } from './machines/octoprint'
import { createPrusalinkMachine, type PrusaLinkTransport } from './machines/prusalink'
import type { MakerSecrets } from './ports'
import type { SerialActionLog, SerialActionResult } from './serial/session'
import {
  MAKER_PROTOCOL_VERSION,
  RUNTIME_MAKER_APPROVAL_MS,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_MAX_LINES,
  RUNTIME_MAKER_MM_PER_INCH,
  RUNTIME_MAKER_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import {
  makerHostMessageSchema,
  type MakerMachineSummary,
  type MakerSurfaceMessage,
} from '../../shared/makerProtocol'
import { fill } from '../../shared/l10n/text'

/**
The serial audit writer both services hand to nativeSerial. The log is
resolved per event: a service whose storage never audits must never pay
for — or fail on — its construction.
*/
export function serialAuditAppender(
  getLog: () => DeviceLog,
): (event: SerialActionLog) => Promise<void> {
  return ({ request, outcome }) =>
    getLog().append({
      machine: request.target.port,
      action: request.action,
      payload:
        request.payload.encoding === 'hex'
          ? Buffer.from(request.payload.value, 'hex')
          : request.payload.value,
      approval: request.id,
      outcome: outcome === 'rejected' || outcome === 'changed' ? 'refused' : outcome,
    })
}

/** The registry rows both states report. */
export function summarizeMachines(
  records: readonly MachineRecord[],
): readonly MakerMachineSummary[] {
  return records
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

export interface MachineEngineContext {
  readonly host: MachineDeps['host']
  readonly log: DeviceLog
  readonly leased: Set<string>
  readonly secrets: MakerSecrets
  readonly registry: Pick<MachineRegistry, 'get'>
  readonly lan: MakerLanPolicy
  readonly refresh: () => Promise<void>
  readonly dispatched: Set<string>
  readonly prusalinkTransport?:
    ((record: MachineRecord, secrets: MakerSecrets) => PrusaLinkTransport) | undefined
  readonly serialMachine?:
    ((record: MachineRecord, deps: MachineDeps) => Promise<Machine>) | undefined
}

/** One machine's engine, with registration-pinned secrets and dispatch guards. */
export async function machineEngineFor(
  record: MachineRecord,
  id: string,
  ctx: MachineEngineContext,
): Promise<Machine> {
  const engineDeps: MachineDeps = {
    host: ctx.host,
    log: ctx.log,
    isLeaseHeld: () => ctx.leased.has(record.registrationId),
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
    ...ctx.secrets,
    get: async (name: string) => {
      const current = await ctx.registry.get(id)
      if (current.registrationId !== record.registrationId)
        throw new MachineError('machineTargetChanged')
      return await ctx.secrets.get(name)
    },
  }
  const http = new MachineHttp(record, ctx.lan, secrets, {
    timeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
    maxResponseBytes: RUNTIME_MAKER_MAX_BYTES,
    onGuardedDispatch: () => {
      ctx.dispatched.add(record.registrationId)
    },
    beforeGuardedDispatch: async () => {
      await ctx.refresh()
      const current = await ctx.registry.get(id)
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
      if (ctx.prusalinkTransport === undefined)
        throw new MachineError('prusalink-transport-required')
      engine = createPrusalinkMachine(record, ctx.prusalinkTransport(record, secrets), engineDeps)
      break
    }
    default: {
      if (ctx.serialMachine === undefined) throw new MachineError('serial-session-required')
      engine = await ctx.serialMachine(record, engineDeps)
    }
  }
  return engine
}

export interface LeaseGuardedSend {
  readonly lease: LeaseDependencies
  readonly holder: string
  readonly engine: Machine
  readonly payload: string
  readonly signal: AbortSignal
  readonly host: MachineDeps['host'] & { cancelApprovals(): void }
  readonly leased: Set<string>
  readonly dispatched: Set<string>
}

/** A send under the machine's lease: the claim, the abort guard, the release. */
export async function leaseGuardedSend(
  args: LeaseGuardedSend,
): Promise<Pick<MachineSendResult, 'outcome' | 'logRecorded'>> {
  const generation = args.engine.record.registrationId
  const claim = await claimHardwareLease(
    args.lease,
    `machine:${generation}`,
    args.holder,
    async () => {
      await args.engine.stop()
    },
  )
  if (claim.status !== 'acquired') throw new MachineError('machineBusy')
  args.dispatched.delete(generation)
  args.leased.add(generation)
  const cancel = () => {
    args.host.cancelApprovals()
    // Revoke the final write guard. Cancelling an unsent permission is not a machine Stop.
    args.leased.delete(generation)
    if (args.dispatched.has(generation))
      void (async () => {
        const [attempt] = await Promise.allSettled([args.engine.stop()])
        if (attempt.status === 'rejected') {
          // The notice itself never rejects: the host swallows delivery failures.
          void args.host.notify({
            type: 'makerNotice',
            level: 'error',
            message: fill(UI_TEXT.makerStopFailed, { machine: args.engine.record.name }),
          })
        }
      })()
  }
  args.signal.addEventListener('abort', cancel, { once: true })
  try {
    args.signal.throwIfAborted()
    const result = await args.engine.send(args.payload)
    return { outcome: result.outcome, logRecorded: result.logRecorded }
  } finally {
    args.signal.removeEventListener('abort', cancel)
    args.leased.delete(generation)
    args.dispatched.delete(generation)
    await claim.release()
  }
}

/** The `makerSend` tool result both actions answer. */
export function makerSendResultMessage(outcome: MachineSendResult['outcome'], id: string): unknown {
  const text = {
    sent: UI_TEXT.execStatus.completed,
    sentWithUnrecordedAudit: UI_TEXT.makerAuditUnrecorded,
    sentOutcomeUnknown: UI_TEXT.makerSentOutcomeUnknown,
  }[outcome]
  return makerHostMessageSchema.parse({
    v: MAKER_PROTOCOL_VERSION,
    type: 'makerResult',
    id,
    outcome,
    message: text,
  })
}

/** The `makerSerial` tool input both actions execute. */
export function makerSerialInput(
  message: Extract<MakerSurfaceMessage, { type: 'makerSerial' }>,
): Record<string, unknown> {
  const { kind: _kind, ...identity } = message.target
  const { operation, baud, durationMs, dtr, rts, payloadHex } = message
  return { operation, baud, durationMs, dtr, rts, payloadHex, identity }
}

/** The `makerSerial` tool result both actions answer. */
export function makerSerialResultMessage(result: SerialActionResult, id: string): unknown {
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
    id,
    outcome,
    message: text,
  })
}
