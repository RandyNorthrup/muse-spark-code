import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile, readFile, rename, rmdir } from 'node:fs/promises'
import { fakeWorkerIdentity, fakeWorkerFiles } from './helpers/workerIdentity'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertWorkerRoot,
  confineWorkerPath,
  hasRefMove,
  isWorkerCommandAllowed,
  WORKER_NATIVE_IO,
  recheckWorkerRoot,
} from '../../src/core/team/workers/workerFence'
import {
  answerAcpPermission,
  ACP_PRESETS,
  runAcpWorker,
  acpFsRead,
  acpFsWrite,
} from '../../src/core/team/workers/acpWorker'
import {
  buildWorkerSessionConfig,
  classifyMuseWorkerApproval,
} from '../../src/core/team/workers/museCodeWorker'
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
    const grant = await assertWorkerRoot(input())
    expect(grant.absolute).toBe(fixtureState.copy)
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
    const grant = await assertWorkerRoot({ ...input(fixtureState.checkout), isInPlace: true })
    expect(grant.absolute).toBe(fixtureState.checkout)
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
        io: WORKER_NATIVE_IO,
        bridgeServers: [],
        signal: new AbortController().signal,
        connection: {
          initialize,
          sessionNew: () => Promise.reject(new Error('must not open')),
          setConfigOption: () => Promise.resolve(),
          setMode: () => Promise.resolve(),
          setModel: () => Promise.resolve('fake'),
          checkMode: () => undefined,
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
        io: WORKER_NATIVE_IO,
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
  it('RVM96A-4 refuses the native short-name result even on volumes without 8.3 names', async () => {
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
    }
    expect(await WORKER_NATIVE_IO.pathIdentity(await WORKER_NATIVE_IO.realPath(short))).toBe(
      await WORKER_NATIVE_IO.pathIdentity(fixtureState.checkout),
    )
    await expect(assertWorkerRoot(input(short))).rejects.toThrow()
  })
  it('RVM96A-4 refuses a Windows 8.3 alias fixture by resolved identity on every volume', async () => {
    const checkout = String.raw`D:\a\workspace\checkout-long-name`
    const short = String.raw`D:\a\WORKSP~1\CHECKO~1`
    expect(short).toContain('~')
    const io = {
      pathIdentity: fakeWorkerIdentity,
      realPath: (given: string) => Promise.resolve(given === short ? checkout : given),
    }
    await expect(
      assertWorkerRoot({ folder: short, workspaceRoot: checkout, platform: 'win32', io }),
    ).rejects.toThrow()
  })
  it('RVM96A-4 refuses a junction alias and rechecks replaced roots on path requests', async () => {
    const alias = path.join(fixtureState.fixture, 'junction')
    await symlink(fixtureState.copy, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const grant = await assertWorkerRoot(input(alias))
    expect(grant.absolute).toBe(fixtureState.copy)
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
  it('RVM96W3-F2 handle admission retains Windows reinterpreted-name refusal', async () => {
    const read = vi.fn(() => Promise.resolve('sentinel'))
    const write = vi.fn(() => Promise.resolve())
    const io = fakeWorkerFiles(
      {
        pathIdentity: fakeWorkerIdentity,
        realPath: (given) => Promise.resolve(given.replace(/:stream$/, '').replace(/[. ]$/, '')),
      },
      read,
      write,
    )
    const policy = {
      folder: String.raw`C:\worker`,
      workspaceRoot: String.raw`C:\checkout`,
      platform: 'win32' as const,
      role: ROLE,
      io,
    }
    for (const given of ['docs/a.md:stream', 'docs/a.md.', 'docs/a.md ', 'docs/NUL']) {
      expect(await acpFsRead(policy, given)).toHaveProperty('error')
      expect(await acpFsWrite(policy, given, 'attack')).toHaveProperty('error')
    }
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
  it('RVM96W3-F1 injected root replacement refuses before reading', async () => {
    let samples = 0
    const read = vi.fn(() => Promise.resolve('private sentinel'))
    const io = fakeWorkerFiles(
      {
        pathIdentity: fakeWorkerIdentity,
        realPath: (given) => {
          return Promise.resolve(given === '/worker' && ++samples > 1 ? '/checkout' : given)
        },
      },
      read,
    )
    const result = await acpFsRead(
      { folder: '/worker', workspaceRoot: '/checkout', platform: 'linux', io, role: ROLE },
      'private.txt',
    )
    expect(result).toHaveProperty('error')
    expect(read).not.toHaveBeenCalled()
  })
  it('RVM96W3-F1 real renamed-root replacement invalidates the admission grant', async () => {
    const root = path.join(fixtureState.fixture, 'race-root')
    const held = `${root}-held`
    await mkdir(root)
    const grant = await assertWorkerRoot(input(root))
    await rename(root, held)
    await mkdir(root)
    await expect(recheckWorkerRoot(input(root), grant)).rejects.toThrow()
    expect(await confineWorkerPath({ ...input(root), grant }, 'inside.txt')).toEqual({ ok: false })
  })
  it('RVM96W3-F1 real junction retarget invalidates its admission grant', async () => {
    const alias = path.join(fixtureState.fixture, 'race-junction')
    await symlink(fixtureState.copy, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const grant = await assertWorkerRoot(input(alias))
    await rm(alias)
    await symlink(fixtureState.checkout, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(recheckWorkerRoot(input(alias), grant)).rejects.toThrow()
  })
  it('RVM96W3-F2 injected target swap cannot authorize a protected handle', async () => {
    const write = vi.fn(() => Promise.resolve())
    let resolutions = 0
    const io = fakeWorkerFiles(
      {
        pathIdentity: fakeWorkerIdentity,
        realPath: (given) => {
          if (given === '/worker/link') resolutions += 1
          const target = resolutions === 1 ? '/worker/.git/config' : '/worker/docs/ok.md'
          return Promise.resolve(given === '/worker/link' ? target : given)
        },
      },
      () => Promise.resolve(undefined),
      write,
    )
    const result = await acpFsWrite(
      {
        folder: '/worker',
        workspaceRoot: '/checkout',
        platform: 'linux',
        io,
        role: { ...ROLE, writePaths: ['docs/**'] },
      },
      'link',
      'attack',
    )
    expect(result).toHaveProperty('error')
    expect(write).not.toHaveBeenCalled()
  })
  it('RVM96W3-F2 real target rename writes only the originally checked handle', async () => {
    const root = path.join(fixtureState.fixture, 'handle-root')
    const docs = path.join(root, 'docs')
    const held = path.join(root, 'held')
    await mkdir(docs, { recursive: true })
    await writeFile(path.join(docs, 'outside.txt'), 'before')
    const nativeOpen = WORKER_NATIVE_IO.openFile
    if (nativeOpen === undefined) throw new Error('Missing native handle port')
    const state: { failure?: string } = {}
    const io = {
      ...WORKER_NATIVE_IO,
      openFile: async (given: string, isWrite: boolean) => {
        const handle = await nativeOpen(given, isWrite)
        return {
          ...handle,
          write: async (content: string) => {
            try {
              await rename(path.join(docs, 'outside.txt'), held)
              await rmdir(docs)
              await symlink(
                fixtureState.checkout,
                docs,
                process.platform === 'win32' ? 'junction' : 'dir',
              )
              await handle.write(content)
            } catch (error: unknown) {
              state.failure = String(error)
              throw error
            }
          },
        }
      },
    }
    const result = await acpFsWrite(
      { ...input(root), io, role: { ...ROLE, writePaths: ['docs/**'] } },
      'docs/outside.txt',
      'checked handle',
    )
    expect(result, state.failure).toEqual({ ok: true })
    expect(await readFile(held, 'utf8')).toBe('checked handle')
    expect(await readFile(path.join(fixtureState.checkout, 'outside.txt'), 'utf8')).toBe('outside')
  })
  it('RVM96W3-F1 real read target rename reads only the checked handle', async () => {
    const root = path.join(fixtureState.fixture, 'read-handle-root-漢')
    await mkdir(root)
    const target = path.join(root, 'inside.txt')
    await writeFile(target, 'original')
    const nativeOpen = WORKER_NATIVE_IO.openFile
    if (nativeOpen === undefined) throw new Error('Missing native handle port')
    const io = {
      ...WORKER_NATIVE_IO,
      openFile: async (given: string, isWrite: boolean) => {
        const handle = await nativeOpen(given, isWrite)
        return {
          ...handle,
          read: async (maxBytes: number) => {
            await rename(target, `${target}-held`)
            await writeFile(target, 'replacement')
            return await handle.read(maxBytes)
          },
        }
      },
    }
    expect(await acpFsRead({ ...input(root), io, role: ROLE }, 'inside.txt')).toEqual({
      content: 'original',
    })
  })
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
  it.each(['npm test -C ..', 'npm test -C..', 'npm test --prefix=..', 'npm test ..'])(
    'RVM96W3-F3 denies bare parent argument in both adapters and engine: %s',
    async (command) => {
      const policy = {
        ...input(),
        role: { ...ROLE, roleId: 'qa' as const, toolGroups: ['testShell', 'report'] as const },
        dialect: 'powershell' as const,
        readOnlyCommands: new Set<string>(),
        testCommands: new Set(['npm test']),
      }
      expect(await isWorkerCommandAllowed({ ...policy, command })).toBe(false)
      expect(
        await classifyMuseWorkerApproval({ ...policy, request: { kind: 'shellCommand', command } }),
      ).toBe('deny')
      expect(
        await answerAcpPermission({
          ...policy,
          toolCall: { toolCallId: 'parent', title: 'test', kind: 'execute', rawInput: { command } },
        }),
      ).toEqual({ action: 'rejectOnce' })
    },
  )
  it.each(['git.exe', 'git.cmd', 'git.bat', 'git.com', 'GIT.BAT', 'GiT.CoM'])(
    'RVM96W3-F4 denies Windows Git suffix %s in both adapters',
    async (executable) => {
      const command = `${executable} push`
      expect(hasRefMove(command, 'powershell')).toBe(true)
      const policy = {
        ...input(),
        role: ROLE,
        dialect: 'powershell' as const,
        readOnlyCommands: new Set<string>(),
      }
      expect(
        await classifyMuseWorkerApproval({ ...policy, request: { kind: 'shellCommand', command } }),
      ).toBe('deny')
      expect(
        await answerAcpPermission({
          ...policy,
          toolCall: { toolCallId: 'suffix', title: 'test', kind: 'execute', rawInput: { command } },
        }),
      ).toEqual({ action: 'rejectOnce' })
    },
  )
  it('RVM96W3-F4 recognizes PATHEXT Git wrappers', () => {
    vi.stubEnv('PATHEXT', '.EXE;.CMD;.BAT;.COM;.PS1')
    try {
      expect(hasRefMove('Git.Ps1 push', 'powershell')).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
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
