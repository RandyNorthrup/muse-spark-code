// Voice dictation (M9): the driver behind the composer's microphone.
//
// Speech is recognised by the operating system's own engine through a small
// helper process (native/windows/dictate.ps1 on Windows, native/darwin/
// muse-dictate on macOS) that speaks one line protocol: commands in on stdin
// ("start", "stop", "quit"), JSON objects out on stdout ("ready", "listening",
// "text", "stopped", "error"). Nothing leaves the machine and nothing is
// billed; the helper is the only place audio exists.
//
// The capture helpers of Muse Voice (M35) speak the same protocol with one
// more line, "audio": the recording itself, base64 16-bit PCM, which the
// listener streams on; they recognise nothing.
//
// The helper stays resident between recordings so a second press starts
// listening in milliseconds (the engine takes about a second to load), and
// quits by itself after DICTATION_IDLE_EXIT_MS unused. This module never
// imports `vscode` or `child_process`: the host injects the spawn.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  DICTATION_HELPER_COMMANDS,
  DICTATION_IDLE_EXIT_MS,
  DICTATION_QUIT_GRACE_MS,
  DICTATION_STDERR_TAIL_CHARS,
  DICTATION_STOP_GRACE_MS,
} from '../../shared/constants'
import type { CoreLogger } from '../logging'

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
  } catch {
    return undefined
  }
  const result = helperLineSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

export interface HelperInvocation {
  readonly command: string
  readonly args: readonly string[]
  /**
   * Variables set for the helper on top of the extension host's environment,
   * replacing an inherited variable of the same name (`helperEnvironment`).
   */
  readonly environment?: Readonly<Record<string, string>>
  /**
   * Said after the exit report when the helper ends before its "ready" line
   * without being asked to: the operating system refused to run it or
   * stopped it at a permission check (M26, PLAN.md D29).
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
  /** Fires once, when the process has exited or could not be started. */
  onExit(listener: (description: string) => void): void
  kill(): void
}

export interface DictationListener {
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
  /** "stop" was sent; "stopped" (or the grace timer) ends it. */
  isStopping: boolean
  /** "quit" was sent: an exit is expected and not an error. */
  isQuitting: boolean
  stderrTail: string
  stopTimer: ReturnType<typeof setTimeout> | undefined
  idleTimer: ReturnType<typeof setTimeout> | undefined
  quitTimer: ReturnType<typeof setTimeout> | undefined
}

/** What the conversation controller drives: the three calls, nothing else. */
export type DictationHandle = Pick<Dictation, 'start' | 'stop' | 'dispose'>

/** What the host found for a window: a way to start dictating, or why there is none. */
export type DictationSetup =
  | {
      readonly isAvailable: true
      readonly create: (listener: DictationListener) => DictationHandle
    }
  | { readonly isAvailable: false; readonly reason: string }

export class Dictation {
  private helper: RunningHelper | undefined
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
    for (const timer of [helper.stopTimer, helper.idleTimer, helper.quitTimer]) {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
    helper.stopTimer = undefined
    helper.idleTimer = undefined
    helper.quitTimer = undefined
  }

  private spawnHelper(): RunningHelper {
    const child = this.deps.spawn(this.deps.invocation)
    const helper: RunningHelper = {
      child,
      isReady: false,
      isStartWanted: false,
      isStopping: false,
      isQuitting: false,
      stderrTail: '',
      stopTimer: undefined,
      idleTimer: undefined,
      quitTimer: undefined,
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
        } else {
          this.armIdleExit(helper)
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
        helper.isStopping = false
        if (helper.stopTimer !== undefined) {
          clearTimeout(helper.stopTimer)
          helper.stopTimer = undefined
        }
        this.setStatus('idle')
        this.armIdleExit(helper)
        this.deps.listener.onStopped?.()
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

  /** The helper is unusable: drop it, go idle, tell the listener once. */
  private fail(helper: RunningHelper, reason: string): void {
    this.forget(helper)
    helper.isQuitting = true
    helper.child.kill()
    this.setStatus('idle')
    this.deps.listener.onError(reason)
  }

  private forget(helper: RunningHelper): void {
    this.clearTimers(helper)
    if (this.helper === helper) {
      this.helper = undefined
    }
  }

  private handleExit(helper: RunningHelper, description: string): void {
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

  private armIdleExit(helper: RunningHelper): void {
    if (helper.idleTimer !== undefined) {
      clearTimeout(helper.idleTimer)
    }
    helper.idleTimer = setTimeout(() => {
      helper.idleTimer = undefined
      this.quit(helper)
    }, DICTATION_IDLE_EXIT_MS)
  }

  private quit(helper: RunningHelper): void {
    helper.isQuitting = true
    helper.child.send(DICTATION_HELPER_COMMANDS.quit)
    if (this.helper === helper) {
      this.helper = undefined
    }
    helper.quitTimer = setTimeout(() => {
      helper.quitTimer = undefined
      helper.child.kill()
    }, DICTATION_QUIT_GRACE_MS)
  }

  /** The user pressed the microphone (or Ctrl+D) while idle. */
  public start(): void {
    if (this.isDisposed || this.status !== 'idle') {
      return
    }
    this.setStatus('starting')
    const helper = this.helper ?? this.spawnHelper()
    this.helper = helper
    if (helper.idleTimer !== undefined) {
      clearTimeout(helper.idleTimer)
      helper.idleTimer = undefined
    }
    if (helper.isReady) {
      // A "start" while the previous "stop" is still finishing is queued by
      // the helper itself, so it is sent right away either way.
      helper.child.send(DICTATION_HELPER_COMMANDS.start)
    } else {
      helper.isStartWanted = true
    }
  }

  /** The user released a held button, or tapped it while listening. */
  public stop(): void {
    const helper = this.helper
    if (helper === undefined || this.status === 'idle') {
      return
    }
    if (!helper.isReady) {
      // Cancelled before the engine even loaded: nothing was ever sent.
      helper.isStartWanted = false
      this.setStatus('idle')
      this.armIdleExit(helper)
      return
    }
    helper.child.send(DICTATION_HELPER_COMMANDS.stop)
    helper.isStopping = true
    // The button reads idle at once; the phrase in flight still arrives.
    this.setStatus('idle')
    helper.stopTimer = setTimeout(() => {
      helper.stopTimer = undefined
      if (!helper.isStopping) {
        return
      }
      this.deps.log.warn('Dictation helper did not confirm the stop; restarting it')
      this.fail(helper, 'The dictation helper stopped responding')
    }, DICTATION_STOP_GRACE_MS)
  }

  public dispose(): void {
    this.isDisposed = true
    const helper = this.helper
    if (helper === undefined) {
      return
    }
    this.forget(helper)
    helper.isQuitting = true
    helper.child.kill()
    this.status = 'idle'
  }
}
