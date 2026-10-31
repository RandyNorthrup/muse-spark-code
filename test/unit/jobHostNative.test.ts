// The job helper as a program of its own (MuseSparkJobHost in
// native/windows/MuseSparkJob.cs, run through windowsJobHost): the resource
// governor's tree reads, its job holder and its created-path registry call it
// where each used to start Windows PowerShell. The real helper is built
// through the product's own builder into a temporary folder. Each answer is
// compared with what PowerShell prints for the same call on the same file
// (the type PowerShell loads), because that text is what the readers parse.
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { windowsJobHost, windowsPowerShell } from '../../src/core/execGuard'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import { loadJobAssembly } from '../../src/host/processTree'
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
    'holds a job until told to end: one holder per name, queryable while it holds',
    async () => {
      const name = `${SHELL_JOB_NAME_PREFIX}host-hold-${String(process.pid)}`
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
      try {
        const deadline = Date.now() + CASE_MS / 2
        while (said.trim() !== 'held') {
          if (Date.now() > deadline) throw new Error(`the holder never said held (${said})`)
          await delay(50)
        }
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
