// A Windows hook starts through the native job launcher when the governor is
// configured (no PowerShell start; the launcher's job is the tree the
// governor reads), and through PowerShell joining a job where it is not.
// Both paths run the same real hook commands through the real tool IO and
// must answer alike: the payload on stdin, the hook's stdout and stderr, its
// exit code, and its whole process tree ended at the deadline. The Tab hook
// bound (1.5 s) is spent on this launch, so what it costs is measured in
// docs/certification/cc-winhook.md.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { createToolIo } from '../../src/host/backend/toolIo'
import { runProgram } from '../../src/host/processTree'
import { configureRuntimeGovernor, type RuntimeGovernor } from './helpers/resources/runtimeGovernor'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

const SUITE_MS = 180_000
const HOOK_MS = 60_000
const DEADLINE_MS = 4000
// A hook that echoes what it was given in a form that shows each stream's
// bytes: UTF-8 survives stdin and stdout, stderr is separate, and the exit
// code is the hook's own (3).
const ECHO_HOOK = `
const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  const given = Buffer.concat(chunks).toString('utf8')
  process.stdout.write('payload:' + given + ':ünï')
  process.stderr.write('noted')
  process.exit(3)
})
`
// A hook that starts a grandchild, tells where, and then waits: the deadline
// has to end both.
const TREE_HOOK = `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' })
writeFileSync(process.argv[2], String(child.pid))
setTimeout(() => {}, 600000)
`

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

async function isEndedWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false
    await delay(100)
  }
  return true
}

describe.runIf(process.platform === 'win32')('a Windows hook launch', () => {
  let folder = ''
  let io: ToolIo
  let echoCommand = ''
  let treeScript = ''

  beforeAll(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'muse-hook-launch-'))
    const echo = path.join(folder, 'echo-hook.mjs')
    treeScript = path.join(folder, 'tree-hook.mjs')
    await writeFile(echo, ECHO_HOOK)
    await writeFile(treeScript, TREE_HOOK)
    echoCommand = `"${process.execPath}" "${echo}"`
    const systemRoot = process.env['SystemRoot'] ?? ''
    const buildLog: string[] = []
    const real = createToolIo({
      platform: process.platform,
      listFiles: () => Promise.resolve([]),
      workspaceRoot: folder,
      systemRoot,
      env: () => process.env,
      searchWorkerPath: '',
      log: (message) => {
        buildLog.push(message)
      },
      unsavedFiles: () => [],
      shellJobAssembly: shellJobAssembly({
        storageDir: path.join(folder, 'storage'),
        systemRoot,
        log: (message) => {
          buildLog.push(message)
        },
        readJobSource,
        // The real execFile runner: a bare test process has no resource host to compile under.
        run: runProgram,
      }),
    })
    if (real.runHook === undefined)
      throw new Error(`the tool IO has no hook runner: ${buildLog.join('; ')}`)
    io = real
  }, HOOK_MS)
  afterAll(async () => {
    await removeFolder(folder)
  })

  /** The same cases on each path: the tool IO answers alike whichever starts the hook. */
  function cases(): void {
    it(
      'gives the hook its payload on stdin and returns its stdout, stderr and exit code',
      async () => {
        const payload = String.raw`{"event":"beforeTabFileRead","text":"café \"quoted\""}`
        const result = await io.runHook?.(echoCommand, payload, folder, HOOK_MS)
        expect(result).toMatchObject({
          stdout: `payload:${payload}:ünï`,
          stderr: 'noted',
          exitCode: 3,
          isTimedOut: false,
          isCancelled: false,
        })
      },
      HOOK_MS,
    )

    it(
      'ends the hook and everything it started at its deadline',
      async () => {
        const record = path.join(folder, `tree-${String(Date.now())}.pid`)
        const result = await io.runHook?.(
          `"${process.execPath}" "${treeScript}" "${record}"`,
          '{}',
          folder,
          DEADLINE_MS,
        )
        expect(result).toMatchObject({ isTimedOut: true })
        const pid = Number(await readFile(record, 'utf8'))
        expect(Number.isSafeInteger(pid)).toBe(true)
        expect(await isEndedWithin(pid, HOOK_MS)).toBe(true)
      },
      HOOK_MS,
    )
  }

  // First: a disposed governor refuses admission for the rest of the process.
  describe('with no governor: PowerShell joining a job', () => {
    cases()
  })

  describe('with the governor configured: the native job launcher', () => {
    let governor: RuntimeGovernor
    beforeAll(async () => {
      governor = await configureRuntimeGovernor('muse-hook-governor-')
    }, SUITE_MS)
    afterAll(async () => {
      await governor.dispose()
    })
    cases()
  })
})
