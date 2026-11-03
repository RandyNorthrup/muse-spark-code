// RESOURCEHARNESS: the scaffolding the resource-governor suites share. One
// copy lives here so the suites stay free of clones: the manual clock that
// holds governor windows deterministic, the settling guard for admitted
// work, the native helper build, and the process-table watch that proves a
// retired helper child is really gone. Everything observed here is real:
// live OS counters, real child processes, real pgrep reads.
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'
import type { ResourceProbeLimits } from '../../src/core/resources/sampler/system'
import { RESOURCE_DARWIN_HEADROOM_LIBUV_MIN_MINOR } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { ResourceClock } from '../../src/shared/resources'

/** The clock the governor suites hold manually; advancing it moves windows. */
export function manualClock() {
  let nowMs = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const clock: ResourceClock = {
    now: () => nowMs,
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timers.add(timer)
      return () => {
        clearTimeout(timer)
        timers.delete(timer)
      }
    },
  }
  return {
    clock,
    advance: (ms: number) => {
      nowMs += ms
    },
    clear: () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}

/** A wait that fails loudly instead of hanging the suite past its timeout. */
export function granted<T>(promise: Promise<T>, what: string, why: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`resource ${what} ${why}`))
      }, 2000)
    }),
  ])
}

/**
Compiles the shipped helper C source to a throwaway binary: the same file
the signed helper builds from, so the reader under test drives real Mach
VM answers. Darwin-only callers; anyone else must not call this.
*/
export async function compileHelper(prefix: string): Promise<{ folder: string; binary: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), prefix))
  const binary = path.join(folder, 'memory')
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DMUSE_CREATED_STANDALONE',
      '-arch',
      'x86_64',
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0',
      path.resolve('native/darwin/MuseSparkCreated.c'),
      '-o',
      binary,
    ],
    {
      env: {
        PATH: '/usr/bin:/bin',
        TMPDIR: folder,
        // The toolchain lookup (not the helper) may need this: without it a
        // machine whose xcode-select names a missing Xcode cannot drive cc.
        ...(process.env['DEVELOPER_DIR'] !== undefined && {
          DEVELOPER_DIR: process.env['DEVELOPER_DIR'],
        }),
      },
    },
  )
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', binary], { env: {} })
  return { folder, binary }
}

/**
The memory reader a live sampler needs on macOS before libuv 1.52 (Node
22, CI's runtime): `process.availableMemory` there reports free pages
alone, so the product reads headroom from its packaged helper, which a
suite running from source must compile and pass explicitly — one reader
per sampler, made by `reader` (a sampler disposes its reader). Undefined
where libuv reports headroom itself or off macOS; `remove` deletes the
compiled fixture once every sampler is disposed.
*/
async function darwinSamplerMemory(limits: ResourceProbeLimits): Promise<{
  reader: () => DarwinMemoryReader | undefined
  remove: () => Promise<void>
}> {
  const [major = 0, minor = 0] = process.versions.uv.split('.').map(Number)
  const requiresHelper =
    process.platform === 'darwin' && major === 1 && minor < RESOURCE_DARWIN_HEADROOM_LIBUV_MIN_MINOR
  if (!requiresHelper) return { reader: () => undefined, remove: () => Promise.resolve() }
  const { folder, binary } = await compileHelper('resource-darwin-memory-')
  return {
    reader: () => new DarwinMemoryReader(limits, binary),
    remove: async () => {
      await rm(folder, { recursive: true, force: true })
    },
  }
}

/**
What a suite of live samplers starts with: the UI text, its probe limits, and
`darwinSamplerMemory` compiled before its first case and removed after its last.
*/
export function liveSamplerSuite(): {
  readonly limits: ResourceProbeLimits
  readonly memoryReader: () => DarwinMemoryReader | undefined
} {
  setUiText(EN, 'en')
  const limits = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }
  let compiled: Awaited<ReturnType<typeof darwinSamplerMemory>> | undefined
  beforeAll(async () => {
    compiled = await darwinSamplerMemory(limits)
  })
  afterAll(async () => {
    await compiled?.remove()
  })
  return { limits, memoryReader: () => compiled?.reader() }
}

/** PIDs whose full command line names this run's helper binary. */
export function helperPids(binary: string): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('/usr/bin/pgrep', ['-f', binary], (error, stdout) => {
      if (error !== null) {
        resolve([])
        return
      }
      resolve(
        stdout
          .split('\n')
          .map(Number)
          .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
      )
    })
  })
}

/** Waits until no helper child names the binary, failing loudly when one lingers. */
export async function settledGone(binary: string): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    const running = await helperPids(binary)
    if (running.length === 0) return
    if (Date.now() - startedAt > 5000) throw new Error('helper child outlived disposal')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
