import { NodeTransactions } from './transactions'
// Shared core for the listener and T's local control socket. The A1/M104/C
// ports own integration; this core introduces no automatic approval or paid call.
import { UI_TEXT } from '../../shared/constants'
import type { NodeClock, NodeToolHostPort } from '../../shared/node'
import type { NodeSession } from '../../shared/nodeAuth'
import { NodeAttendance, type NodeRunPolicy } from './attendance'
import { NodeInterimKeyStore, type NodeVaultCodec } from './keyStore'
import { NodeKillSwitch, type NodeStopPort } from './killSwitch'
import type { NodeStateStore } from './state'
import { NodeAttempts } from './supervisor'

export interface NodeResources {
  readonly tools: NodeToolHostPort
  /** Engine turns, model requests, streams and registered device stops. */
  readonly stops: readonly NodeStopPort[]
}
export interface NodeServicePorts {
  readonly clock: NodeClock
  readonly vaultCodec: NodeVaultCodec
  /** C's peer-authenticated tools client and M104's engine/controller. */
  createResources(signal: AbortSignal): Promise<NodeResources>
  /** A1 must invalidate its actual bearer/challenge state as well as the public list. */
  endSessions(): Promise<void>
  /** Unexpected control/journal failures, fixed text at the presentation edge. */
  report: (error: unknown) => void
}

// Locked access and dropped control epochs are answered to the caller.
function isRoutineControlRefusal(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error &&
      [UI_TEXT.nodeErrors.locked, UI_TEXT.nodeErrors.cancelled].includes(error.message))
  )
}

export class NodeService {
  private resources: { value: NodeResources; kill: NodeKillSwitch } | undefined
  private opening: AbortController | undefined
  private readonly lifetime = new AbortController()
  private readonly transactions: NodeTransactions
  private locked = false
  private cleanupFailed = false
  private hasBooted = false
  private controlEpoch = 0

  readonly attendance: NodeAttendance
  readonly attempts: NodeAttempts
  readonly keys: NodeInterimKeyStore

  constructor(
    readonly state: NodeStateStore,
    private readonly ports: NodeServicePorts,
  ) {
    this.attendance = new NodeAttendance(ports.clock, state.read().ownerId)
    this.attempts = new NodeAttempts(state.files, this.attendance, ports.report)
    this.keys = new NodeInterimKeyStore(state.files, ports.vaultCodec, ports.report)
    this.transactions = new NodeTransactions((error: unknown) => {
      if (!isRoutineControlRefusal(error)) ports.report(error)
    })
  }

  private isUnavailable(): boolean {
    return !this.hasBooted || this.locked || this.cleanupFailed || this.lifetime.signal.aborted
  }

  private async boundedControl(operation: Promise<void>): Promise<void> {
    const deadline = new NodeKillSwitch(
      [
        {
          stop: async () => {
            await operation
          },
        },
      ],
      () => {
        this.keys.seal()
      },
      () => {
        this.attendance.endAll()
      },
    )
    try {
      await deadline.stop('stopped')
    } catch (error: unknown) {
      this.cleanupFailed = true
      this.locked = true
      this.keys.seal()
      this.attendance.endAll()
      throw error
    }
  }

  private async active(): Promise<{ value: NodeResources; kill: NodeKillSwitch }> {
    if (this.isUnavailable()) throw new Error(UI_TEXT.nodeErrors.locked)
    if (this.resources !== undefined) return this.resources
    const opening = new AbortController()
    this.opening = opening
    let value: NodeResources
    try {
      value = await this.ports.createResources(
        AbortSignal.any([this.lifetime.signal, opening.signal]),
      )
    } finally {
      this.opening = undefined
    }
    const kill = new NodeKillSwitch(
      [
        {
          stop: async (reason) => {
            await value.tools.stopAll(reason)
          },
        },
        ...value.stops,
      ],
      () => {
        this.keys.seal()
      },
      () => {
        this.attendance.endAll()
      },
    )
    if (this.isUnavailable() || opening.signal.aborted) {
      await kill.stop('locked')
      throw new Error(UI_TEXT.nodeErrors.locked)
    }
    this.resources = { value, kill }
    return this.resources
  }

  async boot(): Promise<void> {
    if (this.hasBooted) throw new Error(UI_TEXT.nodeErrors.conflict)
    this.keys.seal()
    this.attendance.endAll()
    await this.attempts.reconcile()
    this.hasBooted = true
  }

  get isLocked(): boolean {
    return this.locked
  }

  /** Called only by A1 after a successful verification, never from public metadata alone. */
  attach(session: NodeSession): void {
    if (this.isUnavailable()) throw new Error(UI_TEXT.nodeErrors.locked)
    this.attendance.attach(session)
  }

  async run<T>(
    id: string,
    policy: NodeRunPolicy,
    signal: AbortSignal,
    work: (tools: NodeToolHostPort, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const resources = await this.transactions.enqueue(async () => await this.active())
    const combined = AbortSignal.any([signal, resources.kill.signal, this.lifetime.signal])
    return await this.attempts.run(
      id,
      policy,
      combined,
      async (attemptSignal) => await work(resources.value.tools, attemptSignal),
    )
  }

  stop(): Promise<void> {
    this.opening?.abort()
    const current = this.resources
    // Abort running work immediately, before waiting for any serialized setup.
    const stopping = current?.kill.stop('stopped')
    return this.boundedControl(
      this.transactions.enqueue(async () => {
        try {
          await stopping
          await this.resources?.kill.stop('stopped')
        } catch (error: unknown) {
          this.cleanupFailed = true
          this.locked = true
          this.keys.seal()
          this.attendance.endAll()
          throw error
        } finally {
          this.resources = undefined
        }
        await this.state.append({
          kind: 'node',
          action: 'stop',
          sessionId: null,
          time: this.ports.clock.now(),
          outcome: 'allowed',
        })
      }),
    )
  }

  lock(): Promise<void> {
    this.opening?.abort()
    this.controlEpoch += 1
    this.locked = true
    this.keys.seal()
    this.attendance.endAll()
    const current = this.resources
    const cleanup = new NodeKillSwitch(
      [
        {
          stop: async () => {
            await current?.kill.stop('locked')
          },
        },
        {
          stop: async () => {
            await this.ports.endSessions()
          },
        },
      ],
      () => {
        this.keys.seal()
      },
      () => {
        this.attendance.endAll()
      },
    )
    const stopping = cleanup.stop('locked')
    // Observe an early failure while resource creation is serialized ahead of us.
    const settled = Promise.allSettled([stopping])
    return this.boundedControl(
      this.transactions.enqueue(async () => {
        const results = await settled
        this.resources = undefined
        if (results.some((result) => result.status === 'rejected')) this.cleanupFailed = true
        await this.state.append({
          kind: 'node',
          action: 'lock',
          sessionId: null,
          time: this.ports.clock.now(),
          outcome: results.some((result) => result.status === 'rejected') ? 'failed' : 'allowed',
        })
        if (results.some((result) => result.status === 'rejected'))
          throw new Error(UI_TEXT.nodeErrors.unavailable)
      }),
    )
  }

  /** Local owner control or A1's consumed key.unlock step-up calls this with stdin/UI input. */
  unlock(passphrase: string): Promise<void> {
    const epoch = this.controlEpoch
    return this.transactions.enqueue(async () => {
      this.lifetime.signal.throwIfAborted()
      if (!this.hasBooted || this.cleanupFailed) throw new Error(UI_TEXT.nodeErrors.unavailable)
      if (this.controlEpoch !== epoch) throw new Error(UI_TEXT.nodeErrors.cancelled)
      try {
        await this.keys.unlock(passphrase)
        await this.state.append({
          kind: 'node',
          action: 'unlock',
          sessionId: null,
          time: this.ports.clock.now(),
          outcome: 'allowed',
        })
        if (this.controlEpoch !== epoch) throw new Error(UI_TEXT.nodeErrors.cancelled)
        this.locked = false
      } catch (error: unknown) {
        this.keys.seal()
        this.locked = true
        throw error
      }
    })
  }

  async shutdown(): Promise<void> {
    this.lifetime.abort()
    await this.lock()
  }

  async wipe(): Promise<void> {
    await this.shutdown()
    await this.keys.destroy()
    // Destroy boot identity material before the command removes the state root.
    await this.state.files.write('identity-key.pem', '')
  }
}
