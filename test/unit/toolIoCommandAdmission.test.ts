// The Windows adapter's awaited assembly is simulated; refusal starts no process.
// The ordinary POSIX/Windows positive runs only the installed local shell.
import * as childProcess from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolIo } from '../../src/host/backend/toolIo'
import { SHELL_DEFAULT_TIMEOUT_MS, SHELL_JOB_TYPE_NAME } from '../../src/shared/constants'

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
// Real processes carry an explicit timeout: a cold PowerShell start on a hosted
// Windows runner takes longer than the 5 s default (the first run there timed
// out, and its folder was then busy at cleanup).
const REAL_SHELL_TIMEOUT_MS = 60_000
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function rootDirectory() {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-command-admission-'))
  roots.push(root)
  return root
}

function localIo(passNames: readonly string[] = []) {
  return createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    // The whole environment, as the extension host hands the shell tool. A
    // PATH-only one hid PSModuleAnalysisCachePath from Windows PowerShell on
    // GitHub's runner, so `Write-Output`'s module auto-loading analysed every
    // installed module first: 17 to 29 s, and once past this test's deadline.
    env: () => process.env,
    passEnvironmentVariables: () => passNames,
    listFiles: () => Promise.resolve([]),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
  })
}

describe('native command final owner admission', () => {
  it('D89.5 fences the RVENVFENCE credential names in a real unattended shell', async () => {
    const names = ['AZURE_DEVOPS_EXT_PAT', 'SYSTEM_ACCESSTOKEN', 'TF_TOKEN_app_terraform_io']
    for (const name of names) vi.stubEnv(name, `envfence-fake-${name}`)
    vi.stubEnv('TOKENIZERS_PARALLELISM', 'envfence-harmless-tokenizers')
    vi.stubEnv('KEY_PATH', 'envfence-harmless-path')
    try {
      const result = await localIo(names).runShell(
        process.platform === 'win32' ? 'Get-ChildItem Env:' : 'env',
        rootDirectory(),
        REAL_SHELL_TIMEOUT_MS,
      )
      expect(result.exitCode).toBe(0)
      for (const name of names) expect(result.stdout.includes(`envfence-fake-${name}`)).toBe(false)
      expect(result.stdout.includes('envfence-harmless-tokenizers')).toBe(true)
      expect(result.stdout.includes('envfence-harmless-path')).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('D89.5 real-shell environment probe withholds parent credentials unless interactive and named', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'envfence-fake-parent')
    try {
      const io = localIo(['OPENAI_API_KEY'])
      const command = process.platform === 'win32' ? 'Get-ChildItem Env:' : 'env'
      for (const isInteractive of [false, true]) {
        const result = await io.runShell(
          command,
          rootDirectory(),
          REAL_SHELL_TIMEOUT_MS,
          undefined,
          undefined,
          undefined,
          isInteractive,
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout.includes('envfence-fake-parent')).toBe(isInteractive)
      }
      const fenced = await localIo().runShell(
        command,
        rootDirectory(),
        REAL_SHELL_TIMEOUT_MS,
        undefined,
        undefined,
        undefined,
        true,
      )
      expect(fenced.stdout).not.toContain('envfence-fake-parent')
      if (io.runHook === undefined) throw new Error('expected hook IO')
      const hook = await io.runHook(
        process.platform === 'win32' ? 'set' : 'env',
        '{}',
        rootDirectory(),
        REAL_SHELL_TIMEOUT_MS,
        undefined,
        ['OPENAI_API_KEY'],
      )
      expect(hook.exitCode).toBe(0)
      expect(hook.stdout).not.toContain('envfence-fake-parent')
    } finally {
      vi.unstubAllEnvs()
    }
  })

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

  it(
    'runs a real unchanged local shell command with the final callback',
    async () => {
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
    },
    REAL_SHELL_TIMEOUT_MS,
  )

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

  it(
    'gives no proof to an error that arrives after the real process launched',
    async () => {
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
    },
    REAL_SHELL_TIMEOUT_MS,
  )

  it(
    'keeps a real started-then-cancelled shell distinct from entry refusal',
    async () => {
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
    },
    REAL_SHELL_TIMEOUT_MS,
  )
})

function windowsIo(assembly: string | undefined) {
  return createToolIo({
    platform: 'win32',
    systemRoot: path.join(rootDirectory(), 'absent-windows'),
    env: () => ({}),
    listFiles: () => Promise.resolve([]),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
    shellJobAssembly: () => Promise.resolve(assembly),
  })
}

type WindowsIo = ReturnType<typeof windowsIo>

/** The script the shell would have started, with no process entered. */
async function startedScript(
  run: (io: WindowsIo) => Promise<unknown>,
  assembly: string | undefined,
): Promise<string> {
  const spawn = vi.mocked(childProcess.spawn).mockImplementation(() => {
    throw new Error('no process in this test')
  })
  spawn.mockClear()
  try {
    await run(windowsIo(assembly))
  } catch {
    // The blocked spawn fails the run; only its arguments matter here.
  }
  return (spawn.mock.calls.at(-1)?.[1] ?? []).join(' ')
}

const ASSEMBLY = String.raw`C:\jobs\MuseSparkJob-test.dll`
const shell = (io: WindowsIo) =>
  io.runShell(
    'Write-Output joined',
    rootDirectory(),
    SHELL_DEFAULT_TIMEOUT_MS,
    new AbortController().signal,
  )
const hook = async (io: WindowsIo) => {
  const runHook = io.runHook
  if (runHook === undefined) throw new Error('this io runs no hooks')
  return await runHook(
    'echo joined',
    '{}',
    rootDirectory(),
    SHELL_DEFAULT_TIMEOUT_MS,
    new AbortController().signal,
  )
}

describe('Windows commands join their job (M27)', () => {
  it.each([
    ['a shell command', shell],
    ['a hook', hook],
  ] as const)(
    'starts %s by joining its job when the helper is there, and without one when it is not',
    async (_kind, run) => {
      const joined = await startedScript(run, ASSEMBLY)
      expect(joined).toContain(`[${SHELL_JOB_TYPE_NAME}]::Join(`)
      expect(joined).toContain(ASSEMBLY)
      const alone = await startedScript(run, undefined)
      // Without a helper the command still starts, just outside a job.
      expect(alone).toContain('joined')
      expect(alone).not.toContain(SHELL_JOB_TYPE_NAME)
    },
  )
})
