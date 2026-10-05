import { fakeWorkerIdentity } from './helpers/workerIdentity'
// M96-W: isolated Muse hosts, canonical roots, bridge admission and role policy.
import { workerPathIdentity } from '../../src/core/team/workers/workerFence'
import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  buildWorkerSessionConfig,
  classifyMuseWorkerApproval,
  hasRefMove,
  hostKindFor,
  isRefMovingGitCommand,
  runMuseCodeWorker,
  userServerExclusion,
  workerServeArgs,
  MuseWorkerCapturePendingError,
  MuseWorkerFolderError,
  type MuseWorkerHostPort,
  type MuseWorkerSessionPort,
  type TeamHostProvider,
} from '../../src/core/team/workers/museCodeWorker'
import { WorkerUntrustedError } from '../../src/core/team/workers/engineWorker'
import type { WorkerRolePolicy, WorkerTask } from '../../src/core/team/workers/workerTypes'

const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'git diff',
  'git log',
  'git show',
  'git blame',
  'git status',
  'ls',
  'cat',
])
const READ_ONLY_ROLE: WorkerRolePolicy = {
  roleId: 'code-review',
  workspaceMode: 'read-only',
  toolGroups: ['read', 'codeIntel', 'readOnlyShell', 'diagnostics', 'skills', 'report'],
  reportShape: 'review',
}
const WRITER_ROLE: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'codeIntel', 'write', 'shell', 'skills', 'report'],
  reportShape: 'summary',
}
const TASK: WorkerTask = {
  taskId: 't-7',
  roleId: 'engineering',
  brief: 'Add the parser.',
  branch: 'agents/engineering/t-7',
  folder: '/storage/agents/engineering/t-7',
  files: [],
}
const IO = { pathIdentity: fakeWorkerIdentity, realPath: (given: string) => Promise.resolve(given) }

function configInput(
  overrides: Partial<Parameters<typeof buildWorkerSessionConfig>[0]> = {},
): Parameters<typeof buildWorkerSessionConfig>[0] {
  return {
    task: TASK,
    role: WRITER_ROLE,
    modelId: 'muse-spark-1.3',
    workspaceRoot: '/repo',
    platform: 'linux',
    io: IO,
    exclusiveUserServers: [],
    bridgeServers: {},
    ...overrides,
  }
}
function classify(
  role: WorkerRolePolicy,
  request: Parameters<typeof classifyMuseWorkerApproval>[0]['request'],
) {
  return classifyMuseWorkerApproval({
    role,
    request,
    dialect: 'bash',
    readOnlyCommands: READ_ONLY_COMMANDS,
    folder: TASK.folder,
    workspaceRoot: '/user/checkout',
    platform: 'linux',
    io: IO,
  })
}

describe('hostKindFor', () => {
  it('runs read-only roles on the read-only host', () => {
    expect(hostKindFor(READ_ONLY_ROLE)).toBe('readOnly')
  })
  it('runs writers on the team host', () => {
    expect(hostKindFor(WRITER_ROLE)).toBe('team')
  })
})
describe('workerServeArgs', () => {
  it('fixes the read-only host with --disable-write and --disable-shell', () => {
    const args = workerServeArgs('readOnly', true)
    expect(args[0]).toBe('serve')
    expect(args).toContain('--disable-write')
    expect(args).toContain('--disable-shell')
    expect(args).toContain('--trust-workspace')
  })
  it('leaves the team host writable', () => {
    expect(workerServeArgs('team', true)).not.toContain('--disable-write')
  })
})
describe('buildWorkerSessionConfig', () => {
  it('starts the session in the task folder with the bridge servers', async () => {
    const config = await buildWorkerSessionConfig(
      configInput({ bridgeServers: { ide: { url: 'http://127.0.0.1:9/mcp', headers: {} } } }),
    )
    expect(config.workspaceRoot).toBe(TASK.folder)
    expect(config.approvalMode).toBe('promptUnmatched')
    expect(Object.keys(config.mcpServers)).toEqual(['ide'])
  })
  it('runs a read-only session in Plan', async () => {
    const config = await buildWorkerSessionConfig(configInput({ role: READ_ONLY_ROLE }))
    expect(config.approvalMode).toBe('denyUnmatched')
  })
  it.each(['/repo', '/repo/sub'])(
    'refuses the workspace instead of a working copy: %s',
    async (folder) => {
      await expect(
        buildWorkerSessionConfig(configInput({ task: { ...TASK, folder } })),
      ).rejects.toBeInstanceOf(MuseWorkerFolderError)
    },
  )
  it.each(['/repo', '/repo/sub', '/', undefined])(
    'RVM96A-4 refuses canonical overlap/unresolved roots: %s',
    async (canonical) => {
      const io = {
        pathIdentity: fakeWorkerIdentity,
        realPath: (given: string) => {
          if (given === '/repo') return Promise.resolve(given)
          return canonical === undefined
            ? Promise.reject(new Error('unresolved'))
            : Promise.resolve(canonical)
        },
      }
      await expect(buildWorkerSessionConfig(configInput({ io }))).rejects.toBeInstanceOf(
        MuseWorkerFolderError,
      )
    },
  )
  it('RVM96A-4 follows the real Linux checkout alias', async () => {
    await expect(
      buildWorkerSessionConfig(
        configInput({
          task: { ...TASK, folder: '/proc/self/cwd' },
          workspaceRoot: process.cwd(),
          io: { pathIdentity: workerPathIdentity, realPath: realpath },
        }),
      ),
    ).rejects.toBeInstanceOf(MuseWorkerFolderError)
  })
  it('RVM96A-4 folds Windows canonical path casing', async () => {
    await expect(
      buildWorkerSessionConfig(
        configInput({
          platform: 'win32',
          workspaceRoot: String.raw`C:\Repo`,
          task: { ...TASK, folder: String.raw`C:\REPO\nested` },
        }),
      ),
    ).rejects.toBeInstanceOf(MuseWorkerFolderError)
  })
})
describe('userServerExclusion', () => {
  it('waits on the step 1 capture instead of guessing the switch', () => {
    expect(() => {
      userServerExclusion(['chrome-control'])
    }).toThrow(MuseWorkerCapturePendingError)
  })
})
describe('isRefMovingGitCommand', () => {
  it('refuses the fence list', () => {
    for (const subcommand of [
      'commit',
      'merge',
      'push',
      'fetch',
      'pull',
      'checkout',
      'switch',
      'update-ref',
      'stash',
      'rebase',
      'reset',
      'remote',
      'clone',
    ]) {
      expect(isRefMovingGitCommand(['git', subcommand]), subcommand).toBe(true)
    }
  })
  it('refuses branch and tag except their listings', () => {
    expect(isRefMovingGitCommand(['git', 'branch', '-f', 'main'])).toBe(true)
    expect(isRefMovingGitCommand(['git', 'branch', '--show-current'])).toBe(false)
    expect(isRefMovingGitCommand(['git', 'tag', '-l'])).toBe(false)
    expect(isRefMovingGitCommand(['git', 'tag', 'v1'])).toBe(true)
  })
  it('refuses another repository through --git-dir', () => {
    expect(isRefMovingGitCommand(['git', '--git-dir=/elsewhere', 'status'])).toBe(true)
  })
  it('allows reads of refs', () => {
    for (const words of [
      ['git', 'status'],
      ['git', 'log', '--oneline'],
      ['git', 'diff', 'main'],
      ['git', 'rev-parse', 'HEAD'],
    ]) {
      expect(isRefMovingGitCommand(words), words.join(' ')).toBe(false)
    }
  })
  it('ignores non-git commands', () => {
    expect(isRefMovingGitCommand(['npm', 'test'])).toBe(false)
  })
  it.each([
    'git -c core.hooksPath=/fake/hooks commit -m change',
    'git -c alias.publish=push publish',
    'git -ccore.hooksPath=/fake/hooks commit',
    'git -C /other status',
    'git -C/other status',
    'git --git-dir /other status',
    'git --work-tree=/other status',
    'git --no-pager commit',
    'git worktree remove /other/copy',
    'git worktree add /other/copy',
    'git worktree move /a /b',
    'git worktree prune',
    '/usr/bin/git push',
    'git cherry-pick HEAD',
  ])('RVM96A-7 fences global options and worktree/ref mutation: %s', (command) => {
    expect(hasRefMove(command, 'bash')).toBe(true)
  })
  it('allows worktree listing', () => {
    expect(isRefMovingGitCommand(['git', '--no-pager', 'worktree', 'list'])).toBe(false)
  })
})
describe('classifyMuseWorkerApproval', () => {
  it('denies a read-only role any write', async () => {
    expect(await classify(READ_ONLY_ROLE, { kind: 'writeFile', path: 'src/a.ts' })).toBe('deny')
  })
  it('denies a ref-moving command without asking', async () => {
    expect(await classify(WRITER_ROLE, { kind: 'shellCommand', command: 'git push' })).toBe('deny')
    expect(await classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'git status' })).toBe(
      'askUser',
    )
  })
  it('denies a command off the read-only list for a read-only role', async () => {
    expect(await classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'npm test' })).toBe(
      'deny',
    )
  })
  it('denies a command for a role without the shell', async () => {
    expect(
      await classify(
        { ...WRITER_ROLE, toolGroups: ['read', 'write', 'report'] },
        { kind: 'shellCommand', command: 'ls' },
      ),
    ).toBe('deny')
  })
  it('denies a compound command even when each part reads', async () => {
    expect(
      await classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'git status && ls' }),
    ).toBe('deny')
  })
  it('sends the rest to the user', async () => {
    expect(await classify(WRITER_ROLE, { kind: 'shellCommand', command: 'npm test' })).toBe(
      'askUser',
    )
    expect(await classify(WRITER_ROLE, { kind: 'writeFile', path: 'src/a.ts' })).toBe('askUser')
  })
  it.each(['', '../../outside.txt', '/user/checkout/src/main.ts', 'src/main.ts'])(
    'RVM96A-6 denies unresolved, out-of-role or escaped writes: %s',
    async (target) => {
      expect(
        await classify(
          { ...WRITER_ROLE, roleId: 'docs', writePaths: ['docs/**'] },
          { kind: 'writeFile', path: target },
        ),
      ).toBe('deny')
    },
  )
  it('RVM96A-6 checks tool groups and denies unknown tools', async () => {
    const docs: WorkerRolePolicy = { ...WRITER_ROLE, roleId: 'docs', writePaths: ['docs/**'] }
    expect(await classify(docs, { kind: 'writeFile', path: 'docs/guide.md' })).toBe('askUser')
    expect(
      await classify(
        { ...docs, toolGroups: ['read', 'report'] },
        { kind: 'writeFile', path: 'docs/guide.md' },
      ),
    ).toBe('deny')
    expect(await classify(WRITER_ROLE, { kind: 'other', tool: 'opaque' })).toBe('deny')
  })
  it('RVM96A-20 admits a full read-only command', async () => {
    expect(await classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'git diff HEAD' })).toBe(
      'askUser',
    )
  })
  it.each([
    'git diff --output=/fake/out',
    'git diff -o/fake/out',
    'git diff --ext-diff',
    'git show --textconv',
    'git -c alias.x=push status',
    'git --exec-path=/fake status',
  ])('RVM96A-20 refuses unsafe read options: %s', async (command) => {
    expect(await classify(READ_ONLY_ROLE, { kind: 'shellCommand', command })).toBe('deny')
  })
  it('RVM96A-20 admits only project QA check commands', async () => {
    const input = {
      role: {
        ...WRITER_ROLE,
        roleId: 'qa' as const,
        toolGroups: ['testShell' as const, 'report' as const],
      },
      dialect: 'bash' as const,
      folder: TASK.folder,
      workspaceRoot: '/user/checkout',
      platform: 'linux' as const,
      io: IO,
      readOnlyCommands: READ_ONLY_COMMANDS,
      testCommands: new Set(['npm test', 'npm run check']),
    }
    for (const [command, decision] of [
      ['npm test', 'askUser'],
      ['npm install', 'deny'],
      ['npm test && git push', 'deny'],
    ]) {
      expect(
        await classifyMuseWorkerApproval({
          ...input,
          request: { kind: 'shellCommand', command: command ?? '' },
        }),
      ).toBe(decision)
    }
  })
})
describe('hasRefMove', () => {
  it('sees a nested push through the wider reading', () => {
    expect(hasRefMove('echo $(git push)', 'bash')).toBe(true)
    expect(hasRefMove('git status', 'bash')).toBe(false)
  })
})
function fakeHosts(): TeamHostProvider & { started: string[] } {
  const started: string[] = []
  const port = (kind: 'team' | 'readOnly'): MuseWorkerHostPort => ({
    hostId: `${kind}-host`,
    kind,
    startSession: (options) => {
      started.push(`${kind}:${options.workspaceRoot}`)
      return Promise.resolve({
        sessionId: `${kind}-session`,
        sendPrompt: () =>
          Promise.resolve({
            stopReason: 'end_turn',
            lastMessage: '```muse-team-report\n{"status":"done","summary":"Done."}\n```',
          }),
        cancel: () => Promise.resolve(),
        dispose: () => undefined,
      })
    },
  })
  return {
    started,
    teamHost: () => Promise.resolve(port('team')),
    readOnlyHost: () => Promise.resolve(port('readOnly')),
  }
}
function museDeps(
  hosts: TeamHostProvider,
  overrides: Partial<Parameters<typeof runMuseCodeWorker>[0]> = {},
): Parameters<typeof runMuseCodeWorker>[0] {
  return {
    ...configInput(),
    prompt: 'Go.',
    isTrusted: true,
    signal: new AbortController().signal,
    hosts,
    ...overrides,
  }
}
function hostsForSession(session: MuseWorkerSessionPort): TeamHostProvider {
  const host: MuseWorkerHostPort = {
    hostId: 'controlled',
    kind: 'team',
    startSession: () => Promise.resolve(session),
  }
  return { teamHost: () => Promise.resolve(host), readOnlyHost: () => Promise.resolve(host) }
}
describe('runMuseCodeWorker', () => {
  it.each(['max_turn_requests', 'max_tokens', 'refusal', 'cancelled'])(
    'RVM96W2C-N6 Muse stop %s cannot substantiate a done block',
    async (stopReason) => {
      const session: MuseWorkerSessionPort = {
        sessionId: 'stop',
        sendPrompt: () =>
          Promise.resolve({
            stopReason,
            lastMessage: '```muse-team-report\n{"status":"done","summary":"Draft success."}\n```',
          }),
        cancel: () => Promise.resolve(),
        dispose: () => undefined,
      }
      const result = await runMuseCodeWorker(museDeps(hostsForSession(session)))
      expect(result.report.ok).toBe(false)
    },
  )
  it('RVM96A-19 cancels a session that finishes opening after abort without prompting it', async () => {
    const opening = Promise.withResolvers<MuseWorkerSessionPort>()
    const entered = Promise.withResolvers<undefined>()
    const session: MuseWorkerSessionPort = {
      sessionId: 'late',
      cancel: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(),
      sendPrompt: vi.fn(() => Promise.resolve({ stopReason: 'end_turn', lastMessage: undefined })),
    }
    const host: MuseWorkerHostPort = {
      hostId: 'late-host',
      kind: 'team',
      startSession: () => {
        entered.resolve(undefined)
        return opening.promise
      },
    }
    const controller = new AbortController()
    const running = runMuseCodeWorker(
      museDeps(
        { teamHost: () => Promise.resolve(host), readOnlyHost: () => Promise.resolve(host) },
        { signal: controller.signal },
      ),
    )
    let hasReturned = false
    void running
      .finally(() => {
        hasReturned = true
      })
      .catch(() => {
        /* Asserted below. */
      })
    try {
      await entered.promise
      controller.abort()
      await vi.waitFor(() => {
        expect(hasReturned).toBe(true)
      })
      await expect(running).rejects.toThrow()
    } finally {
      opening.resolve(session)
      try {
        await running
      } catch {
        /* Abort was asserted above. */
      }
    }
    await vi.waitFor(() => {
      expect(session.cancel).toHaveBeenCalledOnce()
    })
    expect(session.sendPrompt).not.toHaveBeenCalled()
    expect(session.dispose).toHaveBeenCalledOnce()
  })
  it('RVM96A-19 interrupts a pending Muse turn and disposes the session', async () => {
    const entered = Promise.withResolvers<undefined>()
    const reply = Promise.withResolvers<{
      stopReason: 'end_turn'
      lastMessage: string | undefined
    }>()
    const session: MuseWorkerSessionPort = {
      sessionId: 'pending',
      cancel: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(),
      sendPrompt: () => {
        entered.resolve(undefined)
        return reply.promise
      },
    }
    const controller = new AbortController()
    const running = runMuseCodeWorker(
      museDeps(hostsForSession(session), { signal: controller.signal }),
    )
    let isFinished = false
    void running
      .finally(() => {
        isFinished = true
      })
      .catch(() => {
        /* The original promise is asserted below. */
      })
    try {
      await entered.promise
      controller.abort()
      await vi.waitFor(() => {
        expect(isFinished).toBe(true)
      })
      await expect(running).rejects.toThrow()
      expect(session.cancel).toHaveBeenCalledOnce()
      expect(session.dispose).toHaveBeenCalledOnce()
    } finally {
      reply.resolve({ stopReason: 'end_turn', lastMessage: undefined })
      try {
        await running
      } catch {
        /* Cancellation was asserted above. */
      }
    }
  })
  it('RVM96A-19 cancels and disposes a failed Muse session', async () => {
    const session: MuseWorkerSessionPort = {
      sessionId: 'failed',
      sendPrompt: () => Promise.reject(new Error('turn-failed')),
      cancel: vi.fn(() => Promise.reject(new Error('cancel-failed'))),
      dispose: vi.fn(),
    }
    await expect(runMuseCodeWorker(museDeps(hostsForSession(session)))).rejects.toThrow(
      'turn-failed',
    )
    expect(session.cancel).toHaveBeenCalledOnce()
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it('runs a writer on the team host in its working copy', async () => {
    const hosts = fakeHosts()
    const result = await runMuseCodeWorker(museDeps(hosts))
    expect(hosts.started).toEqual([`team:${TASK.folder}`])
    expect(result.sessionId).toBe('team-session')
    expect(result.report).toEqual({ ok: true, report: { status: 'done', summary: 'Done.' } })
  })
  it('runs a read-only role on the read-only host', async () => {
    const hosts = fakeHosts()
    const folder = '/storage/agents/code-review/t-7'
    await runMuseCodeWorker(museDeps(hosts, { task: { ...TASK, folder }, role: READ_ONLY_ROLE }))
    expect(hosts.started).toEqual([`readOnly:${folder}`])
  })
  it('refuses an untrusted workspace before any host starts', async () => {
    const hosts = fakeHosts()
    await expect(runMuseCodeWorker(museDeps(hosts, { isTrusted: false }))).rejects.toBeInstanceOf(
      WorkerUntrustedError,
    )
    expect(hosts.started).toEqual([])
  })
  it('RVM96A-8 refuses an exclusive native server before obtaining any host', async () => {
    const hosts = fakeHosts()
    let wasObtained = false
    await expect(
      runMuseCodeWorker(
        museDeps(
          {
            ...hosts,
            teamHost: () => {
              wasObtained = true
              return hosts.teamHost()
            },
          },
          { exclusiveUserServers: ['chrome-control'] },
        ),
      ),
    ).rejects.toBeInstanceOf(MuseWorkerCapturePendingError)
    expect(wasObtained).toBe(false)
    expect(hosts.started).toEqual([])
  })
})
