// Runs web fetch's HTML converter on a worker thread (M69, PLAN.md D49):
// the bundled dist/pageWorker.js, started for each page (never at
// activation). Each worker is stopped when it passes
// WEB_FETCH_CONVERT_TIMEOUT_MS, when its heap passes
// WEB_FETCH_CONVERT_MAX_HEAP_MIB, or when the fetch is stopped, and at most
// WEB_FETCH_CONVERT_MAX_WORKERS run at once in the window, so subagents
// fetching together wait their turn instead of multiplying the heap. The
// extension host itself never parses a page. A failure's detail is a short
// code (it is shown inside a translated sentence); its diagnosis (the
// error's name, code and top stack frames, never its message) goes to the
// log.

import { Worker, type WorkerOptions } from 'node:worker_threads'
import * as z from 'zod/mini'
import type { HtmlConversion, HtmlConverter, HtmlJob } from '../../core/web/htmlConversion'
import {
  WEB_FETCH_CONVERT_MAX_HEAP_MIB,
  WEB_FETCH_CONVERT_MAX_WORKERS,
  WEB_FETCH_CONVERT_TIMEOUT_MS,
} from '../../shared/constants'
import type { Logger } from '../logger'

// Node's code for a worker stopped at its heap limit.
const OUT_OF_MEMORY = 'ERR_WORKER_OUT_OF_MEMORY'
// The failure details, codes rather than words.
const STOPPED = 'STOPPED'
const BAD_ANSWER = 'BAD_ANSWER'
const UNKNOWN_ERROR = 'ERROR'
const EXIT_PREFIX = 'EXIT_'
const STACK_FRAME = /^\s+at /
const LOGGED_FRAMES = 3

// What the worker posts, checked at the thread boundary (AGENTS.md rule 7).
const CONVERSION = z.union([
  z.object({
    ok: z.literal(true),
    page: z.object({
      title: z.optional(z.string()),
      markdown: z.string(),
      isTruncated: z.boolean(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    kind: z.enum(['timeout', 'memory', 'failed', 'undecodable']),
    detail: z.string(),
  }),
])

/** How long, and with how much heap, a page may take to convert. */
export interface ConverterLimits {
  readonly timeoutMs: number
  readonly maxHeapMib: number
}

const LIMITS: ConverterLimits = {
  timeoutMs: WEB_FETCH_CONVERT_TIMEOUT_MS,
  maxHeapMib: WEB_FETCH_CONVERT_MAX_HEAP_MIB,
}

/** Starts a worker: Node's, or a test's that watches it. */
export type StartWorker = (path: string, options: WorkerOptions) => Worker

function startNodeWorker(path: string, options: WorkerOptions): Worker {
  return new Worker(path, options)
}

/** The conversions allowed at once; a wait for a slot ends when the fetch is stopped. */
export class ConversionSlots {
  private running = 0
  private readonly waiting: (() => void)[] = []

  public constructor(private readonly size: number) {}

  /** Takes a slot; false when the signal stopped the wait first. */
  public async take(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      return false
    }
    if (this.running < this.size) {
      this.running += 1
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort)
        this.running += 1
        resolve(true)
      }
      const onAbort = () => {
        const at = this.waiting.indexOf(grant)
        if (at !== -1) {
          this.waiting.splice(at, 1)
        }
        resolve(false)
      }
      this.waiting.push(grant)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  public release(): void {
    this.running -= 1
    this.waiting.shift()?.()
  }
}

// The window's conversions, shared by every fetch (and every subagent's).
const WINDOW_SLOTS = new ConversionSlots(WEB_FETCH_CONVERT_MAX_WORKERS)

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : UNKNOWN_ERROR
}

/** An error as the log may keep it: name, code and top frames; the message can quote the page. */
function diagnosisOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error
  }
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => STACK_FRAME.test(line))
    .slice(0, LOGGED_FRAMES)
    .map((line) => line.trim())
  return [`${error.name} ${codeOf(error)}`, ...frames].join(' | ')
}

/** The converter on the worker bundle at `workerPath`, with the time and memory limits. */
export function pageConverter(
  workerPath: string,
  log: Logger,
  limits = LIMITS,
  startWorker: StartWorker = startNodeWorker,
  slots = WINDOW_SLOTS,
): HtmlConverter {
  return async (job, signal) => {
    if (!(await slots.take(signal))) {
      return { ok: false, kind: 'failed', detail: STOPPED }
    }
    try {
      return await convertOnWorker({ workerPath, job, limits, signal, log, startWorker })
    } finally {
      slots.release()
    }
  }
}

interface Conversion {
  readonly workerPath: string
  readonly job: HtmlJob
  readonly limits: ConverterLimits
  readonly signal: AbortSignal
  readonly log: Logger
  readonly startWorker: StartWorker
}

function convertOnWorker(conversion: Conversion): Promise<HtmlConversion> {
  const { workerPath, job, limits, signal, log, startWorker } = conversion
  return new Promise<HtmlConversion>((resolve) => {
    let worker: Worker
    try {
      worker = startWorker(workerPath, {
        workerData: job,
        resourceLimits: { maxOldGenerationSizeMb: limits.maxHeapMib },
      })
    } catch (error: unknown) {
      log.warn(`Web fetch: the page converter did not start: ${diagnosisOf(error)}`)
      resolve({ ok: false, kind: 'failed', detail: codeOf(error) })
      return
    }
    let isSettled = false
    const settle = (outcome: HtmlConversion) => {
      if (isSettled) {
        return
      }
      isSettled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      void worker.terminate()
      resolve(outcome)
    }
    function onAbort(): void {
      settle({ ok: false, kind: 'failed', detail: STOPPED })
    }
    const timer = setTimeout(() => {
      settle({ ok: false, kind: 'timeout', detail: String(limits.timeoutMs) })
    }, limits.timeoutMs)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.on('message', (message: unknown) => {
      const parsed = CONVERSION.safeParse(message)
      if (!parsed.success) {
        log.warn('Web fetch: the page converter answered in an unknown shape')
        settle({ ok: false, kind: 'failed', detail: BAD_ANSWER })
        return
      }
      const outcome = parsed.data
      settle(
        outcome.ok ? { ok: true, page: { ...outcome.page, title: outcome.page.title } } : outcome,
      )
    })
    worker.on('error', (error: unknown) => {
      const code = codeOf(error)
      if (code !== OUT_OF_MEMORY) {
        log.warn(`Web fetch: the page converter failed: ${diagnosisOf(error)}`)
      }
      settle({ ok: false, kind: code === OUT_OF_MEMORY ? 'memory' : 'failed', detail: code })
    })
    worker.on('exit', (code: number) => {
      if (!isSettled) {
        log.warn(`Web fetch: the page converter exited with code ${String(code)}`)
      }
      settle({ ok: false, kind: 'failed', detail: `${EXIT_PREFIX}${String(code)}` })
    })
  })
}
