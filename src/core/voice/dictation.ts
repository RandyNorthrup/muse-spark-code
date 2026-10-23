// Voice dictation (M9): the driver behind the composer's microphone.
//
// Speech is recognised by the operating system's own engine through a small
// helper process (native/windows/dictate.ps1 on Windows,
// native/darwin/muse-dictate-screen-<arch>.app/Contents/MacOS/muse-dictate
// on macOS) that speaks one line protocol: commands in on stdin
// ("start", "stop", "quit"), JSON objects out on stdout ("ready", "listening",
// "text", "stopped", "error"). Nothing leaves the machine and nothing is
// billed; the helper is the only place audio exists.
//
// The capture helpers of Muse Voice (M35) speak the same protocol with one
// more line, "audio": the recording itself, base64 16-bit PCM, which the
// listener streams on; they recognise nothing.
//
// One recording owns its helper process from Start until that process is
// observed gone (RVCM352B P1-b): a stop acknowledgement retires the
// recording, but idle is reported only after the process exits (bounded;
// then it is killed and that is said). No helper is reused across presses,
// so a trailing event or a refused stop can never touch the next recording.
// A kill the platform refuses keeps its reaping instead: presses queue
// behind the observed exit and the kill is retried, so a second recorder
// never starts alongside the still-live first one. This module never imports
// `vscode` or `child_process`: the host injects the spawn.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  DICTATION_HELPER_COMMANDS,
  DICTATION_QUIT_GRACE_MS,
  DICTATION_STDERR_TAIL_CHARS,
  DICTATION_STOP_GRACE_MS,
} from '../../shared/dictationConstants'
import type { CoreLogger } from '../logging'
import type { OwnedSessionBudgetScope } from '../backends/modelapi/sessionBudget'

export const DICTATION_STATUSES = ['idle', 'starting', 'listening'] as const
export type DictationStatus = (typeof DICTATION_STATUSES)[number]

const helperLineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), language: z.string(), recognizer: z.optional(z.string()) }),
  z.object({ type: z.literal('listening') }),
  z.object({ type: z.literal('text'), text: z.string(), confidence: z.optional(z.number()) }),
  z.object({ type: z.literal('stopped') }),
  z.object({ type: z.literal('error'), reason: z.string() }),
  // A capture helper's recording (M35): 16-bit little-endian mono PCM, base64.
  z.object({ type: z.literal('audio'), data: z.string() }),
])
export type HelperLine = z.infer<typeof helperLineSchema>

/** One stdout line from the helper; undefined for anything that is not the protocol. */
export function parseHelperLine(line: string): HelperLine | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    // Only malformed text reads absent: anything else JSON.parse cannot
    // shape (a stack overflow on hostile nesting) is raised, never silence.
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  const result = helperLineSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

export interface HelperInvocation {
  /** A CPU recognizer may need longer to drain the final bounded phrase. */
  readonly stopGraceMs?: number

  readonly command: string
  readonly args: readonly string[]
  /**
  Variables set for the helper on top of the extension host's environment,
  replacing an inherited variable of the same name (`helperEnvironment`).
  */
  readonly environment?: Readonly<Record<string, string>>
  /**
  Said after the exit report when the helper ends before its "ready" line
  without being asked to: the operating system refused to run it or
  stopped it at a permission check (M26, PLAN.md D29).
  */
  readonly earlyExitHint?: string
}

interface ChunkSource {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
}

/** The slice of a child process the driver touches; the host adapts `spawn` to it. */
export interface HelperChild {
  readonly stdout: ChunkSource
  readonly stderr: ChunkSource
  /** Writes one command line to the helper's stdin. */
  send(line: string): void
  /**
  Fires once, when no process exists for the helper any more: it exited,
  it could not be started, or a quit was answered with no process
  running. Never fires for a refused kill: that stays on `onStopFailed`,
  so waiting for the exit cannot mistake a live microphone for a gone one.
  */
  onExit(listener: (description: string) => void): void
  kill(): void
  /**
  Fires when an explicit kill of a live helper is refused (the process
  may still hold the microphone). Absent on helpers whose kill cannot be
  refused; those report every failure through `onExit` or an error line.
  */
  onStopFailed?(listener: (description: string) => void): void
}

/** Per-recording consent; send checks include current paid availability and the spend cap. */
export type VoiceConsentFence = (keyDigest: string | undefined, isSending: boolean) => void

export interface DictationListener {
  /** Only paid Model API voice uses this extension-owned scope, per recording. */
  ownedBudgetScope?(): Promise<OwnedSessionBudgetScope | undefined>
  /** Captured by the recording once; no key value or journal is required. */
  voiceConsentFence?(): VoiceConsentFence | undefined
  onVoiceUsage?(message: string): void
  onStatus(status: DictationStatus): void
  /** One recognised phrase, as the engine wrote it. */
  onText(text: string): void
  /** The helper failed or died; the status is idle again by the time this fires. */
  onError(reason: string): void
  /** A capture helper's audio (M35), in order. */
  onAudio?(pcm: Uint8Array): void
  /** The helper confirmed the stop: every word, or every byte of audio, has arrived. */
  onStopped?(): void
}

export interface DictationDeps {
  readonly invocation: HelperInvocation
  readonly spawn: (invocation: HelperInvocation) => HelperChild
  readonly listener: DictationListener
  readonly log: CoreLogger
}

/** Splits a byte stream into complete lines, keeping the partial tail. */
export class LineSplitter {
  private tail = ''

  public push(chunk: Buffer | string): readonly string[] {
    const text = this.tail + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    const lines = text.split('\n')
    this.tail = lines.pop() ?? ''
    return lines.map((line) => line.trimEnd()).filter((line) => line !== '')
  }
}

interface RunningHelper {
  readonly child: HelperChild
  isReady: boolean
  /** "start" was requested and will be sent when the helper says "ready". */
  isStartWanted: boolean
  /** "stop" was sent; the recording ends when its process is observed gone. */
  isStopping: boolean
  /**
  A "start" pressed while the previous recording's process is still
  winding down: it spawns only after that process is observed gone, so
  at most one recorder process exists and trailing events keep their
  owner (M35, the restart race).
  */
  isStartPending: boolean
  /** "quit" was sent: an exit is expected and not an error. */
  isQuitting: boolean
  /** The exit was observed (or no process ever existed): nothing to reap. */
  hasExited: boolean
  /** An explicit kill was refused; the process may still be recording. */
  stopRefused: boolean
  /** The exit report, kept so a missing acknowledgement still says why. */
  exitDescription: string | undefined
  stderrTail: string
  stopTimer: ReturnType<typeof setTimeout> | undefined
  /** Every end waiting on this helper's process to be gone. */
  exitWaiters: Set<() => void>
}

/**
What the conversation controller drives: the two calls, plus a dispose
that drains admission and settlement (awaitable on the paid engine).
*/
export interface DictationHandle {
  start(): void
  stop(): void
  dispose(): void | Promise<void>
}

/** What the host found for a window: a way to start dictating, or why there is none. */
export type DictationSetup =
  | {
      readonly isAvailable: true
      readonly create: (listener: DictationListener) => DictationHandle
    }
  | { readonly isAvailable: false; readonly reason: string }

export class Dictation {
  private helper: RunningHelper | undefined
  /**
  The helper whose process is winding down after its recording was
  retired: a press meanwhile queues behind its observed exit.
  */
  private reaping: RunningHelper | undefined
  /** Every recording end still waiting on its helper's process. */
  private readonly pendingReaps = new Set<Promise<unknown>>()
  private status: DictationStatus = 'idle'
  private isDisposed = false

  public constructor(private readonly deps: DictationDeps) {}

  private setStatus(status: DictationStatus): void {
    if (this.status === status) {
      return
    }
    this.status = status
    this.deps.listener.onStatus(status)
  }

  private clearTimers(helper: RunningHelper): void {
    if (helper.stopTimer === undefined) {
      return
    }
    clearTimeout(helper.stopTimer)
    helper.stopTimer = undefined
  }

  private spawnHelper(): RunningHelper {
    const child = this.deps.spawn(this.deps.invocation)
    const helper: RunningHelper = {
      child,
      isReady: false,
      isStartWanted: false,
      isStopping: false,
      isStartPending: false,
      isQuitting: false,
      hasExited: false,
      stopRefused: false,
      exitDescription: undefined,
      stderrTail: '',
      stopTimer: undefined,
      exitWaiters: new Set(),
    }
    const lines = new LineSplitter()
    child.stdout.on('data', (chunk) => {
      for (const line of lines.push(chunk)) {
        this.handleLine(helper, line)
      }
    })
    child.stderr.on('data', (chunk) => {
      helper.stderrTail = (helper.stderrTail + String(chunk)).slice(-DICTATION_STDERR_TAIL_CHARS)
    })
    child.onExit((description) => {
      this.handleExit(helper, description)
    })
    child.onStopFailed?.((description) => {
      if (this.helper !== helper && this.reaping !== helper) {
        return
      }
      helper.stopRefused = true
      this.deps.log.warn(`Dictation helper stop was refused: ${description}`)
    })
    this.deps.log.info(`Dictation helper started: ${this.deps.invocation.command}`)
    return helper
  }

  private handleLine(helper: RunningHelper, line: string): void {
    if (this.helper !== helper) {
      return
    }
    const message = parseHelperLine(line)
    if (message === undefined) {
      // Its length only: the line could hold dictated words (M39).
      this.deps.log.warn(
        `Dictation helper wrote an unexpected line (${String(line.length)} characters)`,
      )
      return
    }
    switch (message.type) {
      case 'ready': {
        helper.isReady = true
        this.deps.log.info(
          `Dictation helper ready (${message.language}${message.recognizer === undefined ? '' : `, ${message.recognizer}`})`,
        )
        if (helper.isStartWanted) {
          helper.isStartWanted = false
          helper.child.send(DICTATION_HELPER_COMMANDS.start)
        }
        return
      }
      case 'listening': {
        this.setStatus('listening')
        return
      }
      case 'text': {
        // The words themselves stay out of the log.
        this.deps.log.info(`Dictation: ${String(message.text.length)} characters recognised`)
        this.deps.listener.onText(message.text)
        return
      }
      case 'stopped': {
        // The recording is retired, but it is not ended: idle (and the next
        // press) waits until the helper's process is observed gone.
        helper.isStopping = false
        if (helper.stopTimer !== undefined) {
          clearTimeout(helper.stopTimer)
          helper.stopTimer = undefined
        }
        void this.finishStop(helper)
        return
      }
      case 'audio': {
        this.deps.listener.onAudio?.(Buffer.from(message.data, 'base64'))
        return
      }
      case 'error': {
        this.deps.log.warn(`Dictation helper reported: ${message.reason}`)
        this.fail(helper, message.reason)
      }
    }
  }

  /**
  The helper is unusable: drop it at once, and tell the listener once its
  process is observed gone (bounded; then it is killed and that is said).
  */
  private fail(helper: RunningHelper, reason: string): void {
    // A start queued behind the dying recording dies with the helper: the
    // error says the microphone failed, and the next press starts afresh.
    // The kill lands inside the failure's end, after its exit waiter, so a
    // failure with no process behind it is said at once.
    helper.isStartPending = false
    this.forget(helper)
    helper.isQuitting = true
    void this.finishFail(helper, reason)
  }

  /** The kill signal, remembered so the exit wait kills at most once more. */
  private killHelper(helper: RunningHelper): void {
    helper.child.kill()
  }

  private forget(helper: RunningHelper): void {
    this.clearTimers(helper)
    if (this.helper === helper) {
      this.helper = undefined
    }
  }

  /**
  Resolves true once no process exists for the helper: its exit was
  observed, or it never had one. Otherwise kills after the grace, waits
  once more, and resolves false, so the caller says so. Never rejects.
  */
  private awaitHelperExit(helper: RunningHelper, hasKilled: boolean): Promise<boolean> {
    if (helper.hasExited) {
      return Promise.resolve(true)
    }
    const reap = new Promise<boolean>((resolve) => {
      let isDone = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      let exitTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (didExit: boolean): void => {
        if (isDone) return
        isDone = true
        if (killTimer !== undefined) clearTimeout(killTimer)
        if (exitTimer !== undefined) clearTimeout(exitTimer)
        helper.exitWaiters.delete(wake)
        resolve(didExit)
      }
      const wake = (): void => {
        finish(true)
      }
      helper.exitWaiters.add(wake)
      killTimer = setTimeout(() => {
        killTimer = undefined
        if (!hasKilled) {
          hasKilled = true
          this.killHelper(helper)
        }
        exitTimer = setTimeout(() => {
          exitTimer = undefined
          finish(false)
        }, DICTATION_QUIT_GRACE_MS)
      }, DICTATION_QUIT_GRACE_MS)
    })
    this.pendingReaps.add(reap)
    void reap.finally(() => {
      this.pendingReaps.delete(reap)
    })
    return reap
  }

  /** A fresh helper for the next recording, starting once it is ready. */
  private spawnNext(): void {
    const helper = this.spawnHelper()
    this.helper = helper
    helper.isStartWanted = true
    this.setStatus('starting')
  }

  /**
  A retired recording's end: the helper is asked to quit, and idle (with
  the queued press, if any) is reported only after its process is
  observed gone. A kill that was needed is said, and the end still lands.
  */
  private async finishStop(helper: RunningHelper): Promise<void> {
    this.forget(helper)
    this.reaping = helper
    let isRetained = false
    try {
      // The waiter goes in before the quit: a quit answered with no
      // process running resolves it synchronously.
      const reaped = this.awaitHelperExit(helper, false)
      helper.child.send(DICTATION_HELPER_COMMANDS.quit)
      const didExit = await reaped
      if (!didExit) {
        this.deps.log.warn(
          `Dictation helper did not exit after its stop${helper.stopRefused ? ' (its stop was refused)' : ''}; killed it`,
        )
        this.deps.listener.onError('The dictation helper stopped responding')
        // The process may still hold the microphone: keep the reaping,
        // queue presses behind its observed exit, and retry the kill until
        // that exit arrives. No fresh recorder starts meanwhile, and the
        // retired recording is ended only then.
        isRetained = true
        void this.retainUntilExit(helper, () => this.deps.listener.onStopped?.())
        return
      }
      const hasPending = helper.isStartPending && !this.isDisposed
      helper.isStartPending = false
      if (this.reaping === helper) {
        this.reaping = undefined
      }
      if (hasPending) {
        // The next recording begins only now that the previous process is
        // gone: its events cannot leak into the finished one, and the
        // button never flashes idle between the two.
        this.spawnNext()
      } else {
        this.setStatus('idle')
      }
      this.deps.listener.onStopped?.()
    } finally {
      if (!isRetained && this.reaping === helper) {
        this.reaping = undefined
      }
    }
  }

  /** A failed recording's end: the failure is said once its process is gone. */
  private async finishFail(helper: RunningHelper, reason: string): Promise<void> {
    this.reaping = helper
    let isRetained = false
    try {
      const reaped = this.awaitHelperExit(helper, true)
      this.killHelper(helper)
      const didExit = await reaped
      if (!didExit) {
        this.deps.log.warn(
          `Dictation helper exit was not observed${helper.stopRefused ? ' (its stop was refused)' : ''}; it may still hold the microphone: ${reason}`,
        )
        // The process may still be recording: keep the reaping, queue
        // presses behind its observed exit, and retry the kill until
        // that exit arrives. No fresh recorder starts meanwhile.
        this.deps.listener.onError(reason)
        isRetained = true
        void this.retainUntilExit(helper)
        return
      }
      const hasPending = helper.isStartPending && !this.isDisposed
      helper.isStartPending = false
      if (this.reaping === helper) {
        this.reaping = undefined
      }
      this.setStatus('idle')
      this.deps.listener.onError(reason)
      if (hasPending) {
        // A press that landed while the failure wound down starts afresh
        // on a new process once the failure is said.
        this.spawnNext()
      }
    } finally {
      if (!isRetained && this.reaping === helper) {
        this.reaping = undefined
      }
    }
  }

  /**
  A refused kill's aftermath: the kill is retried until the helper's
  process is observed gone (or the driver is disposed). Only then is
  the reaping released, idle reported, and a queued press spawned, so
  at most one recorder process ever exists. The optional end reports a
  retired recording's stop once its process is gone.
  */
  private async retainUntilExit(helper: RunningHelper, then?: () => void): Promise<void> {
    for (;;) {
      this.killHelper(helper)
      if ((await this.awaitHelperExit(helper, true)) || this.isDisposed) break
    }
    const hasPending = helper.isStartPending && !this.isDisposed
    helper.isStartPending = false
    if (this.reaping === helper) {
      this.reaping = undefined
    }
    this.setStatus('idle')
    then?.()
    if (hasPending) {
      this.spawnNext()
    }
  }

  private handleExit(helper: RunningHelper, description: string): void {
    helper.hasExited = true
    helper.exitDescription ??= description
    for (const wake of helper.exitWaiters) {
      wake()
    }
    helper.exitWaiters.clear()
    const wasCurrent = this.helper === helper
    const wasExpected = helper.isQuitting
    this.forget(helper)
    this.deps.log.info(`Dictation helper exited (${description})`)
    if (!wasCurrent || wasExpected) {
      return
    }
    // Died on its own: the button goes idle and the user learns why.
    this.setStatus('idle')
    const detail = helper.stderrTail.trim()
    const hint = helper.isReady ? undefined : this.deps.invocation.earlyExitHint
    this.deps.listener.onError(
      `${description}${detail === '' ? '' : `: ${detail.split('\n').at(-1) ?? detail}`}${hint === undefined ? '' : `. ${hint}`}`,
    )
  }

  /** The user pressed the microphone (or Ctrl+D) while idle. */
  public start(): void {
    if (this.isDisposed) {
      return
    }
    // A retired recording's process still winding down — or a refused
    // kill still retained — queues behind its observed exit, never onto
    // a dying process, whatever the button shows.
    if (this.reaping !== undefined) {
      this.reaping.isStartPending = true
      this.setStatus('starting')
      return
    }
    if (this.status !== 'idle') {
      // A press while the previous stop is still unacknowledged queues
      // behind it: the next recording spawns only after the old process is
      // observed gone, so its trailing events keep their owner.
      const stopping = this.helper
      if (stopping?.isStopping === true) {
        stopping.isStartPending = true
        this.setStatus('starting')
      }
      return
    }
    this.setStatus('starting')
    const helper = this.helper ?? this.spawnHelper()
    this.helper = helper
    if (helper.isReady) {
      helper.child.send(DICTATION_HELPER_COMMANDS.start)
    } else {
      helper.isStartWanted = true
    }
  }

  /** The user released a held button, or tapped it while listening. */
  public stop(): void {
    // The latest press wins: a start queued behind a winding-down
    // recording is cancelled.
    if (this.reaping !== undefined) {
      this.reaping.isStartPending = false
    }
    const helper = this.helper
    if (helper === undefined || this.status === 'idle') {
      return
    }
    if (!helper.isReady) {
      // Cancelled before the engine even loaded: nothing was ever recorded.
      // The helper quits without ever having started, and idle waits for
      // its process to be observed gone.
      helper.isStartWanted = false
      helper.isStartPending = false
      void this.finishStop(helper)
      return
    }
    // The latest press wins: a start queued behind this stop is cancelled.
    helper.isStartPending = false
    if (helper.isStopping) return
    helper.isStopping = true
    helper.child.send(DICTATION_HELPER_COMMANDS.stop)
    // Linux can acknowledge synchronously during send.
    if (this.helper?.isStopping !== true || this.helper !== helper) return
    // Idle waits for the helper's process to be observed gone (its
    // "stopped" retires the recording; the grace timer ends it by force):
    // until then a new press queues behind this recording, and every
    // trailing event still belongs to it.
    helper.stopTimer = setTimeout(() => {
      helper.stopTimer = undefined
      if (!helper.isStopping) {
        return
      }
      this.deps.log.warn('Dictation helper did not confirm the stop; restarting it')
      this.fail(helper, 'The dictation helper stopped responding')
    }, this.deps.invocation.stopGraceMs ?? DICTATION_STOP_GRACE_MS)
  }

  /**
  The window, the backend or the recording is going away: the helper is
  asked to quit, and this resolves only after its process is observed
  gone (bounded; then it is killed and that is said). Never rejects, so
  the drain waiting on it cannot fail a shutdown.
  */
  public async dispose(): Promise<void> {
    this.isDisposed = true
    const helper = this.helper
    if (helper === undefined) {
      // A winding-down recording still reaps: the drain outlives the button.
      await Promise.allSettled(this.pendingReaps)
      return
    }
    this.forget(helper)
    helper.isStartPending = false
    helper.isQuitting = true
    this.reaping = helper
    try {
      const reaped = this.awaitHelperExit(helper, false)
      helper.child.send(DICTATION_HELPER_COMMANDS.quit)
      const didExit = await reaped
      await Promise.allSettled(this.pendingReaps)
      if (!didExit) {
        this.deps.log.warn(
          `Dictation helper did not exit on dispose${helper.stopRefused ? ' (its stop was refused)' : ''}; killed it`,
        )
        this.deps.listener.onError('The dictation helper stopped responding')
      }
    } finally {
      if (this.reaping === helper) {
        this.reaping = undefined
      }
    }
    this.status = 'idle'
  }
}
