// The Muse Code worker (M96 lane W): the team host and the read-only
// host, the session in its working copy, the bridge's servers, and the
// denied-without-asking approvals.

import { describe, expect, it } from 'vitest'
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
  type TeamHostProvider,
} from '../../src/core/team/workers/museCodeWorker'
import { WorkerUntrustedError } from '../../src/core/team/workers/engineWorker'
import type { WorkerRolePolicy, WorkerTask } from '../../src/core/team/workers/workerTypes'

const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set(['git', 'ls', 'cat'])

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

function classify(
  role: WorkerRolePolicy,
  request: Parameters<typeof classifyMuseWorkerApproval>[0]['request'],
) {
  return classifyMuseWorkerApproval({
    role,
    request,
    dialect: 'bash',
    readOnlyCommands: READ_ONLY_COMMANDS,
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
  it('starts the session in the task folder with the bridge servers', () => {
    const config = buildWorkerSessionConfig({
      task: TASK,
      role: WRITER_ROLE,
      modelId: 'muse-spark-1.3',
      workspaceRoot: '/repo',
      bridgeServers: { ide: { url: 'http://127.0.0.1:9/mcp', headers: {} } },
    })
    expect(config.workspaceRoot).toBe(TASK.folder)
    expect(config.approvalMode).toBe('promptUnmatched')
    expect(Object.keys(config.mcpServers)).toEqual(['ide'])
  })

  it('runs a read-only session in Plan', () => {
    const config = buildWorkerSessionConfig({
      task: { ...TASK, folder: '/storage/agents/code-review/t-7' },
      role: READ_ONLY_ROLE,
      modelId: 'muse-spark-1.3',
      workspaceRoot: '/repo',
      bridgeServers: {},
    })
    expect(config.approvalMode).toBe('denyUnmatched')
  })

  it('refuses the workspace instead of a working copy', () => {
    expect(() =>
      buildWorkerSessionConfig({
        task: { ...TASK, folder: '/repo' },
        role: WRITER_ROLE,
        modelId: 'muse-spark-1.3',
        workspaceRoot: '/repo',
        bridgeServers: {},
      }),
    ).toThrow(MuseWorkerFolderError)
    expect(() =>
      buildWorkerSessionConfig({
        task: { ...TASK, folder: '/repo/sub' },
        role: WRITER_ROLE,
        modelId: 'muse-spark-1.3',
        workspaceRoot: '/repo',
        bridgeServers: {},
      }),
    ).toThrow(MuseWorkerFolderError)
  })
})

describe('userServerExclusion', () => {
  it('waits on the step 1 capture instead of guessing the switch', () => {
    expect(() => userServerExclusion(['chrome-control'])).toThrow(MuseWorkerCapturePendingError)
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
})

describe('classifyMuseWorkerApproval', () => {
  it('denies a read-only role any write', () => {
    expect(classify(READ_ONLY_ROLE, { kind: 'writeFile', path: 'src/a.ts' })).toBe('deny')
  })

  it('denies a ref-moving command without asking', () => {
    expect(classify(WRITER_ROLE, { kind: 'shellCommand', command: 'git push' })).toBe('deny')
    expect(classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'git status' })).not.toBe(
      'deny',
    )
  })

  it('denies a command off the read-only list for a read-only role', () => {
    expect(classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'npm test' })).toBe('deny')
  })

  it('denies a command for a role without the shell', () => {
    const noShell: WorkerRolePolicy = { ...WRITER_ROLE, toolGroups: ['read', 'write', 'report'] }
    expect(classify(noShell, { kind: 'shellCommand', command: 'ls' })).toBe('deny')
  })

  it('denies a compound command even when each part reads', () => {
    expect(classify(READ_ONLY_ROLE, { kind: 'shellCommand', command: 'git status && ls' })).toBe(
      'deny',
    )
  })

  it('sends the rest to the user', () => {
    expect(classify(WRITER_ROLE, { kind: 'shellCommand', command: 'npm test' })).toBe('askUser')
    expect(classify(WRITER_ROLE, { kind: 'writeFile', path: 'src/a.ts' })).toBe('askUser')
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
            lastMessage: '```muse-team-report\n{"status":"done","summary":"Done."}\n```',
          }),
        cancel: () => Promise.resolve(),
      })
    },
  })
  return {
    started,
    teamHost: () => Promise.resolve(port('team')),
    readOnlyHost: () => Promise.resolve(port('readOnly')),
  }
}

describe('runMuseCodeWorker', () => {
  it('runs a writer on the team host in its working copy', async () => {
    const hostProvider = fakeHosts()
    const result = await runMuseCodeWorker({
      task: TASK,
      role: WRITER_ROLE,
      prompt: 'Go.',
      modelId: 'muse-spark-1.3',
      workspaceRoot: '/repo',
      isTrusted: true,
      bridgeServers: {},
      hosts: hostProvider,
    })
    expect(hostProvider.started).toEqual([`team:${TASK.folder}`])
    expect(result.sessionId).toBe('team-session')
    expect(result.report).toEqual({ ok: true, report: { status: 'done', summary: 'Done.' } })
  })

  it('runs a read-only role on the read-only host', async () => {
    const hostProvider = fakeHosts()
    const folder = '/storage/agents/code-review/t-7'
    await runMuseCodeWorker({
      task: { ...TASK, folder },
      role: READ_ONLY_ROLE,
      prompt: 'Go.',
      modelId: 'muse-spark-1.3',
      workspaceRoot: '/repo',
      isTrusted: true,
      bridgeServers: {},
      hosts: hostProvider,
    })
    expect(hostProvider.started).toEqual([`readOnly:${folder}`])
  })

  it('refuses an untrusted workspace before any host starts', async () => {
    const hostProvider = fakeHosts()
    await expect(
      runMuseCodeWorker({
        task: TASK,
        role: WRITER_ROLE,
        prompt: 'Go.',
        modelId: 'muse-spark-1.3',
        workspaceRoot: '/repo',
        isTrusted: false,
        bridgeServers: {},
        hosts: hostProvider,
      }),
    ).rejects.toBeInstanceOf(WorkerUntrustedError)
    expect(hostProvider.started).toEqual([])
  })
})
