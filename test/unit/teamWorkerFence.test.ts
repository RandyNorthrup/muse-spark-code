import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertWorkerRoot,
  confineWorkerPath,
  hasRefMove,
  isWorkerCommandAllowed,
  WORKER_NATIVE_IO,
} from '../../src/core/team/workers/workerFence'
import {
  answerAcpPermission,
  ACP_PRESETS,
  runAcpWorker,
} from '../../src/core/team/workers/acpWorker'
import { buildWorkerSessionConfig } from '../../src/core/team/workers/museCodeWorker'
import { createWorkerShellRunner, runEngineWorker } from '../../src/core/team/workers/engineWorker'
import { spawnAcpAgent } from '../../src/host/team/acpProcess'
import type { WorkerRolePolicy, WorkerTask } from '../../src/core/team/workers/workerTypes'
import { FakeLogOutputChannel } from './helpers/fakes'
import { TEAM_WORKER_PROMPT } from './helpers/teamWorkerPrompt'
import { scrubWorkerEnv } from '../../src/core/team/workers/workerEnv'
import type { WorktreeSessionEvent } from '../../src/core/bestOfN/worktreeConversationHost'

const ROLE: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'shell', 'report'],
  reportShape: 'summary',
}
const fixtureState = { fixture: '', checkout: '', copy: '' }
beforeAll(async () => {
  const base = path.resolve('temp')
  await mkdir(base, { recursive: true })
  fixtureState.fixture = await mkdtemp(path.join(base, 'worker-fence-'))
  fixtureState.checkout = path.join(fixtureState.fixture, 'checkout-long-name')
  fixtureState.copy = path.join(fixtureState.fixture, 'working-copy')
  await mkdir(fixtureState.checkout)
  await mkdir(fixtureState.copy)
  await writeFile(path.join(fixtureState.copy, 'inside.txt'), 'inside')
  await writeFile(path.join(fixtureState.checkout, 'outside.txt'), 'outside')
})
afterAll(async () => {
  await rm(fixtureState.fixture, { recursive: true, force: true })
})

function input(folder = fixtureState.copy) {
  return {
    folder,
    workspaceRoot: fixtureState.checkout,
    platform: process.platform,
    io: WORKER_NATIVE_IO,
  }
}
function task(folder: string): WorkerTask {
  return {
    taskId: 'identity',
    roleId: 'engineering',
    brief: 'Check identity.',
    branch: 'agents/engineering/identity',
    folder,
    files: [],
  }
}

describe('W-F1 native identities', () => {
  it('admits disjoint copies, refuses both ancestor directions and unresolvable paths', async () => {
    expect(await assertWorkerRoot(input())).toBe(fixtureState.copy)
    for (const folder of [
      fixtureState.checkout,
      fixtureState.fixture,
      path.join(fixtureState.checkout, 'missing'),
    ]) {
      await expect(assertWorkerRoot(input(folder))).rejects.toThrow()
    }
    await mkdir(path.join(fixtureState.checkout, 'child'))
    await expect(
      assertWorkerRoot(input(path.join(fixtureState.checkout, 'child'))),
    ).rejects.toThrow()
  })
  it('requires identity equality for explicit engine in-place mode', async () => {
    expect(await assertWorkerRoot({ ...input(fixtureState.checkout), isInPlace: true })).toBe(
      fixtureState.checkout,
    )
    await expect(assertWorkerRoot({ ...input(), isInPlace: true })).rejects.toThrow()
  })
  it('RVM96W2C-N1 refuses a real UNC administrative-share checkout alias', async () => {
    const alias =
      process.platform === 'win32'
        ? `\\\\localhost\\${fixtureState.checkout.slice(0, 1)}$${fixtureState.checkout.slice(2)}`
        : fixtureState.checkout
    expect(await WORKER_NATIVE_IO.pathIdentity(await WORKER_NATIVE_IO.realPath(alias))).toBe(
      await WORKER_NATIVE_IO.pathIdentity(fixtureState.checkout),
    )
    await expect(assertWorkerRoot(input(alias))).rejects.toThrow()
    const launcher = { spawn: vi.fn(() => Promise.reject(new Error('must not spawn'))) }
    await expect(
      spawnAcpAgent({
        ...input(alias),
        cwd: alias,
        preset: { ...ACP_PRESETS.claude, withoutUserServersSwitch: ['--fake-isolation'] },
        command: 'fake',
        baseEnv: {},
        launchId: 'identity',
        launcher,
      }),
    ).rejects.toThrow()
    expect(launcher.spawn).not.toHaveBeenCalled()
    await expect(
      buildWorkerSessionConfig({
        ...input(alias),
        task: task(alias),
        role: ROLE,
        modelId: 'fake',
        exclusiveUserServers: [],
        bridgeServers: {},
      }),
    ).rejects.toThrow()
    const initialize = vi.fn(() => Promise.resolve({ protocolVersion: 1, authMethods: [] }))
    await expect(
      runAcpWorker({
        ...input(alias),
        task: task(alias),
        role: ROLE,
        modelId: 'fake',
        prompt: TEAM_WORKER_PROMPT,
        preset: ACP_PRESETS.claude,
        isTrusted: true,
        nativeServersExcluded: true,
        io: { ...WORKER_NATIVE_IO, readTextFile: () => Promise.resolve(undefined) },
        bridgeServers: [],
        signal: new AbortController().signal,
        connection: {
          initialize,
          sessionNew: () => Promise.reject(new Error('must not open')),
          setConfigOption: () => Promise.resolve(),
          setMode: () => Promise.resolve(),
          setModel: () => Promise.resolve('fake'),
          prompt: () => Promise.reject(new Error('must not prompt')),
          cancel: () => Promise.resolve(),
          close: () => undefined,
        },
      }),
    ).rejects.toThrow()
    expect(initialize).not.toHaveBeenCalled()
  })
  it('RVM96W2C-N2 engine startup and shell refuse the real checkout before dispatch', async () => {
    const events: { listener?: (event: WorktreeSessionEvent) => void } = {}
    const sendTurn = vi.fn(() => {
      events.listener?.({ type: 'turnCompleted', turnId: 'fake-turn', terminal: 'stopped' })
      return Promise.resolve()
    })
    await expect(
      runEngineWorker({
        ...input(fixtureState.checkout),
        task: task(fixtureState.checkout),
        role: ROLE,
        prompt: TEAM_WORKER_PROMPT,
        isTrusted: true,
        io: { ...WORKER_NATIVE_IO, readTextFile: () => Promise.resolve(undefined) },
        requestCeiling: 5,
        declineChoiceId: 'abort',
        agentId: 'fake',
        marks: { markRateLimited: () => undefined, markUsageLimited: () => undefined },
        log: new FakeLogOutputChannel(),
        session: {
          sessionId: 'fake',
          onEvent: (listener) => {
            events.listener = listener
            return () => {
              delete events.listener
            }
          },
          sendTurn,
          decideApproval: () => Promise.resolve(),
          cancelQuestions: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
        },
      }),
    ).rejects.toThrow()
    expect(sendTurn).not.toHaveBeenCalled()
    const spawn = vi.fn(() => Promise.resolve({ wait: () => Promise.resolve({ exitCode: 0 }) }))
    const run = createWorkerShellRunner({
      ...input(fixtureState.checkout),
      root: fixtureState.checkout,
      role: ROLE,
      readOnlyCommands: new Set(),
      baseEnv: {},
      spawn,
    })
    await expect(run('git', ['status'])).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })
  it('RVM96A-4 refuses real device-prefix and case aliases', async () => {
    const aliases =
      process.platform === 'win32'
        ? [
            `\\\\?\\${fixtureState.checkout}`,
            `\\\\.\\${fixtureState.checkout}`,
            fixtureState.checkout.toUpperCase(),
            `${fixtureState.checkout}.`,
            `${fixtureState.checkout} `,
          ]
        : [fixtureState.checkout]
    for (const alias of aliases) await expect(assertWorkerRoot(input(alias))).rejects.toThrow()
  })
  it('RVM96A-4 refuses a real 8.3 short-name alias', async () => {
    const probe =
      process.platform === 'win32'
        ? spawnSync(
            'cmd.exe',
            ['/d', '/s', '/c', `for %I in ("${fixtureState.checkout}") do @echo %~sI`],
            {
              encoding: 'utf8',
              windowsHide: true,
              windowsVerbatimArguments: true,
              env: scrubWorkerEnv({ platform: process.platform, baseEnv: process.env }),
            },
          )
        : undefined
    const short = probe === undefined ? fixtureState.checkout : probe.stdout.trim()
    if (probe !== undefined) {
      expect(probe.status).toBe(0)
      expect(short).toContain('~')
    }
    await expect(assertWorkerRoot(input(short))).rejects.toThrow()
  })
  it('RVM96A-4 refuses a junction alias and rechecks replaced roots on path requests', async () => {
    const alias = path.join(fixtureState.fixture, 'junction')
    await symlink(fixtureState.copy, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await assertWorkerRoot(input(alias))).toBe(fixtureState.copy)
    await rm(alias)
    await symlink(fixtureState.checkout, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(assertWorkerRoot(input(alias))).rejects.toThrow()
    expect(await confineWorkerPath(input(alias), 'outside.txt')).toEqual({ ok: false })
  })
  it('RVM96W2C-N1 refuses a real non-admin subst alias', async () => {
    if (process.platform !== 'win32') {
      await expect(assertWorkerRoot(input(fixtureState.checkout))).rejects.toThrow()
      return
    }
    const systemRoot = process.env['SystemRoot'] ?? process.env['SYSTEMROOT']
    if (systemRoot === undefined) throw new Error('Windows did not supply its system root')
    const subst = path.join(systemRoot, 'System32', 'subst.exe')
    // This mapping is fixture-owned and removed in finally; no machine/user setting changes.
    const drive = ['R:', 'Q:', 'P:'].find((candidate) => !existsSync(`${candidate}\\`))
    if (drive === undefined) throw new Error('No fixture drive letter is available for subst')
    execFileSync(subst, [drive, fixtureState.checkout], { windowsHide: true })
    try {
      await expect(assertWorkerRoot(input(`${drive}\\`))).rejects.toThrow()
    } finally {
      execFileSync(subst, [drive, '/d'], { windowsHide: true })
    }
  })
  it('RVM96W2C-N18 passes the resolved outward junction cwd to Muse and ACP launchers', async () => {
    const alias = path.join(fixtureState.checkout, 'outward')
    await symlink(fixtureState.copy, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const config = await buildWorkerSessionConfig({
      ...input(alias),
      task: task(alias),
      role: ROLE,
      modelId: 'fake',
      exclusiveUserServers: [],
      bridgeServers: {},
    })
    expect(config.workspaceRoot).toBe(fixtureState.copy)
    const spawn = vi.fn(() => Promise.reject(new Error('recorded cwd')))
    await expect(
      spawnAcpAgent({
        ...input(alias),
        cwd: alias,
        preset: { ...ACP_PRESETS.claude, withoutUserServersSwitch: ['--fake-isolation'] },
        command: 'fake',
        baseEnv: {},
        launchId: 'identity',
        launcher: { spawn },
      }),
    ).rejects.toThrow('recorded cwd')
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: fixtureState.copy }))
  })
})

describe('W-F2 identity path admission', () => {
  it('resolves inside paths and refuses outside, home and unresolved targets', async () => {
    expect(await confineWorkerPath(input(), 'inside.txt')).toMatchObject({
      ok: true,
      checkedAbsolute: path.join(fixtureState.copy, 'inside.txt'),
    })
    for (const candidate of [
      '../../outside',
      '../checkout-long-name/outside.txt',
      '~/.ssh/id_rsa',
      'missing.txt',
    ])
      expect(await confineWorkerPath(input(), candidate)).toEqual({ ok: false })
  })
  it.each([
    'cwd',
    'to',
    'from',
    'path',
    'file_path',
    'destination',
    'workingDirectory',
    'targetPath',
  ])('RVM96W2C-N4 refuses outside relative/home ACP field %s without asking', async (key) => {
    for (const target of ['../checkout-long-name/outside.txt', '~/.bashrc']) {
      const answer = await answerAcpPermission({
        ...input(),
        role: ROLE,
        dialect: 'bash',
        readOnlyCommands: new Set(),
        toolCall: {
          toolCallId: 'outside',
          title: 'test',
          kind: 'execute',
          rawInput: { command: 'npm test', [key]: target },
        },
      })
      expect(answer.action).toBe('rejectOnce')
    }
  })
})

describe('W-F3 one git classifier', () => {
  it.each([
    'env git commit -am x',
    'env -i git push',
    'command git push',
    'nice -n 2 git commit -am x',
    'xargs git tag x',
    'bash -c "git commit -am x"',
    "sh -c 'git push origin HEAD'",
    'cmd /c git commit -am x',
    'pwsh -c "git push"',
    'git.cmd commit -am x',
    'git.exe update-ref refs/heads/x HEAD',
    '/usr/bin/git branch -f x HEAD',
    String.raw`C:\Git\git.exe reset --hard HEAD`,
  ])('RVM96W2C-N3 denies wrapped ref changes without a card: %s', async (command) => {
    expect(hasRefMove(command, command.startsWith('C:') ? 'powershell' : 'bash')).toBe(true)
    expect(
      await isWorkerCommandAllowed({
        ...input(),
        role: ROLE,
        command,
        dialect: 'bash',
        readOnlyCommands: new Set(),
      }),
    ).toBe(false)
    const answer = await answerAcpPermission({
      ...input(),
      role: ROLE,
      dialect: 'powershell',
      readOnlyCommands: new Set(),
      toolCall: { toolCallId: 'ref', title: 'test', kind: 'execute', rawInput: { command } },
    })
    expect(answer.action).toBe('rejectOnce')
  })
  it.each(['git diff --no-index /etc/passwd /dev/null', 'npm test --prefix ../../user/checkout'])(
    'RVM96W2C-N17 refuses unsafe trailing command arguments: %s',
    async (command) => {
      expect(
        await isWorkerCommandAllowed({
          ...input(),
          role: ROLE,
          command,
          dialect: 'bash',
          readOnlyCommands: new Set(['git diff']),
          testCommands: new Set(['npm test']),
        }),
      ).toBe(false)
    },
  )
})
