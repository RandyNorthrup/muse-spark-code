import { withMakerDeadline } from './deadline'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { payloadDigest, type DeviceLogPort } from '../deviceLog'
import { analyseGcode, type GcodeAnalysis, type GcodeState } from '../gcode/analyser'
import { type GcodeDialect } from '../gcode/dialects'
import { checkGcodeLimits, effectiveLimits, type MachineLimits } from '../gcode/limits'
import { tokenizeGcode, type GcodePolicy } from '../gcode/tokenizer'
import { MachineError, machineRecordSchema, type MachineRecord } from '../registry'

export type MachineWarning = 'physicalStopRequired' | 'startupMotion' | 'limitsUnavailable'
export interface MachineStatus {
  readonly identity: string
  readonly state: string
  readonly isHomed: boolean
  readonly limits: MachineLimits
  readonly gcode: GcodeState | undefined
  readonly blockedCommands: readonly string[]
  readonly warnings: readonly MachineWarning[]
}
export interface MachineApproval {
  readonly id: string
  readonly digest: string
  readonly target: {
    readonly id: string
    readonly name: string
    readonly endpoint: string
    readonly identity: string
  }
  readonly expiresAt: number
  readonly payload: string
  readonly analysis: GcodeAnalysis
}
const answerSchema = z.strictObject({
  id: z.string(),
  digest: z.string(),
  targetIdentity: z.string(),
  decision: z.enum(['sendOnce', 'reject']),
})
/** A structural slice of MakerHost. No model-visible flag or token enters this port. */
export interface MachineHost {
  isTrusted(): boolean
  hardwareEnabled(): boolean
  isInteractive(): boolean
  confirm(request: MachineApproval): Promise<unknown>
  notify(warning: MachineWarning): Promise<void>
}
export interface MachinePolicy {
  readonly gcode: GcodePolicy
  readonly approvalTtlMs: number
  readonly stopDeadlineMs: number
  readonly requestDeadlineMs: number
  readonly maxStateChanges: number
  readonly now: () => number
}
export interface MachineDeps {
  /** Lane P owns the lease. The host keeps this Machine for the lease lifetime. */
  readonly isLeaseHeld: () => boolean
  readonly host: MachineHost
  readonly policy: MachinePolicy
  readonly log: DeviceLogPort
}
export interface Machine {
  readonly record: MachineRecord
  status(): Promise<MachineStatus>
  send(payload: string): Promise<void>
  stop(): Promise<{ readonly warnings: readonly MachineWarning[]; readonly logRecorded: boolean }>
}
/** Transport operations are injected and remain private to the protected Machine. */
export interface MachineDriver {
  readonly dialect: GcodeDialect
  readonly stopPayload: string | Uint8Array
  readonly statusPayload: string
  preparePayload?(input: string): string
  status(signal: AbortSignal): Promise<MachineStatus>
  send(payload: string, signal: AbortSignal): Promise<void>
  stop(signal: AbortSignal): Promise<readonly MachineWarning[]>
  cancel(): void
}

function fingerprint(status: MachineStatus): string {
  return payloadDigest(JSON.stringify(status))
}

export function protectMachine(
  recordInput: MachineRecord,
  driver: MachineDriver,
  deps: MachineDeps,
): Machine {
  const record = machineRecordSchema.parse(recordInput)
  // Copy once from the registry. Model tools accept only a machine id and bytes.
  let isSending = false
  let generation = 0
  const active = new Set<AbortController>()
  const access = (): void => {
    if (!deps.host.isTrusted() || !deps.host.hardwareEnabled())
      throw new MachineError('hardwareDisabled')
  }
  const read = async (): Promise<MachineStatus> => {
    const status = await withMakerDeadline(
      (signal) => driver.status(signal),
      deps.policy.requestDeadlineMs,
    )
    await withMakerDeadline(async () => {
      await deps.log.append({
        machine: record.id,
        action: 'observe',
        payload: driver.statusPayload,
        approval: null,
        outcome: 'sent',
      })
    }, deps.policy.requestDeadlineMs)
    return status
  }
  const audit = async (
    payload: string,
    outcome: 'attempt' | 'sent' | 'failed',
    approval: string | null,
  ): Promise<void> => {
    await withMakerDeadline(async () => {
      await deps.log.append({ machine: record.id, action: 'actuate', payload, approval, outcome })
    }, deps.policy.requestDeadlineMs)
  }
  const isStopLogged = async (outcome: 'stopped' | 'failed'): Promise<boolean> => {
    try {
      await withMakerDeadline(async () => {
        await deps.log.append({
          machine: record.id,
          action: 'stop',
          payload: driver.stopPayload,
          approval: null,
          outcome,
        })
      }, deps.policy.requestDeadlineMs)
      return true
    } catch {
      return false
    }
  }
  return {
    // Return a new copy so a caller cannot change the registration used below.
    get record() {
      return machineRecordSchema.parse(record)
    },
    async status() {
      access()
      if (!deps.host.isInteractive() && ['grbl', 'fluidnc', 'marlin'].includes(record.kind))
        throw new MachineError('unattendedHardware')
      return await read()
    },
    async send(input) {
      const payload = driver.preparePayload?.(input) ?? input
      access()
      if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
      if (record.category !== 'printer' || ['grbl', 'fluidnc', 'prusalink'].includes(record.kind))
        throw new MachineError('readOnlyMachine')
      if (isSending || !deps.isLeaseHeld()) throw new MachineError('machineBusy')
      isSending = true
      const started = generation
      let approval: string | null = null
      try {
        for (let change = 0; change <= deps.policy.maxStateChanges; change += 1) {
          access()
          if (!deps.isLeaseHeld()) throw new MachineError('machineBusy')
          if (generation !== started) throw new MachineError('machineStopped')
          const status = await read()
          access()
          if (!deps.isLeaseHeld()) throw new MachineError('machineBusy')
          if (generation !== started) throw new MachineError('machineStopped')
          if (!['ready', 'idle', 'operational'].includes(status.state))
            throw new MachineError('machineBusy')
          if (status.gcode === undefined) throw new MachineError('unknownState')
          const blocks = tokenizeGcode(payload, deps.policy.gcode)
          if (blocks.some((block) => status.blockedCommands.includes(block.command)))
            throw new MachineError('unknownEffects')
          const analysis = analyseGcode(payload, driver.dialect, status.gcode, deps.policy.gcode)
          const failure = checkGcodeLimits(
            analysis,
            effectiveLimits(status.limits, record.limits),
            status.isHomed,
          )
          if (failure !== undefined) throw new MachineError(failure)
          const approvalStarted = performance.now()
          const request: MachineApproval = {
            id: randomUUID(),
            digest: payloadDigest(payload),
            target: {
              id: record.id,
              name: record.name,
              endpoint: record.endpoint,
              identity: status.identity,
            },
            expiresAt: deps.policy.now() + deps.policy.approvalTtlMs,
            payload,
            analysis,
          }
          const hasExpired = (): boolean =>
            deps.policy.now() >= request.expiresAt ||
            performance.now() - approvalStarted >= deps.policy.approvalTtlMs
          // The host sees a detached snapshot, never mutable engine state.
          const supplied = await withMakerDeadline(
            () => deps.host.confirm(structuredClone(request)),
            deps.policy.approvalTtlMs,
          )
          const answer = answerSchema.safeParse(supplied)
          if (
            !answer.success ||
            answer.data.decision !== 'sendOnce' ||
            answer.data.id !== request.id ||
            answer.data.digest !== request.digest ||
            answer.data.targetIdentity !== request.target.identity ||
            hasExpired()
          )
            throw new MachineError('approvalRejected')
          access()
          if (!deps.isLeaseHeld()) throw new MachineError('machineBusy')
          if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
          if (generation !== started) throw new MachineError('machineStopped')
          if (hasExpired()) throw new MachineError('approvalRejected')
          approval = request.id
          await audit(payload, 'attempt', approval)
          const current = await read()
          if (fingerprint(current) !== fingerprint(status)) {
            await audit(payload, 'failed', approval)
            approval = null
            continue
          }
          if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
          // Stop/revocation while persisting the intent must prevent dispatch.
          access()
          if (!deps.isLeaseHeld()) throw new MachineError('machineBusy')
          if (generation !== started) throw new MachineError('machineStopped')
          if (hasExpired()) throw new MachineError('approvalRejected')
          const controller = new AbortController()
          active.add(controller)
          try {
            await withMakerDeadline(
              (signal) => driver.send(payload, AbortSignal.any([signal, controller.signal])),
              deps.policy.requestDeadlineMs,
            )
          } finally {
            active.delete(controller)
          }
          await audit(payload, 'sent', approval)
          return
        }
        throw new MachineError('machineStateChanged')
      } catch (error) {
        try {
          await audit(payload, 'failed', approval)
        } catch {
          /* The intent failure already prevents dispatch; preserve the original error. */
        }
        throw error
      } finally {
        isSending = false
      }
    },
    async stop() {
      // No trust, switch, consent, log, read, lease or running-turn gate here.
      generation += 1
      for (const controller of active) controller.abort()
      try {
        driver.cancel()
      } catch {
        /* A broken stream cancellation must not prevent the fixed Stop. */
      }
      let warnings: readonly MachineWarning[]
      try {
        warnings = await withMakerDeadline(
          (signal) => driver.stop(signal),
          deps.policy.stopDeadlineMs,
        )
      } catch (error) {
        await isStopLogged('failed')
        throw error
      }
      const isLogRecorded = await isStopLogged('stopped')
      for (const warning of warnings) {
        try {
          await withMakerDeadline(() => deps.host.notify(warning), deps.policy.requestDeadlineMs)
        } catch {
          /* The caller still receives the warning when its notification surface failed. */
        }
      }
      return { warnings, logRecorded: isLogRecorded }
    },
  }
}
