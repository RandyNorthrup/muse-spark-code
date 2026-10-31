import { createHash, randomUUID } from 'node:crypto'
import {
  MakerApproval,
  type SerialApprovalRequest,
  type MakerHost,
  type MakerSerialProvider,
} from '../ports'
export type { SerialApprovalRequest } from '../ports'
import * as z from 'zod/mini'
import { checkFlashIdentity, type FlashTarget } from '../flashIdentity'
import {
  claimHardwareLease,
  serialLeaseResource,
  type HardwareLeaseRecord,
  type LeaseDependencies,
} from '../lease'
import { serialPayload } from './framing'
import { isSameSerialIdentity, serialIdentitySchema, type SerialIdentity } from './identity'
import type { SerialCapture, SerialProcess } from './process'

const inputSchema = z
  .strictObject({
    operation: z.enum(['read', 'write']),
    identity: serialIdentitySchema,
    baud: z.int().check(z.positive()),
    durationMs: z.int().check(z.positive()),
    dtr: z.boolean(),
    rts: z.boolean(),
    payloadHex: z.string().check(z.regex(/^(?:[\da-f]{2})*$/i)),
  })
  .check(z.refine((input) => input.operation === 'write' || input.payloadHex === ''))
const actionSchema = z.enum(['connect', 'program', 'actuate', 'refused'])

export type SerialActionInput = z.infer<typeof inputSchema>

export interface SerialActionLog {
  readonly request: SerialApprovalRequest
  readonly outcome: 'attempt' | 'rejected' | 'changed' | 'sent' | 'failed' | 'stopped'
}

export interface SerialSessionDependencies {
  readonly platform: NodeJS.Platform
  readonly holder: string
  readonly lease: LeaseDependencies
  readonly limits: {
    readonly maxBytes: number
    readonly maxDurationMs: number
    readonly approvalTtlMs: number
    readonly maxIdentityChanges: number
  }
  /** Host state only. Refuses Plan, unattended, disabled or untrusted contexts. */
  readonly canUseHardware: () => boolean
  /** Lane G's classification, including irreversible operations and machine limits. */
  readonly classify: (
    input: SerialActionInput,
  ) => Promise<'connect' | 'program' | 'actuate' | 'refused'>
  /** Only the host UI supplies this answer; never tool args or results. */
  readonly confirm: MakerHost<SerialApprovalRequest>['confirm']
  /** Returns a currently discovered serial identity, or throws for an unknown port. */
  readonly identityNow: (port: string) => Promise<SerialIdentity>
  /** Metadata check (fuser/lsof or OS exclusive open), never a probe open. */
  readonly isPortBusy: (identity: SerialIdentity) => Promise<boolean>
  /** Cancellation must settle only after the opener and its port have closed. */
  readonly open: MakerSerialProvider['open']
  readonly log: (event: SerialActionLog) => Promise<void>
  readonly signal: AbortSignal
  /** Project detection supplies this; never inferred from a UART bridge. */
  readonly flashTarget?: FlashTarget
}

export type SerialActionResult =
  | { readonly status: 'complete'; readonly capture: SerialCapture }
  | { readonly status: 'busy'; readonly holder?: HardwareLeaseRecord }
  | {
      readonly status: 'refused'
      readonly reason:
        'context' | 'bounds' | 'identity' | 'mismatch' | 'approval' | 'changed' | 'classification'
    }

class SerialStartError extends Error {
  constructor(readonly reason: 'context' | 'approval' | 'changed') {
    super(`maker-serial-start-${reason}`)
  }
}

async function isApproved(
  approval: MakerApproval<SerialApprovalRequest>,
  deps: SerialSessionDependencies,
): Promise<boolean> {
  const request = approval.request
  let timer: ReturnType<typeof setTimeout> | undefined
  const listening = new AbortController()
  try {
    const pending = new Promise<undefined>((resolve) => {
      if (deps.signal.aborted) {
        resolve(undefined)
        return
      }
      timer = setTimeout(
        () => {
          resolve(undefined)
        },
        Math.max(0, request.expiresAt - Date.now()),
      )
      deps.signal.addEventListener(
        'abort',
        () => {
          resolve(undefined)
        },
        { once: true, signal: listening.signal },
      )
    })
    const answer = await Promise.race([
      deps.confirm(request, (raw) => approval.review(raw)),
      pending,
    ])
    return !deps.signal.aborted && approval.answer(answer) !== undefined
  } finally {
    clearTimeout(timer)
    listening.abort()
  }
}

function isReleaseFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && typeof error.code === 'string') || error.message.startsWith('lease-'))
  )
}

async function releaseAfterStop(release: () => Promise<void>, hasStopped: boolean): Promise<void> {
  try {
    await release()
  } catch (error: unknown) {
    // Stop has acted on the process; its acknowledgement never depends on lease cleanup.
    if (!hasStopped || !isReleaseFailure(error)) throw error
  }
}

/** A bounded operation. A new call always mints a new, single-use approval. */
export async function runSerialAction(
  raw: unknown,
  deps: SerialSessionDependencies,
): Promise<SerialActionResult> {
  if (!deps.canUseHardware() || deps.signal.aborted) return { status: 'refused', reason: 'context' }
  const input = inputSchema.parse(raw)
  if (
    input.payloadHex.length > deps.limits.maxBytes * 2 ||
    input.durationMs > deps.limits.maxDurationMs
  )
    return { status: 'refused', reason: 'bounds' }
  let action = actionSchema.parse(await deps.classify(input))
  if (action === 'refused' || (action === 'connect' && input.operation === 'write'))
    return { status: 'refused', reason: 'classification' }
  let identity = serialIdentitySchema.parse(await deps.identityNow(input.identity.port))
  if (!isSameSerialIdentity(identity, input.identity))
    return { status: 'refused', reason: 'identity' }
  const bytes = Buffer.from(input.payloadHex, 'hex')
  let process: SerialProcess | undefined
  let opening: Promise<SerialProcess> | undefined
  let stopping: Promise<void> | undefined
  const stopped = new AbortController()
  const approvalDeps = { ...deps, signal: AbortSignal.any([deps.signal, stopped.signal]) }
  const stop = () => {
    stopped.abort()
    stopping ??= (async () => {
      let opened = process
      if (opening !== undefined) {
        // The cancelled opener has settled with its port closed.
        const [attempt] = await Promise.allSettled([opening])
        if (attempt.status !== 'fulfilled') return
        opened = attempt.value
      }
      await opened?.close()
    })()
    return stopping
  }
  const claimed = await claimHardwareLease(
    deps.lease,
    await serialLeaseResource(identity, deps.platform),
    deps.holder,
    stop,
  )
  if (claimed.status === 'cancelled') return { status: 'refused', reason: 'context' }
  if (claimed.status === 'busy')
    return { status: 'busy', ...(claimed.holder !== undefined && { holder: claimed.holder }) }
  const canProceed = () => stopping === undefined && !deps.signal.aborted && deps.canUseHardware()
  const onAbort = () => {
    void stop()
  }
  deps.signal.addEventListener('abort', onAbort, { once: true })
  try {
    if (await deps.isPortBusy(identity)) return { status: 'busy' }
    for (let changes = 0; changes <= deps.limits.maxIdentityChanges; changes += 1) {
      if (!canProceed()) return { status: 'refused', reason: 'context' }
      if (changes > 0) {
        action = actionSchema.parse(await deps.classify({ ...input, identity }))
        if (action === 'refused' || (action === 'connect' && input.operation === 'write'))
          return { status: 'refused', reason: 'classification' }
      }
      if (
        input.operation === 'write' &&
        deps.flashTarget !== undefined &&
        checkFlashIdentity(identity, deps.flashTarget).status === 'mismatch'
      )
        return { status: 'refused', reason: 'mismatch' }
      const digest = createHash('sha256').update(bytes).digest('hex')
      const requestInput: SerialApprovalRequest = {
        kind: 'serial',
        id: randomUUID(),
        digest,
        target: { ...identity, kind: 'serial' },
        expiresAt: Date.now() + deps.limits.approvalTtlMs,
        action,
        payload: serialPayload(bytes),
        baud: input.baud,
        durationMs: input.durationMs,
        dtr: input.dtr,
        rts: input.rts,
        warnsAboutReset: true,
        flashIdentity: checkFlashIdentity(identity, deps.flashTarget ?? {}),
        ...(deps.flashTarget !== undefined && {
          projectTarget: deps.flashTarget,
        }),
      }
      const approval = new MakerApproval(requestInput, canProceed)
      const request = approval.request
      if (!(await isApproved(approval, approvalDeps))) {
        await deps.log({ request, outcome: 'rejected' })
        return { status: 'refused', reason: deps.canUseHardware() ? 'approval' : 'context' }
      }
      const current = serialIdentitySchema.parse(await deps.identityNow(identity.port))
      if (!isSameSerialIdentity(identity, current)) {
        await deps.log({ request, outcome: 'changed' })
        identity = current
        continue
      }
      if (!canProceed()) return { status: 'refused', reason: 'context' }
      if (Date.now() >= request.expiresAt) return { status: 'refused', reason: 'approval' }
      if (await deps.isPortBusy(identity)) return { status: 'busy' }
      // Log failure aborts before dispatch; host redacts values in its append-only log.
      await deps.log({ request, outcome: 'attempt' })
      const beforeOpen = serialIdentitySchema.parse(await deps.identityNow(identity.port))
      if (!isSameSerialIdentity(identity, beforeOpen)) {
        await deps.log({ request, outcome: 'changed' })
        identity = beforeOpen
        continue
      }
      if (!canProceed() || Date.now() >= request.expiresAt)
        return { status: 'refused', reason: 'context' }
      try {
        opening = deps.open(
          { ...input, identity },
          deps.limits.maxBytes,
          approvalDeps.signal,
          async () => {
            const live = serialIdentitySchema.parse(await deps.identityNow(identity.port))
            return () => {
              if (!canProceed()) throw new SerialStartError('context')
              if (Date.now() >= request.expiresAt) throw new SerialStartError('approval')
              if (!isSameSerialIdentity(identity, live)) {
                identity = live
                throw new SerialStartError('changed')
              }
              if (!approval.start({ ...live, kind: 'serial' }))
                throw new SerialStartError('approval')
            }
          },
        )
        process = await opening
        if (!approval.hasStarted) throw new Error('maker-adapter-start-guard-missing')
        if (canProceed()) {
          const connected = serialIdentitySchema.parse(await deps.identityNow(identity.port))
          if (!canProceed()) await process.close()
          else if (Date.now() >= request.expiresAt) {
            await deps.log({ request, outcome: 'rejected' })
            return { status: 'refused', reason: 'approval' }
          } else if (!isSameSerialIdentity(identity, connected)) {
            await deps.log({ request, outcome: 'changed' })
            identity = connected
            continue
          } else if (input.operation === 'write') await process.write(bytes)
        } else {
          await process.close()
        }
        const capture = await process.result
        let outcome: SerialActionLog['outcome'] = 'sent'
        if (capture.reason === 'failed') outcome = 'failed'
        else if (capture.reason === 'stopped') outcome = 'stopped'
        await deps.log({ request, outcome })
        return { status: 'complete', capture }
      } catch (error: unknown) {
        if (error instanceof SerialStartError) {
          const outcome = error.reason === 'changed' ? 'changed' : 'rejected'
          await deps.log({ request, outcome })
          if (error.reason !== 'changed') return { status: 'refused', reason: error.reason }
        } else if (approvalDeps.signal.aborted) {
          await deps.log({ request, outcome: 'stopped' })
          return { status: 'refused', reason: 'context' }
        } else {
          await deps.log({ request, outcome: 'failed' })
          if (error instanceof Error && error.message === 'serial-helper-busy')
            return { status: 'busy' }
          throw error
        }
      } finally {
        await process?.close()
        opening = undefined
      }
    }
    return { status: 'refused', reason: 'changed' }
  } finally {
    deps.signal.removeEventListener('abort', onAbort)
    try {
      await stopping
    } finally {
      await releaseAfterStop(claimed.release, stopping !== undefined)
    }
  }
}
