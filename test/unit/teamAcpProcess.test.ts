import { TEAM_WORKER_PROMPT } from './helpers/teamWorkerPrompt'
// The ACP agent's process (M96 lane W): the PATH lookup, the scrubbed
// spawn, the Install command, and the SDK adapter against the fake ACP
// agent over real stdio.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { RequestError, type AuthMethod } from '@agentclientprotocol/sdk'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ACP_PRESET_INSTALLS,
  buildPresetInstallCommand,
  connectAcpAgent,
  findAcpPresetCommand,
  runTerminalSignIn,
  spawnAcpAgent,
  updateTextOf,
  asAcpSdkError,
  AcpUserServersSwitchError,
  type AcpClientHandlers,
  type TeamChildProcess,
} from '../../src/host/team/acpProcess'
import {
  ACP_PRESETS,
  answerAcpPermission,
  acpFsRead,
  acpFsWrite,
  pickOnceOption,
  runAcpWorker,
  AcpAuthRequiredError,
  AcpModelSelectionError,
  type AcpAgentConnection,
} from '../../src/core/team/workers/acpWorker'
import type { WorkerRolePolicy, WorkerTask } from '../../src/core/team/workers/workerTypes'
import { FakeLogOutputChannel } from './helpers/fakes'

const FAKE_AGENT = new URL('helpers/fakeTeamAcpAgent.mjs', import.meta.url)

const WRITER: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'shell', 'skills', 'report'],
  reportShape: 'summary',
}

describe('findAcpPresetCommand', () => {
  const files = new Set(['/tools/bin/claude-agent-acp', '/tools/bin/codex-acp.exe'])

  it('finds a preset on the PATH', () => {
    expect(
      findAcpPresetCommand(ACP_PRESETS.claude, 'linux', ['/tools/bin'], (file) => files.has(file)),
    ).toBe('/tools/bin/claude-agent-acp')
  })

  it('tries Windows executable extensions', () => {
    const windowsFiles = new Set([String.raw`C:\tools\bin\codex-acp.exe`])
    expect(
      findAcpPresetCommand(ACP_PRESETS.codex, 'win32', [String.raw`C:\tools\bin`], (file) =>
        windowsFiles.has(file),
      ),
    ).toBe(String.raw`C:\tools\bin\codex-acp.exe`)
  })

  it('returns undefined when no entry holds the command', () => {
    expect(
      findAcpPresetCommand(ACP_PRESETS.gemini, 'linux', ['/empty', ''], (file) => files.has(file)),
    ).toBeUndefined()
  })
})

describe('buildPresetInstallCommand', () => {
  it('pins the registry package at its version for the modal', () => {
    const install = ACP_PRESET_INSTALLS.claude
    if (install === undefined) {
      throw new Error('expected a Claude install source')
    }
    expect(buildPresetInstallCommand(install, '0.85.1')).toEqual({
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp@0.85.1'],
    })
  })

  it('has no install source for the bundled and self-installed agents', () => {
    expect(ACP_PRESET_INSTALLS.own).toBeUndefined()
    expect(ACP_PRESET_INSTALLS.gemini).toBeUndefined()
  })
})

function launcherWith(seen: {
  command?: string
  args?: readonly string[]
  env?: NodeJS.ProcessEnv
}) {
  return {
    spawn: (input: {
      command: string
      args: readonly string[]
      cwd: string
      env: NodeJS.ProcessEnv
    }) => {
      seen.command = input.command
      seen.args = input.args
      seen.env = input.env
      const child: TeamChildProcess = {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        wait: () => Promise.resolve({ exitCode: 0 }),
        kill: () => undefined,
      }
      return Promise.resolve(child)
    },
  }
}

describe('spawnAcpAgent', () => {
  it('scrubs credentials and carries the launch marker', async () => {
    const seen: { command?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv } = {}
    await spawnAcpAgent({
      preset: { ...ACP_PRESETS.codex, withoutUserServersSwitch: ['--fake-without-user-servers'] },
      command: '/tools/bin/codex-acp',
      cwd: '/work/copy',
      workspaceRoot: '/user/checkout',
      io: { realPath: (given) => Promise.resolve(given) },
      baseEnv: { PATH: '/bin', META_API_KEY: 'key-1', TEAM: 'x' },
      platform: 'linux',
      passthrough: [],
      launchId: 'launch-1',
      launcher: launcherWith(seen),
    })
    expect(seen.command).toBe('/tools/bin/codex-acp')
    expect(seen.args).toEqual(['--fake-without-user-servers'])
    expect(seen.env?.['META_API_KEY']).toBeUndefined()
    expect(seen.env?.['TEAM']).toBeUndefined()
    expect(seen.env?.['MUSE_SPARK_LAUNCH_ID']).toBe('launch-1')
    expect(seen.env?.['GIT_TERMINAL_PROMPT']).toBe('0')
  })

  it('RVM96A-8 refuses startup by default until native-server exclusion is captured', async () => {
    const seen: { command?: string } = {}
    await expect(
      spawnAcpAgent({
        preset: ACP_PRESETS.claude,
        command: '/tools/bin/claude-agent-acp',
        cwd: '/work/copy',
        workspaceRoot: '/user/checkout',
        io: { realPath: (given) => Promise.resolve(given) },
        baseEnv: {},
        platform: 'linux',
        launchId: 'launch-1',
        launcher: launcherWith(seen),
      }),
    ).rejects.toBeInstanceOf(AcpUserServersSwitchError)
    expect(seen.command).toBeUndefined()
  })

  it('RVM96A-4 refuses a checkout alias before spawning the process', async () => {
    const seen: { command?: string } = {}
    await expect(
      spawnAcpAgent({
        preset: { ...ACP_PRESETS.codex, withoutUserServersSwitch: ['--fake-without-user-servers'] },
        command: '/fake/codex-acp',
        cwd: '/alias',
        workspaceRoot: '/repo',
        io: { realPath: () => Promise.resolve('/repo') },
        baseEnv: {},
        platform: 'linux',
        launchId: 'l',
        launcher: launcherWith(seen),
      }),
    ).rejects.toThrow()
    expect(seen.command).toBeUndefined()
  })
})

describe('runTerminalSignIn', () => {
  it('runs the agent interactively and reports its exit', async () => {
    const seen: string[] = []
    const exitCode = await runTerminalSignIn({
      command: 'codex-acp',
      args: ['login'],
      terminal: {
        runInteractive: (command, args) => {
          seen.push(`${command} ${args.join(' ')}`)
          return Promise.resolve({ exitCode: 0 })
        },
      },
    })
    expect(seen).toEqual(['codex-acp login'])
    expect(exitCode).toEqual({ exitCode: 0 })
  })
})

describe('updateTextOf', () => {
  it('RVM96A-15 parses the standard SDK object content chunk', () => {
    expect(
      updateTextOf({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }),
    ).toBe('hi')
    for (const update of [
      undefined,
      { text: 'legacy' },
      {
        sessionUpdate: 'agent_message_chunk',
        content: [{ type: 'text', text: 'incorrect-array' }],
      },
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thought' } },
      { sessionUpdate: 'tool_call', content: { type: 'text', text: 'tool-data' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 1 } },
    ]) {
      expect(updateTextOf(update)).toBeUndefined()
    }
  })
})
describe('asAcpSdkError', () => {
  it('RVM96A-16 maps standard authentication-required errors and preserves methods', () => {
    const methods: AuthMethod[] = [
      { id: 'sign-in', name: 'Sign in', type: 'terminal', args: ['login'] },
    ]
    for (const error of [
      RequestError.authRequired(),
      RequestError.authRequired(undefined, 'Please sign in'),
    ]) {
      const mapped = asAcpSdkError(error, 'session/new', methods)
      expect(mapped).toBeInstanceOf(AcpAuthRequiredError)
      if (!(mapped instanceof AcpAuthRequiredError)) throw new Error('missing auth handoff')
      expect(mapped.methods).toEqual(methods)
    }
    const unrelated = new RequestError(-32_000, 'Other failure')
    expect(asAcpSdkError(unrelated, 'session/new', methods)).toBe(unrelated)
  })
})

const children: ChildProcess[] = []
afterAll(async () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill()
    await new Promise((resolve) => {
      child.on('exit', resolve)
      setTimeout(resolve, 2000)
    })
  }
})

function recordsOf(child: ChildProcess): { records: unknown[] } {
  const records: unknown[] = []
  let pending = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = (pending + chunk.toString()).split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('RECORD ')) {
        records.push(JSON.parse(line.slice('RECORD '.length)))
      }
    }
  })
  return { records }
}

/** Waits for the fake's stderr record: the prompt can resolve before the record line arrives. */
async function waitForRecord(
  records: unknown[],
  isWanted: (record: unknown) => boolean,
): Promise<unknown> {
  const started = Date.now()
  for (;;) {
    const found = records.find((record) => isWanted(record))
    if (found !== undefined) {
      return found
    }
    if (Date.now() - started > 5000) {
      throw new Error('timed out waiting for the fake agent record')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function startFake(
  scenario: string,
  cwd: string,
  handlers: AcpClientHandlers,
): { connection: AcpAgentConnection; records: unknown[]; child: ChildProcess } {
  const child = spawn(process.execPath, [fileURLToPath(FAKE_AGENT), scenario, '--cwd', cwd], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  const { records } = recordsOf(child)
  const connection = connectAcpAgent({
    stdin: child.stdin,
    stdout: child.stdout,
    handlers,
    log: new FakeLogOutputChannel(),
    supportsTerminalAuth: true,
    disposeProcess: () => {
      child.kill()
    },
  })
  return { connection, records, child }
}

function policyHandlers(
  role: WorkerRolePolicy,
  folder: string,
  files: { readTextFile: (absolutePath: string) => Promise<string | undefined> },
  onAskUser: () => Promise<'allowOnce' | 'rejectOnce'>,
): AcpClientHandlers {
  const platform = path.posix.isAbsolute(folder) ? 'linux' : 'win32'
  const io = { realPath: (absolutePath: string) => Promise.resolve(absolutePath) }
  const resolveOnce = async (
    toolCall: Parameters<AcpClientHandlers['onPermissionRequest']>[0],
    options: Parameters<AcpClientHandlers['onPermissionRequest']>[1],
  ): Promise<{ readonly optionId: string } | undefined> => {
    const verdict = await answerAcpPermission({
      role,
      folder,
      platform,
      io,
      dialect: 'bash',
      readOnlyCommands: new Set([
        'git diff',
        'git log',
        'git show',
        'git blame',
        'git status',
        'ls',
      ]),
      toolCall,
    })
    let decision: 'allowOnce' | 'rejectOnce' | 'askUser' = verdict.action
    if (decision === 'askUser') {
      decision = await onAskUser()
    }
    const optionId = pickOnceOption(options, decision === 'allowOnce')
    return optionId === undefined ? undefined : { optionId }
  }
  return {
    onPermissionRequest: (toolCall, options) => resolveOnce(toolCall, options),
    onFsRead: (given) =>
      acpFsRead(
        { role, folder, platform, io, ...files, writeTextFile: () => Promise.resolve() },
        given,
      ),
    onFsWrite: (given, content) =>
      acpFsWrite(
        { role, folder, platform, io, ...files, writeTextFile: () => Promise.resolve() },
        given,
        content,
      ),
    onUpdate: () => undefined,
  }
}

function workerDeps(connection: AcpAgentConnection, task: WorkerTask, role: WorkerRolePolicy) {
  const platform: NodeJS.Platform = path.posix.isAbsolute(task.folder) ? 'linux' : 'win32'
  const paths = platform === 'win32' ? path.win32 : path.posix
  return {
    task,
    role,
    preset: ACP_PRESETS.claude,
    modelId: 'explicit-selected-model',
    signal: new AbortController().signal,
    prompt: TEAM_WORKER_PROMPT,
    workspaceRoot: paths.join(paths.parse(task.folder).root, 'user', 'checkout'),
    nativeServersExcluded: true,
    isTrusted: true,
    io: {
      realPath: (absolutePath: string) => Promise.resolve(absolutePath),
      readTextFile: () => Promise.resolve(undefined),
    },
    platform,
    bridgeServers: [],
    connection,
  }
}

async function expectPermissionSelection(records: unknown[], optionId: string): Promise<void> {
  const answer = await waitForRecord(
    records,
    (record) => typeof record === 'object' && record !== null && 'permissionAnswer' in record,
  )
  expect(answer).toEqual({ permissionAnswer: { outcome: { outcome: 'selected', optionId } } })
}

function taskIn(folder: string, taskId: string): WorkerTask {
  return {
    taskId,
    roleId: 'engineering',
    brief: 'Do it.',
    branch: `agents/engineering/${taskId}`,
    folder,
    files: [],
  }
}
function emptyPolicyHandlers(
  folder: string,
  onAskUser: () => Promise<'allowOnce' | 'rejectOnce'> = () => Promise.resolve('rejectOnce'),
): AcpClientHandlers {
  return policyHandlers(
    WRITER,
    folder,
    { readTextFile: () => Promise.resolve(undefined) },
    onAskUser,
  )
}

describe('the full stack against the fake agent', () => {
  it('RVM96A-19 closes the owned ACP child through the launcher callback', async () => {
    const { connection, child } = startFake(
      'report',
      '/work/copy',
      emptyPolicyHandlers('/work/copy'),
    )
    try {
      await connection.initialize()
      connection.close()
      expect(child.killed).toBe(true)
    } finally {
      child.kill()
    }
  })
  it('RVM96A-17 advertises terminal auth separately from unimplemented terminal RPCs', async () => {
    const { connection, records } = startFake(
      'report',
      '/work/copy',
      emptyPolicyHandlers('/work/copy'),
    )
    try {
      await connection.initialize()
      const initialize = await waitForRecord(
        records,
        (record) =>
          typeof record === 'object' &&
          record !== null &&
          'method' in record &&
          record.method === 'initialize',
      )
      expect(initialize).toMatchObject({
        params: { clientCapabilities: { terminal: false, auth: { terminal: true } } },
      })
    } finally {
      connection.close()
    }
  })

  it.each(['model-ignored', 'model-missing'])(
    'RVM96A-18 refuses an unproven model before prompt: %s',
    async (scenario) => {
      const { connection, records } = startFake(
        scenario,
        '/work/copy',
        emptyPolicyHandlers('/work/copy'),
      )
      await expect(
        runAcpWorker(workerDeps(connection, taskIn('/work/copy', 'model-task'), WRITER)),
      ).rejects.toBeInstanceOf(AcpModelSelectionError)
      expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
    },
  )

  it('RVM96A-18 refuses an ignored mode readback without legacy fallback', async () => {
    const { connection, records } = startFake(
      'mode-ignored',
      '/work/copy',
      emptyPolicyHandlers('/work/copy'),
    )
    await expect(
      runAcpWorker(workerDeps(connection, taskIn('/work/copy', 'mode-task'), WRITER)),
    ).rejects.toThrow('did not confirm its mode')
    expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/set_mode' }))
    expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
  })

  it('RVM96A-15 runs standard ACP chunks end to end and parses the report', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    try {
      const handlers = emptyPolicyHandlers(folder)
      const { connection, records } = startFake('report', folder, handlers)
      try {
        const task = taskIn(folder, 't-1')
        const result = await runAcpWorker(workerDeps(connection, task, WRITER))
        expect(result.sessionId).toBe('fake-s1')
        expect(result.report).toEqual({
          ok: true,
          report: { status: 'done', summary: 'Fake work.' },
        })
        const sessionNew = await waitForRecord(
          records,
          (record) =>
            typeof record === 'object' &&
            record !== null &&
            'method' in record &&
            record.method === 'session/new',
        )
        expect(sessionNew).toMatchObject({ params: { cwd: folder, mcpServers: [] } })
      } finally {
        connection.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)

  it('answers an inside-edit with the once option, never allow_always', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    try {
      const handlers = emptyPolicyHandlers(folder, () => Promise.resolve('allowOnce'))
      const { connection, records } = startFake('permission-inside', folder, handlers)
      try {
        const task = taskIn(folder, 't-2')
        await runAcpWorker(workerDeps(connection, task, WRITER))
        await expectPermissionSelection(records, 'yes-once')
      } finally {
        connection.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects an outside path without asking', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    try {
      let wasAsked = false
      const handlers = emptyPolicyHandlers(folder, () => {
        wasAsked = true
        return Promise.resolve('allowOnce')
      })
      const { connection, records } = startFake('permission-outside', folder, handlers)
      try {
        const task = taskIn(folder, 't-3')
        await runAcpWorker(workerDeps(connection, task, WRITER))
        expect(wasAsked).toBe(false)
        await expectPermissionSelection(records, 'no-once')
      } finally {
        connection.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)

  it('confines fs reads and writes to the copy', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    await writeFile(path.join(folder, 'a.ts'), 'real content')
    try {
      const readTextFile = async (absolutePath: string): Promise<string | undefined> => {
        try {
          return await readFile(absolutePath, 'utf8')
        } catch {
          return undefined
        }
      }
      const handlers = policyHandlers(WRITER, folder, { readTextFile }, () =>
        Promise.resolve('rejectOnce'),
      )
      const { connection, records } = startFake('fs', folder, handlers)
      try {
        const task = taskIn(folder, 't-4')
        await runAcpWorker(workerDeps(connection, task, WRITER))
        const read = await waitForRecord(
          records,
          (record) => typeof record === 'object' && record !== null && 'fsRead' in record,
        )
        expect(read).toMatchObject({ fsRead: { content: 'real content' } })
        const write = await waitForRecord(
          records,
          (record) => typeof record === 'object' && record !== null && 'fsWrite' in record,
        )
        expect(write).toMatchObject({ fsWrite: { fsError: 'outside the working copy' } })
      } finally {
        connection.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)

  it('cancels a slow turn and settles its permissions', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    try {
      const handlers = emptyPolicyHandlers(folder)
      const { connection, records } = startFake('slow', folder, handlers)
      try {
        const task = taskIn(folder, 't-5')
        const deps = workerDeps(connection, task, WRITER)
        const pending = runAcpWorker(deps)
        await new Promise((resolve) => setTimeout(resolve, 500))
        await connection.cancel('fake-s1')
        const cancellation = await waitForRecord(
          records,
          (record) =>
            typeof record === 'object' &&
            record !== null &&
            'method' in record &&
            record.method === 'session/cancel',
        )
        expect(cancellation).not.toHaveProperty('id')
        const result = await pending
        expect(result.report.ok).toBe(false)
      } finally {
        connection.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)

  it('hands auth_required to the sign-in flow and reads no credential', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    try {
      const handlers = emptyPolicyHandlers(folder)
      const { connection } = startFake('auth', folder, handlers)
      try {
        const task = taskIn(folder, 't-6')
        await expect(runAcpWorker(workerDeps(connection, task, WRITER))).rejects.toBeInstanceOf(
          AcpAuthRequiredError,
        )
      } finally {
        connection.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 30_000)
})
