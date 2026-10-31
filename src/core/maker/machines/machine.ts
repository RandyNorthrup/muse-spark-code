import { withMakerDeadline } from './deadline'
import { performance } from 'node:perf_hooks'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { MakerApproval, type MachineApprovalRequest, type MakerHost } from '../ports'
import type { MakerWarning } from '../../../shared/makerProtocol'
import { payloadDigest, type DeviceLogPort } from '../deviceLog'
import { analyseGcode, type GcodeState } from '../gcode/analyser'
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

export type MachineWarning = MakerWarning
export interface MachineStatus {
  readonly identity: string
  readonly state: string
  readonly isHomed: boolean
  readonly limits: MachineLimits
  readonly gcode: GcodeState | undefined
  readonly blockedCommands: readonly string[]
  readonly warnings: readonly MachineWarning[]
}
type MachineHost = Pick<
  MakerHost<MachineApprovalRequest>,
  'isTrusted' | 'hardwareEnabled' | 'isInteractive' | 'confirm' | 'notify'
>
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
export interface MachineSendResult {
  readonly outcome: 'sent' | 'sentWithUnrecordedAudit' | 'sentOutcomeUnknown'
  readonly logRecorded: boolean
  /** Retries accounting only; never actuates or asks for another send. */
  retryAudit(): Promise<boolean>
}
export interface Machine {
  readonly record: MachineRecord
  /** A lost acknowledgement blocks sends until an explicit status read succeeds. */
  readonly requiresStatusRead: boolean
  status(): Promise<MachineStatus>
  send(payload: string): Promise<MachineSendResult>
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
  synchronously at the write, including after any transport queue. */
  send(payload: string, signal: AbortSignal, beforeWrite: () => Promise<() => void>): Promise<void>
  stop(signal: AbortSignal): Promise<readonly MachineWarning[]>
  cancel(): void
}

function fingerprint(status: MachineStatus): string {
  return payloadDigest(JSON.stringify(status))
}

// After a write begins, a transport failure leaves the outcome unknown;
// only programming errors (never a port or network result) propagate.
function isDispatchFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof ReferenceError) &&
    !(error instanceof SyntaxError) &&
    !(error instanceof RangeError)
  )
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
  let requiresStatusRead = false
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
    outcome: 'attempt' | 'sent' | 'failed' | 'sentOutcomeUnknown',
    approval: string | null,
  ): Promise<void> => {
    await withMakerDeadline(async () => {
      await deps.log.append({ machine: record.id, action: 'actuate', payload, approval, outcome })
    }, deps.policy.requestDeadlineMs)
  }
  const isStopLogged = async (outcome: 'stopped' | 'failed'): Promise<boolean> => {
    const [attempt] = await Promise.allSettled([
      withMakerDeadline(async () => {
        await deps.log.append({
          machine: record.id,
          action: 'stop',
          payload: driver.stopPayload,
          approval: null,
          outcome,
        })
      }, deps.policy.requestDeadlineMs),
    ])
    return attempt.status === 'fulfilled'
  }
  return {
    // Return a new copy so a caller cannot change the registration used below.
    get record() {
      return machineRecordSchema.parse(record)
    },
    get requiresStatusRead() {
      return requiresStatusRead
    },
    async status() {
      access()
      if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
      if (!deps.host.isInteractive() && ['grbl', 'fluidnc', 'marlin'].includes(record.kind))
        throw new MachineError('unattendedHardware')
      const started = generation
      const status = await read()
      if (!isSending && generation === started) requiresStatusRead = false
      return status
    },
    async send(input) {
      access()
      if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
      if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
      if (record.category !== 'printer' || ['grbl', 'fluidnc', 'prusalink'].includes(record.kind))
        throw new MachineError('readOnlyMachine')
      if (requiresStatusRead) throw new MachineError('machineStatusRequired')
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
          const requestInput: MachineApprovalRequest = {
            kind: 'machine',
            action: 'actuate',
            id: randomUUID(),
            digest: payloadDigest(payload),
            target: {
              kind: 'machine',
              registrationId: record.registrationId,
              id: record.id,
              name: record.name,
              endpoint: record.endpoint,
              identity: status.identity,
            },
            expiresAt: deps.policy.now() + deps.policy.approvalTtlMs,
            payload,
            analysis,
          }
          const approvalCheck = new MakerApproval(
            requestInput,
            () =>
              deps.host.isTrusted() &&
              deps.host.hardwareEnabled() &&
              deps.host.isInteractive() &&
              deps.isLeaseHeld() &&
              generation === started,
            deps.policy.now,
          )
          const request = approvalCheck.request
          const hasExpired = (): boolean =>
            deps.policy.now() >= request.expiresAt ||
            performance.now() - approvalStarted >= deps.policy.approvalTtlMs
          // The host sees a detached snapshot, never mutable engine state.
          const supplied = await withMakerDeadline(
            () => deps.host.confirm(structuredClone(request), (raw) => approvalCheck.review(raw)),
            deps.policy.approvalTtlMs,
          )
          access()
          if (!deps.isLeaseHeld()) throw new MachineError('machineBusy')
          if (!deps.host.isInteractive()) throw new MachineError('unattendedHardware')
          if (generation !== started) throw new MachineError('machineStopped')
          const binding = approvalCheck.answer(supplied)
          if (binding === undefined || hasExpired()) throw new MachineError('approvalRejected')
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
          const dispatch = { didBeginWrite: false }
          let dispatchOutcome: 'sent' | 'sentOutcomeUnknown' = 'sent'
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
                    // This guard runs synchronously at the transport write. Once
                    // reached, no transport/deadline/parse error proves nonexecution.
                    if (
                      !approvalCheck.consume(binding, {
                        kind: 'machine',
                        registrationId: record.registrationId,
                        id: record.id,
                        name: record.name,
                        endpoint: record.endpoint,
                        identity: latest.identity,
                      })
                    )
                      throw new MachineError('approvalRejected')
                    dispatch.didBeginWrite = true
                  }
                }),
              deps.policy.requestDeadlineMs,
            )
          } catch (error) {
            if (dispatch.didBeginWrite && isDispatchFailure(error)) {
              dispatchOutcome = 'sentOutcomeUnknown'
              requiresStatusRead = true
              generation += 1
            } else if (
              !dispatch.didBeginWrite &&
              error instanceof MachineError &&
              error.code === 'machineStateChanged'
            ) {
              await audit(payload, 'failed', approval)
              approval = null
              continue
            } else throw error
          } finally {
            active.delete(controller)
          }
          // Dispatch may be irreversible even without acknowledgement. Accounting
          // and notification failures must never invite replay of relative motion.
          const sentApproval = approval
          const auditState: { isRecorded: boolean; pending: Promise<boolean> | undefined } = {
            isRecorded: false,
            pending: undefined,
          }
          const isAuditRecorded = async (): Promise<boolean> => {
            if (auditState.isRecorded) return true
            if (auditState.pending !== undefined) return await auditState.pending
            auditState.pending = (async () => {
              const [attempt] = await Promise.allSettled([
                audit(payload, dispatchOutcome, sentApproval),
              ])
              if (attempt.status !== 'fulfilled') return false
              auditState.isRecorded = true
              return true
            })()
            try {
              return await auditState.pending
            } finally {
              auditState.pending = undefined
            }
          }
          const isLogRecorded = (await isAuditRecorded()) || (await isAuditRecorded())
          if (!isLogRecorded) {
            // The caller still receives the dispatch outcome and missing audit.
            await Promise.allSettled([
              withMakerDeadline(async () => {
                await deps.host.notify('auditUnrecorded')
              }, deps.policy.requestDeadlineMs),
            ])
          }
          if (dispatchOutcome === 'sentOutcomeUnknown') {
            // The result still carries uncertainty when the surface is unavailable.
            await Promise.allSettled([
              withMakerDeadline(async () => {
                await deps.host.notify('sentOutcomeUnknown')
              }, deps.policy.requestDeadlineMs),
            ])
          }
          return {
            outcome:
              dispatchOutcome === 'sent' && !isLogRecorded
                ? 'sentWithUnrecordedAudit'
                : dispatchOutcome,
            logRecorded: isLogRecorded,
            retryAudit: isAuditRecorded,
          }
        }
        throw new MachineError('machineStateChanged')
      } catch (error) {
        // The intent failure already prevents dispatch; preserve the original error.
        await Promise.allSettled([audit(payload, 'failed', approval)])
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
      } catch (error) {
        // A broken stream cancellation must not prevent the fixed Stop.
        if (!isDispatchFailure(error)) throw error
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
        // The caller still receives the warning when its notification surface failed.
        await Promise.allSettled([
          withMakerDeadline(async () => {
            await deps.host.notify(warning)
          }, deps.policy.requestDeadlineMs),
        ])
      }
      return { warnings, logRecorded: isLogRecorded }
    },
  }
}
