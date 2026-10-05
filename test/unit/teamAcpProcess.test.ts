// The ACP agent's process (M96 lane W): the PATH lookup, the scrubbed
// spawn, the Install command, and the SDK adapter against the fake ACP
// agent over real stdio.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ACP_PRESET_INSTALLS,
  buildPresetInstallCommand,
  connectAcpAgent,
  findAcpPresetCommand,
  runTerminalSignIn,
  spawnAcpAgent,
  updateTextOf,
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
        stdin: undefined as never,
        stdout: undefined as never,
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
      preset: ACP_PRESETS.codex,
      command: '/tools/bin/codex-acp',
      cwd: '/work/copy',
      baseEnv: { PATH: '/bin', META_API_KEY: 'key-1', TEAM: 'x' },
      platform: 'linux',
      passthrough: [],
      launchId: 'launch-1',
      launcher: launcherWith(seen),
    })
    expect(seen.command).toBe('/tools/bin/codex-acp')
    expect(seen.args).toEqual([])
    expect(seen.env?.['META_API_KEY']).toBeUndefined()
    expect(seen.env?.['TEAM']).toBe('x')
    expect(seen.env?.['MUSE_SPARK_LAUNCH_ID']).toBe('launch-1')
    expect(seen.env?.['GIT_TERMINAL_PROMPT']).toBe('0')
  })

  it('refuses the without-servers switch until step 1 captures it', async () => {
    await expect(
      spawnAcpAgent({
        preset: ACP_PRESETS.claude,
        command: '/tools/bin/claude-agent-acp',
        cwd: '/work/copy',
        baseEnv: {},
        platform: 'linux',
        launchId: 'launch-1',
        launcher: launcherWith({}),
        withoutUserServers: true,
      }),
    ).rejects.toBeInstanceOf(AcpUserServersSwitchError)
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
  it('reads text chunks and plain text', () => {
    expect(updateTextOf({ text: 'hi' })).toBe('hi')
    expect(
      updateTextOf({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('ab')
    expect(updateTextOf({ content: [{ type: 'image' }] })).toBeUndefined()
    expect(updateTextOf(undefined)).toBeUndefined()
  })
})

const children: ChildProcess[] = []
afterAll(async () => {
  for (const child of children) {
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
): { connection: AcpAgentConnection; records: unknown[] } {
  const child = spawn(process.execPath, [FAKE_AGENT.pathname, scenario, '--cwd', cwd], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  const { records } = recordsOf(child)
  const connection = connectAcpAgent({
    stdin: child.stdin,
    stdout: child.stdout,
    handlers,
    log: new FakeLogOutputChannel(),
  })
  return { connection, records }
}

function policyHandlers(
  role: WorkerRolePolicy,
  folder: string,
  files: { readTextFile: (absolutePath: string) => Promise<string | undefined> },
  onAskUser: () => Promise<'allowOnce' | 'rejectOnce'>,
): AcpClientHandlers {
  const io = { realPath: (absolutePath: string) => Promise.resolve(absolutePath) }
  const resolveOnce = async (
    toolCall: Parameters<AcpClientHandlers['onPermissionRequest']>[0],
    options: Parameters<AcpClientHandlers['onPermissionRequest']>[1],
  ): Promise<{ readonly optionId: string } | undefined> => {
    const verdict = await answerAcpPermission({
      role,
      folder,
      platform: 'linux',
      io,
      dialect: 'bash',
      readOnlyCommands: new Set(['git', 'ls']),
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
        { role, folder, platform: 'linux', io, ...files, writeTextFile: () => Promise.resolve() },
        given,
      ),
    onFsWrite: (given, content) =>
      acpFsWrite(
        { role, folder, platform: 'linux', io, ...files, writeTextFile: () => Promise.resolve() },
        given,
        content,
      ),
    onUpdate: () => undefined,
  }
}

function workerDeps(connection: AcpAgentConnection, task: WorkerTask, role: WorkerRolePolicy) {
  return {
    task,
    role,
    preset: ACP_PRESETS.claude,
    prompt: {
      charter: 'You are the engineering worker.',
      body: 'Write clean code.',
      rulesAndSkills: 'Follow the repo rules.',
    },
    isTrusted: true,
    io: {
      realPath: (absolutePath: string) => Promise.resolve(absolutePath),
      readTextFile: () => Promise.resolve(undefined),
    },
    platform: 'linux' as const,
    bridgeServers: [],
    connection,
  }
}

describe('the full stack against the fake agent', () => {
  it('runs a task end to end and parses its report', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'acp-copy-'))
    try {
      const handlers = policyHandlers(
        WRITER,
        folder,
        {
          readTextFile: () => Promise.resolve(undefined),
        },
        () => Promise.resolve('rejectOnce'),
      )
      const { connection, records } = startFake('report', folder, handlers)
      try {
        const task: WorkerTask = {
          taskId: 't-1',
          roleId: 'engineering',
          brief: 'Do it.',
          branch: 'agents/engineering/t-1',
          folder,
          files: [],
        }
        const result = await runAcpWorker(workerDeps(connection, task, WRITER))
        expect(result.sessionId).toBe('fake-s1')
        expect(result.report).toEqual({
          ok: true,
          report: { status: 'done', summary: 'Fake work.' },
        })
        const sessionNew = (await waitForRecord(
          records,
          (record) =>
            typeof record === 'object' &&
            record !== null &&
            (record as { method?: unknown }).method === 'session/new',
        )) as { params?: { cwd?: unknown; mcpServers?: unknown } }
        expect(sessionNew.params?.cwd).toBe(folder)
        expect(sessionNew.params?.mcpServers).toEqual([])
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
      const handlers = policyHandlers(
        WRITER,
        folder,
        {
          readTextFile: () => Promise.resolve(undefined),
        },
        () => Promise.resolve('allowOnce'),
      )
      const { connection, records } = startFake('permission-inside', folder, handlers)
      try {
        const task: WorkerTask = {
          taskId: 't-2',
          roleId: 'engineering',
          brief: 'Do it.',
          branch: 'agents/engineering/t-2',
          folder,
          files: [],
        }
        await runAcpWorker(workerDeps(connection, task, WRITER))
        const answer = (await waitForRecord(
          records,
          (record) => typeof record === 'object' && record !== null && 'permissionAnswer' in record,
        )) as {
          permissionAnswer?: { outcome?: { outcome?: string; optionId?: string } }
        }
        expect(answer.permissionAnswer?.outcome).toEqual({
          outcome: 'selected',
          optionId: 'yes-once',
        })
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
      const handlers = policyHandlers(
        WRITER,
        folder,
        {
          readTextFile: () => Promise.resolve(undefined),
        },
        () => {
          wasAsked = true
          return Promise.resolve('allowOnce')
        },
      )
      const { connection, records } = startFake('permission-outside', folder, handlers)
      try {
        const task: WorkerTask = {
          taskId: 't-3',
          roleId: 'engineering',
          brief: 'Do it.',
          branch: 'agents/engineering/t-3',
          folder,
          files: [],
        }
        await runAcpWorker(workerDeps(connection, task, WRITER))
        expect(wasAsked).toBe(false)
        const answer = (await waitForRecord(
          records,
          (record) => typeof record === 'object' && record !== null && 'permissionAnswer' in record,
        )) as {
          permissionAnswer?: { outcome?: { outcome?: string; optionId?: string } }
        }
        expect(answer.permissionAnswer?.outcome).toEqual({
          outcome: 'selected',
          optionId: 'no-once',
        })
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
        const task: WorkerTask = {
          taskId: 't-4',
          roleId: 'engineering',
          brief: 'Do it.',
          branch: 'agents/engineering/t-4',
          folder,
          files: [],
        }
        await runAcpWorker(workerDeps(connection, task, WRITER))
        const read = (await waitForRecord(
          records,
          (record) => typeof record === 'object' && record !== null && 'fsRead' in record,
        )) as { fsRead?: { content?: string } }
        expect(read.fsRead).toEqual({ content: 'real content' })
        const write = (await waitForRecord(
          records,
          (record) => typeof record === 'object' && record !== null && 'fsWrite' in record,
        )) as { fsWrite?: { fsError?: string } }
        expect(write.fsWrite?.fsError).toBe('outside the working copy')
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
      const handlers = policyHandlers(
        WRITER,
        folder,
        {
          readTextFile: () => Promise.resolve(undefined),
        },
        () => Promise.resolve('rejectOnce'),
      )
      const { connection } = startFake('slow', folder, handlers)
      try {
        const task: WorkerTask = {
          taskId: 't-5',
          roleId: 'engineering',
          brief: 'Do it.',
          branch: 'agents/engineering/t-5',
          folder,
          files: [],
        }
        const deps = workerDeps(connection, task, WRITER)
        const pending = runAcpWorker(deps)
        await new Promise((resolve) => setTimeout(resolve, 500))
        await connection.cancel('fake-s1')
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
      const handlers = policyHandlers(
        WRITER,
        folder,
        {
          readTextFile: () => Promise.resolve(undefined),
        },
        () => Promise.resolve('rejectOnce'),
      )
      const { connection } = startFake('auth', folder, handlers)
      try {
        const task: WorkerTask = {
          taskId: 't-6',
          roleId: 'engineering',
          brief: 'Do it.',
          branch: 'agents/engineering/t-6',
          folder,
          files: [],
        }
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
