// The Windows adapter's awaited assembly is simulated; refusal starts no process.
// The ordinary POSIX/Windows positive runs only the installed local shell.
import * as childProcess from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolIo } from '../../src/host/backend/toolIo'
import { SHELL_DEFAULT_TIMEOUT_MS } from '../../src/shared/constants'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  return {
    ...actual,
    existsSync: (file: Parameters<typeof actual.existsSync>[0]) =>
      (typeof file === 'string' && file.includes('absent-windows')) || actual.existsSync(file),
  }
})

vi.mock('node:child_process', { spy: true })

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function rootDirectory() {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-command-admission-'))
  roots.push(root)
  return root
}

function localIo() {
  return createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    env: () => ({ PATH: process.env['PATH'] }),
    listFiles: () => Promise.resolve([]),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
  })
}

describe('native command final owner admission', () => {
  it('refuses after the held Windows assembly before any process entry', async () => {
    const root = rootDirectory()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const spawn = vi.mocked(childProcess.spawn)
    let isAllowed = true
    const io = createToolIo({
      platform: 'win32',
      systemRoot: path.join(root, 'absent-windows'),
      env: () => ({}),
      listFiles: () => Promise.resolve([]),
      searchWorkerPath: 'unused',
      log: () => undefined,
      unsavedFiles: () => [],
      shellJobAssembly: async () => {
        entered.resolve(undefined)
        await release.promise
        return undefined
      },
    })
    const pending = io.runShell(
      'Write-Output admitted',
      root,
      SHELL_DEFAULT_TIMEOUT_MS,
      new AbortController().signal,
      undefined,
      () => {
        if (!isAllowed) throw new Error('Owned command admission expired')
      },
    )
    try {
      await entered.promise
      isAllowed = false
      release.resolve(undefined)
      expect(await pending).toMatchObject({
        isCancelled: true,
        isWorkspaceShutdownProven: true,
        isEntryRefused: true,
      })
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      release.resolve(undefined)
    }
  })

  it('runs a real unchanged local shell command with the final callback', async () => {
    const root = rootDirectory()
    const guard = vi.fn()
    const io = localIo()
    const command = process.platform === 'win32' ? 'Write-Output admitted' : 'printf admitted'
    const result = await io.runShell(
      command,
      root,
      SHELL_DEFAULT_TIMEOUT_MS,
      new AbortController().signal,
      undefined,
      guard,
    )
    expect(guard).toHaveBeenCalledOnce()
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('admitted')
  })

  it('proves no process exists when spawn itself throws, and keeps the failure', async () => {
    const root = rootDirectory()
    // A real NUL byte: Node refuses the argument before any process exists.
    const nul = await localIo().runShell('a\0b', root, SHELL_DEFAULT_TIMEOUT_MS)
    expect(nul).toMatchObject({
      exitCode: null,
      isTimedOut: false,
      isCancelled: false,
      isWorkspaceShutdownProven: true,
    })
    expect(nul.stderr).not.toBe('')
    // A command line past the operating system's limit (ENAMETOOLONG, E2BIG).
    vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
      throw Object.assign(new Error('spawn ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
    })
    expect(await localIo().runShell('echo', root, SHELL_DEFAULT_TIMEOUT_MS)).toMatchObject({
      stderr: 'spawn ENAMETOOLONG',
      exitCode: null,
      isWorkspaceShutdownProven: true,
    })
  })

  it('gives no proof to an error that arrives after the real process launched', async () => {
    const root = rootDirectory()
    const actual = await vi.importActual<typeof childProcess>('node:child_process')
    let launched: childProcess.ChildProcess | undefined
    vi.mocked(childProcess.spawn).mockImplementationOnce((...args) => {
      launched = actual.spawn(...args)
      // Node's own error event for a launched child (a failed kill, say): its
      // pid is set, so the process exists and nothing proves it stopped.
      launched.once('spawn', () => {
        launched?.emit('error', new Error('a late error'))
      })
      return launched
    })
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 2' : 'sleep 2'
    try {
      const result = await localIo().runShell(command, root, SHELL_DEFAULT_TIMEOUT_MS)
      expect(launched?.pid).toBeDefined()
      expect(result).toMatchObject({ exitCode: null, stderr: 'a late error' })
      expect(result.isWorkspaceShutdownProven).toBeUndefined()
    } finally {
      // Ours to end: the folder cannot be removed while it still holds it.
      const child = launched
      if (child?.exitCode === null && child.signalCode === null) {
        const exited = Promise.withResolvers<undefined>()
        child.once('exit', () => {
          exited.resolve(undefined)
        })
        child.kill()
        await exited.promise
      }
    }
  })

  it('keeps a real started-then-cancelled shell distinct from entry refusal', async () => {
    const root = rootDirectory()
    const started = Promise.withResolvers<undefined>()
    const actual = await vi.importActual<typeof childProcess>('node:child_process')
    vi.mocked(childProcess.spawn).mockImplementationOnce((...args) => {
      const child = actual.spawn(...args)
      child.once('spawn', () => {
        started.resolve(undefined)
      })
      return child
    })
    const stop = new AbortController()
    const io = localIo()
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10'
    const pending = io.runShell(command, root, SHELL_DEFAULT_TIMEOUT_MS, stop.signal)
    try {
      await started.promise
      stop.abort()
      const result = await pending
      expect(result.isCancelled).toBe(true)
      expect(result.isEntryRefused).toBeUndefined()
    } finally {
      stop.abort()
      await pending
    }
  })
})
