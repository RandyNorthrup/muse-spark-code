// The job helper as a program of its own (MuseSparkJobHost in
// native/windows/MuseSparkJob.cs, run through windowsJobHost): the resource
// governor's tree reads, its job holder and its created-path registry, the
// team workers' file commands, the playbook's end of a job by name and the
// legacy shell stop call it where each used to start Windows PowerShell (the
// playbook's contained job and the team worker launch have their own suites).
// The environment it starts with is read back here too. The real helper is built
// through the product's own builder into a temporary folder. Each answer is
// compared with what PowerShell prints for the same call on the same file
// (the type PowerShell loads), because that text is what the readers parse.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { windowsJobHost, windowsPowerShell } from '../../src/core/execGuard'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import { loadJobAssembly } from '../../src/host/processTree'
import {
  WORKER_HELPER_FAILED_PREFIX,
  WORKER_REFUSAL_PREFIX,
} from '../../src/core/team/workers/workerOps'
import {
  SHELL_JOB_NAME_PREFIX,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../src/shared/constants'
import { buildShellJobHelper } from './helpers/shellJobBuild'
import { removeFolder } from './helpers/temporaryFolders'

const BUILD_MS = 120_000
const CASE_MS = 60_000
const IMPOSSIBLE_PID = 2 ** 30
const byName = (a: string, b: string): number => a.localeCompare(b)
/**
The variables Node's process start on Windows (libuv's `make_program_env`,
src/win/process.c `required_vars`) copies from the starting process into
a child's environment whenever the given environment lacks them.
*/
const LIBUV_REQUIRED_VARIABLES = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]

describe.runIf(process.platform === 'win32')('the job helper run as a program', () => {
  const systemRoot = process.env['SystemRoot'] ?? ''
  let storageDir = ''
  let assembly = ''

  beforeAll(async () => {
    const built = await buildShellJobHelper('muse-job-host-', systemRoot)
    storageDir = built.storageDir
    assembly = built.assembly
  }, BUILD_MS)
  afterAll(async () => {
    await removeFolder(storageDir)
  })

  /** What the helper program prints for one command. */
  async function printed(...command: string[]): Promise<string> {
    const host = windowsJobHost(assembly, systemRoot)
    const text = await runTreeProgram(host.file, command, host.env)
    return text.trim()
  }

  /** A job holder (`hold`) that has said it holds the job; it ends on `end`. */
  async function holding(name: string): Promise<{
    readonly holder: ChildProcessWithoutNullStreams
    readonly exited: Promise<number | null>
  }> {
    const host = windowsJobHost(assembly, systemRoot)
    const holder = spawn(host.file, ['hold', name], {
      env: host.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let said = ''
    holder.stdout.setEncoding('utf8')
    holder.stdout.on('data', (chunk: string) => {
      said += chunk
    })
    const exited = new Promise<number | null>((resolve) => {
      holder.once('close', resolve)
    })
    const deadline = Date.now() + CASE_MS / 2
    while (said.trim() !== 'held') {
      if (Date.now() > deadline) {
        holder.kill()
        throw new Error(`the holder never said held (${said})`)
      }
      await delay(50)
    }
    return { holder, exited }
  }

  /** What Windows PowerShell prints for the same call on the same file. */
  async function powerShellPrinted(call: string): Promise<string> {
    const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
    const text = await runTreeProgram(
      powershell.file,
      [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `try { ${loadJobAssembly(assembly)}; ${call} } catch { exit 1 }`,
      ],
      powershell.env,
    )
    return text.trim()
  }

  it(
    'answers its self-test, and nothing for a command it does not know or a call it cannot make',
    async () => {
      expect(await printed('--self-test')).toBe('muse-spark-job-host-ready')
      const host = windowsJobHost(assembly, systemRoot)
      for (const command of [
        [],
        ['unknown'],
        ['identity'],
        ['identity', 'not-a-pid'],
        ['created'],
      ]) {
        await expect(runTreeProgram(host.file, command, host.env)).rejects.toMatchObject({
          cause: { code: 1 },
        })
      }
    },
    CASE_MS,
  )

  it(
    'reads a process identity and a missing job as PowerShell prints them',
    async () => {
      const identity = await printed('identity', String(process.pid))
      expect(JSON.parse(identity)).toMatchObject({ pid: process.pid })
      expect(identity).toBe(
        await powerShellPrinted(`[${SHELL_JOB_TYPE_NAME}]::Identity(${String(process.pid)})`),
      )
      expect(await printed('identity', String(IMPOSSIBLE_PID))).toBe('null')
      const gone = `${SHELL_JOB_NAME_PREFIX}absent`
      expect(await printed('query', gone)).toBe('null')
      expect(await printed('contains', gone, String(process.pid), '1')).toBe('false')
      expect(await printed('signal', gone, String(process.pid), '1', 'true')).toBe('"gone"')
      expect(await printed('read-rate', gone, String(process.pid), '1')).toBe('null')
      expect(await printed('read-priority', gone, String(process.pid), '1')).toBe('null')
    },
    CASE_MS,
  )

  it(
    'terminates a job by name and says whether it was there; ends an absent job as over',
    async () => {
      const name = `${SHELL_JOB_NAME_PREFIX}host-terminate-${String(process.pid)}`
      const { holder, exited } = await holding(name)
      try {
        // The legacy shell stop's call (processTree.ts): the job was there.
        expect(await printed('terminate', name, '1')).toBe('true')
        // The playbook's end by name: an emptied job counts as over.
        expect(await printed('end-job', name, '5000', '10')).toBe('')
        holder.stdin.end('end\n')
        expect(await exited).toBe(0)
        // Gone: nothing to terminate, and a job that does not exist is over.
        expect(await printed('terminate', name, '1')).toBe('false')
        expect(await printed('end-job', name, '5000', '10')).toBe('')
      } finally {
        if (holder.exitCode === null) holder.kill()
      }
    },
    CASE_MS,
  )

  it(
    'answers a worker file command only for a worker operation, with its own failure lines',
    async () => {
      const host = windowsJobHost(assembly, systemRoot)
      const failure = (args: readonly string[]) =>
        new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
          const child = spawn(host.file, [...args], {
            env: host.env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          let stdout = ''
          let stderr = ''
          child.stdout.setEncoding('utf8')
          child.stderr.setEncoding('utf8')
          child.stdout.on('data', (chunk: string) => {
            stdout += chunk
          })
          child.stderr.on('data', (chunk: string) => {
            stderr += chunk
          })
          child.once('close', (code) => {
            resolve({ code, stderr, stdout })
          })
        })
      // Not a worker operation: the helper-failed line with the type name only.
      expect(await failure(['worker', 'created', 'x'])).toEqual({
        code: 1,
        stdout: '',
        stderr: `${WORKER_HELPER_FAILED_PREFIX}ArgumentException\r\n`,
      })
      // A worker operation the helper refuses: its own reason line, no path.
      const root = String.raw`C:\muse-no-such-worker-root`
      expect(
        await failure(['worker', 'worker-create', root, '1:1', 'src', '2:2', 'new.ts', '']),
      ).toEqual({ code: 1, stdout: '', stderr: `${WORKER_REFUSAL_PREFIX}root unavailable\r\n` })
    },
    CASE_MS,
  )

  it(
    'is given SystemRoot and the guard variable, and Node adds only what Windows requires',
    async () => {
      const host = windowsJobHost(assembly, systemRoot)
      expect(Object.keys(host.env).toSorted(byName)).toEqual([
        'NoDefaultCurrentDirectoryInExePath',
        'SystemRoot',
      ])
      // A variable only this process has, which no helper should see.
      process.env['MUSE_JOB_HOST_PARENT_ONLY'] = 'this process only'
      try {
        // Node's process start is the same for any program: a Node probe
        // started with the helper's environment reports what the helper gets.
        const seen = z
          .record(z.string(), z.string())
          .parse(
            JSON.parse(
              await runTreeProgram(
                process.execPath,
                ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
                host.env,
              ),
            ),
          )
        const present = new Set(Object.keys(process.env).map((name) => name.toUpperCase()))
        const expected = [
          ...Object.keys(host.env),
          ...LIBUV_REQUIRED_VARIABLES.filter((name) => present.has(name)),
        ].map((name) => name.toUpperCase())
        expect(
          Object.keys(seen)
            .map((name) => name.toUpperCase())
            .toSorted(byName),
        ).toEqual([...new Set(expected)].toSorted(byName))
        expect(seen['SystemRoot']).toBe(systemRoot)
        expect(seen['NoDefaultCurrentDirectoryInExePath']).toBe('1')
        // The required ones carry this process's own values: its whole PATH.
        expect(seen['PATH']).toBe(process.env['PATH'])
      } finally {
        delete process.env['MUSE_JOB_HOST_PARENT_ONLY']
      }
    },
    CASE_MS,
  )

  it(
    'holds a job until told to end: one holder per name, queryable while it holds',
    async () => {
      const name = `${SHELL_JOB_NAME_PREFIX}host-hold-${String(process.pid)}`
      const { holder, exited } = await holding(name)
      try {
        // An empty job exists while the holder keeps its handle.
        expect(JSON.parse(await printed('query', name))).toMatchObject({ members: [] })
        // A second holder for the same name is refused.
        await expect(printed('hold', name)).rejects.toMatchObject({ cause: { code: 1 } })
        holder.stdin.end('end\n')
        expect(await exited).toBe(0)
        expect(await printed('query', name)).toBe('null')
      } finally {
        if (holder.exitCode === null) holder.kill()
      }
    },
    CASE_MS,
  )
})
