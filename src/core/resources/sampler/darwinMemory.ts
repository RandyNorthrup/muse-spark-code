import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  RESOURCE_DARWIN_HEADROOM_MAX_BYTES,
  RESOURCE_DARWIN_HEADROOM_MAX_COUNTER,
  RESOURCE_PROBE_EMPTY_ENV_KEYS,
  darwinDictationHelperSegments,
} from '../../../shared/constants'
import type { ResourceProbeLimits } from './system'

const responseSchema = z.strictObject({
  availableBytes: z.number().check(z.int(), z.gte(0), z.lte(RESOURCE_DARWIN_HEADROOM_MAX_COUNTER)),
})

/** Older libuv only: one idle, request-driven native child owned by its sampler. */
export class DarwinMemoryReader {
  private child: ChildProcessWithoutNullStreams | undefined
  private failed = false
  private disposed = false
  private pending: Promise<number | null> | undefined
  private finish: ((value: number | null) => void) | undefined
  private output = Buffer.alloc(0)

  constructor(
    private readonly limits: ResourceProbeLimits,
    // The packaged signed helper beside dist/native, inside its architecture's
    // .app; callers (and tests) pass an explicit executable anywhere else.
    private readonly helper = path.join(
      __dirname,
      '..',
      'native',
      ...darwinDictationHelperSegments(process.arch),
    ),
  ) {}

  private fail(): void {
    this.failed = true
    this.output = Buffer.alloc(0)
    this.finish?.(null)
    // Sampling infrastructure only; SIGKILL bounds retirement even if the helper stalls.
    this.child?.kill('SIGKILL')
  }

  private start(): ChildProcessWithoutNullStreams {
    const env: NodeJS.ProcessEnv = {}
    for (const key of RESOURCE_PROBE_EMPTY_ENV_KEYS) env[key] = ''
    // nosemgrep: detect-child-process — fixed packaged sampler mode, absolute path, no credentials/workspace input; PLAN §8.
    const child = spawn(this.helper, ['--memory-headroom'], {
      cwd: tmpdir(),
      env,
      shell: false,
      windowsHide: true,
      stdio: 'pipe',
    })
    this.child = child
    this.failed = false
    child.on('error', () => {
      this.fail()
    })
    child.stdin.on('error', () => {
      this.fail()
    })
    child.stdout.on('error', () => {
      this.fail()
    })
    // No helper-chosen text is logged or retained.
    child.stderr.on('data', () => {
      this.fail()
    })
    child.stderr.on('error', () => {
      this.fail()
    })
    child.on('close', () => {
      this.fail()
      this.child = undefined
    })
    child.stdout.on('data', (chunk: Buffer) => {
      if (
        this.failed ||
        this.finish === undefined ||
        this.output.length + chunk.length >
          Math.min(this.limits.maxOutputBytes, RESOURCE_DARWIN_HEADROOM_MAX_BYTES)
      ) {
        this.fail()
        return
      }
      this.output = Buffer.concat([this.output, chunk])
      const newline = this.output.indexOf('\n')
      if (newline === -1) return
      try {
        if (newline !== this.output.length - 1) {
          this.fail()
          return
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(this.output)
        const frame: unknown = JSON.parse(text)
        const result = responseSchema.safeParse(frame)
        if (result.success) this.finish(result.data.availableBytes)
        else this.fail()
      } catch {
        this.fail()
      }
    })
    return child
  }

  read(): Promise<number | null> {
    if (this.disposed || (this.child !== undefined && this.failed) || !path.isAbsolute(this.helper))
      return Promise.resolve(null)
    if (this.pending !== undefined) return this.pending
    // Install the shared request before starting/writing; all failures settle it exactly once.
    const pending = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.fail()
      }, this.limits.timeoutMs)
      timer.unref()
      this.output = Buffer.alloc(0)
      this.finish = (value) => {
        clearTimeout(timer)
        this.finish = undefined
        this.pending = undefined
        this.output = Buffer.alloc(0)
        resolve(value)
      }
    })
    this.pending = pending
    try {
      const child = this.child ?? this.start()
      child.stdin.write('sample\n')
    } catch {
      this.fail()
    }
    return pending
  }

  dispose(): void {
    this.disposed = true
    this.fail()
  }
}
