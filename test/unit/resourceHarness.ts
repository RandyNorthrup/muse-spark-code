// RESOURCEHARNESS: the scaffolding the resource-governor suites share. One
// copy lives here so the suites stay free of clones: the manual clock that
// holds governor windows deterministic, the settling guard for admitted
// work, the native helper build, and the process-table watch that proves a
// retired helper child is really gone. Everything observed here is real:
// live OS counters, real child processes, real pgrep reads.
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
