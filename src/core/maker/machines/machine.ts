import { withMakerDeadline } from './deadline'
import { performance } from 'node:perf_hooks'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { payloadDigest, type DeviceLogPort } from '../deviceLog'
import { analyseGcode, type GcodeAnalysis, type GcodeState } from '../gcode/analyser'
import { type GcodeDialect } from '../gcode/dialects'
import { checkGcodeLimits, effectiveLimits, type MachineLimits } from '../gcode/limits'
import {
  canonicalGcodeCommand,
  GcodeError,
  serializeGcode,
  tokenizeGcode,
  type GcodePolicy,
} from '../gcode/tokenizer'
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
  readonly payloadTerminator?: '\n'
  status(signal: AbortSignal): Promise<MachineStatus>
  /** Resolve transport inputs, then read state; invoke the returned guard
   * synchronously at the write, including after any transport queue. */
  send(payload: string, signal: AbortSignal, beforeWrite: () => Promise<() => void>): Promise<void>
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
    // Persist the observation intent before reading, so log/secret awaits
    // cannot age the final status snapshot used at the write.
    await withMakerDeadline(async () => {
      await deps.log.append({
        machine: record.id,
        action: 'observe',
        payload: driver.statusPayload,
        approval: null,
        outcome: 'attempt',
      })
    }, deps.policy.requestDeadlineMs)
    return await withMakerDeadline((signal) => driver.status(signal), deps.policy.requestDeadlineMs)
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
      if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
      if (!deps.host.isInteractive() && ['grbl', 'fluidnc', 'marlin'].includes(record.kind))
        throw new MachineError('unattendedHardware')
      return await read()
    },
    async send(input) {
      access()
      if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
      if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
      if (record.category !== 'printer' || ['grbl', 'fluidnc', 'prusalink'].includes(record.kind))
        throw new MachineError('readOnlyMachine')
      if (isSending || !deps.isLeaseHeld()) throw new MachineError('machineBusy')
      const blocks = tokenizeGcode(input, deps.policy.gcode)
      const canonical = serializeGcode(blocks)
      const payload = `${canonical}${driver.payloadTerminator ?? ''}`
      if (
        Buffer.byteLength(payload) > deps.policy.gcode.maxBytes ||
        payload.split('\n').length > deps.policy.gcode.maxLines
      )
        throw new GcodeError('payloadSize')
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
          const blocked = new Set(
            status.blockedCommands.map((command) => canonicalGcodeCommand(command)),
          )
          if (blocks.some((block) => blocked.has(block.command)))
            throw new MachineError('unknownEffects')
          const analysis = analyseGcode(blocks, driver.dialect, status.gcode, deps.policy.gcode)
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
              (signal) =>
                driver.send(payload, AbortSignal.any([signal, controller.signal]), async () => {
                  const latest = await read()
                  return () => {
                    signal.throwIfAborted()
                    access()
                    if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
                    if (!deps.isLeaseHeld()) throw new MachineError('machineBusy')
                    if (generation !== started) throw new MachineError('machineStopped')
                    if (hasExpired()) throw new MachineError('approvalRejected')
                    if (fingerprint(latest) !== fingerprint(status))
                      throw new MachineError('machineStateChanged')
                  }
                }),
              deps.policy.requestDeadlineMs,
            )
          } catch (error) {
            if (!(error instanceof MachineError) || error.code !== 'machineStateChanged')
              throw error
            await audit(payload, 'failed', approval)
            approval = null
            continue
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
