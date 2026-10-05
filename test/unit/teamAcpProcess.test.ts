import { fileURLToPath } from 'node:url'
import { fakeWorkerIdentity, fakeWorkerFiles } from './helpers/workerIdentity'
import { TEAM_WORKER_PROMPT } from './helpers/teamWorkerPrompt'
import type { WorkerRootGrant } from '../../src/core/team/workers/workerFence'
// The ACP agent's process (M96 lane W): the PATH lookup, the scrubbed
// spawn, the Install command, and the SDK adapter against the fake ACP
// agent over real stdio.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { RequestError, type AuthMethod } from '@agentclientprotocol/sdk'
import { afterAll, describe, expect, it, vi } from 'vitest'
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

const fixtureBase = path.resolve('temp')
mkdirSync(fixtureBase, { recursive: true })

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
      io: { pathIdentity: fakeWorkerIdentity, realPath: (given) => Promise.resolve(given) },
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
        io: { pathIdentity: fakeWorkerIdentity, realPath: (given) => Promise.resolve(given) },
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
        io: { pathIdentity: fakeWorkerIdentity, realPath: () => Promise.resolve('/repo') },
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
  const io = fakeWorkerFiles(
    {
      pathIdentity: fakeWorkerIdentity,
      realPath: (absolutePath: string) => Promise.resolve(absolutePath),
    },
    files.readTextFile,
  )
  const resolveOnce = async (
    toolCall: Parameters<AcpClientHandlers['onPermissionRequest']>[0],
    options: Parameters<AcpClientHandlers['onPermissionRequest']>[1],
    grant: WorkerRootGrant,
  ): Promise<{ readonly optionId: string } | undefined> => {
    const verdict = await answerAcpPermission({
      role,
      folder,
      workspaceRoot: path.join(fixtureBase, 'acp-checkout'),
      platform: process.platform,
      io,
      grant,
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
    onPermissionRequest: (toolCall, options, grant) => resolveOnce(toolCall, options, grant),
    onFsRead: (given, grant) =>
      acpFsRead(
        {
          role,
          folder,
          workspaceRoot: path.join(fixtureBase, 'acp-checkout'),
          platform: process.platform,
          io,
          grant,
        },
        given,
      ),
    onFsWrite: (given, content, grant) =>
      acpFsWrite(
        {
          role,
          folder,
          workspaceRoot: path.join(fixtureBase, 'acp-checkout'),
          platform: process.platform,
          io,
          grant,
        },
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
    modelId: 'explicit-selected-model',
    signal: new AbortController().signal,
    prompt: TEAM_WORKER_PROMPT,
    workspaceRoot: path.join(fixtureBase, 'acp-checkout'),
    nativeServersExcluded: true,
    isTrusted: true,
    io: {
      pathIdentity: fakeWorkerIdentity,
      realPath: (absolutePath: string) => Promise.resolve(absolutePath),
    },
    platform: process.platform,
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
  it('RVM96W3-F1 SDK filesystem callback retains the session admission after a disjoint root swap', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const replacement = path.join(fixtureBase, 'disjoint-replacement')
    const state = { isReplaced: false }
    const read = vi.fn(() => Promise.resolve('replacement sentinel'))
    const io = fakeWorkerFiles(
      {
        pathIdentity: fakeWorkerIdentity,
        realPath: (given) =>
          Promise.resolve(
            state.isReplaced && (given === folder || given.startsWith(`${folder}${path.sep}`))
              ? replacement + given.slice(folder.length)
              : given,
          ),
      },
      read,
    )
    const handlers = emptyPolicyHandlers(folder)
    const { connection } = startFake('fs', folder, {
      ...handlers,
      onFsRead: (given, grant) => {
        state.isReplaced = true
        return acpFsRead(
          {
            role: WRITER,
            folder,
            workspaceRoot: path.join(fixtureBase, 'acp-checkout'),
            platform: process.platform,
            io,
            grant,
          },
          given,
        )
      },
    })
    await expect(
      runAcpWorker({ ...workerDeps(connection, taskIn(folder, 'retained-grant'), WRITER), io }),
    ).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('RVM96W3-F7 adapter bounds cancel transmission itself', async () => {
    const stdout = new PassThrough()
    const state: { release?: () => void } = {}
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        state.release = callback
      },
    })
    const disposeProcess = vi.fn()
    const connection = connectAcpAgent({
      stdin,
      stdout,
      handlers: emptyPolicyHandlers(fixtureBase),
      log: new FakeLogOutputChannel(),
      supportsTerminalAuth: true,
      disposeProcess,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const isBounded = await Promise.race([
        (async () => {
          await connection.cancel('held')
          return true
        })(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            resolve(false)
          }, 1200)
        }),
      ])
      expect(isBounded).toBe(true)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      state.release?.()
      connection.close()
      stdin.destroy()
      stdout.destroy()
    }
    expect(disposeProcess).toHaveBeenCalledOnce()
  })
  it('RVM96W3-F5 final image discards an earlier draft report', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const { connection } = startFake('draft-image', folder, emptyPolicyHandlers(folder))
    const result = await runAcpWorker(workerDeps(connection, taskIn(folder, 'image'), WRITER))
    expect(result.report).toMatchObject({ ok: false, status: 'unstructured' })
  })
  it('RVM96W3-F6 refuses a model response that resets the confirmed mode', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const { connection, records } = startFake(
      'model-resets-mode',
      folder,
      emptyPolicyHandlers(folder),
    )
    await expect(
      runAcpWorker(
        workerDeps(connection, taskIn(folder, 'mode-reset'), {
          ...WRITER,
          roleId: 'code-review',
          workspaceMode: 'read-only',
          toolGroups: ['read', 'report'],
        }),
      ),
    ).rejects.toThrow('did not confirm its mode')
    expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
  })
  it('RVM96W3-F6 refuses a model response that drops the confirmed mode selector', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const { connection, records } = startFake(
      'model-drops-mode',
      folder,
      emptyPolicyHandlers(folder),
    )
    await expect(
      runAcpWorker(workerDeps(connection, taskIn(folder, 'mode-dropped'), WRITER)),
    ).rejects.toThrow('did not confirm its mode')
    expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
  })
  it('RVM96W3-F7 cancel pipe backpressure reaches its deadline and disposes the process', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const stdout = new PassThrough()
    const controller = new AbortController()
    const disposeProcess = vi.fn()
    const state: { cancelCallback?: () => void; sawCancel: boolean } = { sawCancel: false }
    const options = [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'default',
        options: [{ value: 'default', name: 'Default' }],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'explicit-selected-model',
        options: [{ value: 'explicit-selected-model', name: 'Selected' }],
      },
    ]
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        const message: { id?: number; method: string } = JSON.parse(chunk.toString())
        if (message.method === 'session/cancel') {
          state.sawCancel = true
          state.cancelCallback = callback
          return
        }
        callback()
        if (message.method === 'session/prompt') {
          queueMicrotask(() => {
            controller.abort()
          })
          return
        }
        const responses: Readonly<Record<string, unknown>> = {
          initialize: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
          'session/new': { sessionId: 'blocked', configOptions: options },
        }
        const result = responses[message.method] ?? { configOptions: options }
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
      },
    })
    const connection = connectAcpAgent({
      stdin,
      stdout,
      handlers: emptyPolicyHandlers(folder),
      log: new FakeLogOutputChannel(),
      supportsTerminalAuth: true,
      disposeProcess,
    })
    const started = Date.now()
    try {
      await expect(
        runAcpWorker({
          ...workerDeps(connection, taskIn(folder, 'backpressure'), WRITER),
          signal: controller.signal,
        }),
      ).rejects.toThrow()
      expect(state.sawCancel).toBe(true)
      expect(disposeProcess).toHaveBeenCalledOnce()
      expect(Date.now() - started).toBeLessThan(1200)
    } finally {
      state.cancelCallback?.()
      connection.close()
      stdin.destroy()
      stdout.destroy()
    }
  })
  it.each(['draft-failed', 'draft-final'])(
    'RVM96W2C-N5 uses only the final ACP message: %s',
    async (scenario) => {
      const folder = path.join(fixtureBase, 'acp-copy')
      const { connection } = startFake(scenario, folder, emptyPolicyHandlers(folder))
      const result = await runAcpWorker(workerDeps(connection, taskIn(folder, 'messages'), WRITER))
      if (scenario === 'draft-failed')
        expect(result.report).toEqual({
          ok: false,
          status: 'unstructured',
          summary: 'The tests failed after all; I could not finish.',
        })
      else
        expect(result.report).toEqual({
          ok: true,
          report: { status: 'done', summary: 'Fake work.' },
        })
    },
  )
  it.each([
    ['max_turn_requests', 'capped'],
    ['max_tokens', 'capped'],
    ['refusal', 'refused'],
    ['cancelled', 'cancelled'],
    ['future-stop', 'failed'],
  ])('RVM96W2C-N6 maps ACP stop %s to non-success %s', async (reason, status) => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const { connection } = startFake(`stop-${reason}`, folder, emptyPolicyHandlers(folder))
    const result = await runAcpWorker(workerDeps(connection, taskIn(folder, 'stops'), WRITER))
    expect(result.report).toMatchObject({ ok: false, status, stopReason: reason })
  })
  it.each(['mode-legacy-ignored', 'mode-legacy-forbidden', 'protocol-9'])(
    'RVM96W2C-N12-N13 refuses unconfirmed legacy mode or protocol: %s',
    async (scenario) => {
      const folder = path.join(fixtureBase, 'acp-copy')
      const { connection, records } = startFake(scenario, folder, emptyPolicyHandlers(folder))
      await expect(
        runAcpWorker(workerDeps(connection, taskIn(folder, 'legacy'), WRITER)),
      ).rejects.toThrow()
      expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
    },
  )
  it('RVM96W2C-N12 accepts a legacy mode only after a standard current_mode_update', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const { connection } = startFake('mode-legacy-confirmed', folder, emptyPolicyHandlers(folder))
    const result = await runAcpWorker(
      workerDeps(connection, taskIn(folder, 'legacy-confirmed'), WRITER),
    )
    expect(result.report.ok).toBe(true)
  })
  it('RVM96W2C-N11 flushes runner-abort cancel to the agent before child disposal', async () => {
    const folder = path.join(fixtureBase, 'acp-copy')
    const { connection, records, child } = startFake('slow', folder, emptyPolicyHandlers(folder))
    const controller = new AbortController()
    const running = runAcpWorker({
      ...workerDeps(connection, taskIn(folder, 'runner-abort'), WRITER),
      signal: controller.signal,
    })
    const rejected = expect(running).rejects.toThrow()
    await waitForRecord(
      records,
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        'method' in record &&
        record.method === 'session/prompt',
    )
    controller.abort()
    await rejected
    expect(
      await waitForRecord(
        records,
        (record) =>
          typeof record === 'object' &&
          record !== null &&
          'method' in record &&
          record.method === 'session/cancel',
      ),
    ).toMatchObject({ method: 'session/cancel' })
    expect(child.killed).toBe(true)
  })

  it('RVM96A-19 closes the owned ACP child through the launcher callback', async () => {
    const { connection, child } = startFake(
      'report',
      path.join(fixtureBase, 'acp-copy'),
      emptyPolicyHandlers(path.join(fixtureBase, 'acp-copy')),
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
      path.join(fixtureBase, 'acp-copy'),
      emptyPolicyHandlers(path.join(fixtureBase, 'acp-copy')),
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
        path.join(fixtureBase, 'acp-copy'),
        emptyPolicyHandlers(path.join(fixtureBase, 'acp-copy')),
      )
      await expect(
        runAcpWorker(
          workerDeps(connection, taskIn(path.join(fixtureBase, 'acp-copy'), 'model-task'), WRITER),
        ),
      ).rejects.toBeInstanceOf(AcpModelSelectionError)
      expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
    },
  )

  it('RVM96A-18 refuses an ignored mode readback without legacy fallback', async () => {
    const { connection, records } = startFake(
      'mode-ignored',
      path.join(fixtureBase, 'acp-copy'),
      emptyPolicyHandlers(path.join(fixtureBase, 'acp-copy')),
    )
    await expect(
      runAcpWorker(
        workerDeps(connection, taskIn(path.join(fixtureBase, 'acp-copy'), 'mode-task'), WRITER),
      ),
    ).rejects.toThrow('did not confirm its mode')
    expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/set_mode' }))
    expect(records).not.toContainEqual(expect.objectContaining({ method: 'session/prompt' }))
  })

  it('RVM96A-15 runs standard ACP chunks end to end and parses the report', async () => {
    const folder = await mkdtemp(path.join(fixtureBase, 'acp-copy-'))
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
    const folder = await mkdtemp(path.join(fixtureBase, 'acp-copy-'))
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
    const folder = await mkdtemp(path.join(fixtureBase, 'acp-copy-'))
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
    const folder = await mkdtemp(path.join(fixtureBase, 'acp-copy-'))
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
    const folder = await mkdtemp(path.join(fixtureBase, 'acp-copy-'))
    try {
      const handlers = emptyPolicyHandlers(folder)
      const { connection, records } = startFake('slow', folder, handlers)
      try {
        const task = taskIn(folder, 't-5')
        const deps = workerDeps(connection, task, WRITER)
        const pending = runAcpWorker(deps)
        await waitForRecord(
          records,
          (record) =>
            typeof record === 'object' &&
            record !== null &&
            'method' in record &&
            record.method === 'session/prompt',
        )
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
    const folder = await mkdtemp(path.join(fixtureBase, 'acp-copy-'))
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
