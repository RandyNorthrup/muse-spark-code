// The ACP client worker (M96 lane W): the preset modes, the permission
// answers, the confined `fs/*`, and the run over an injected connection.

import { describe, expect, it, vi } from 'vitest'
import {
  ACP_PRESETS,
  acpFsRead,
  acpFsWrite,
  answerAcpPermission,
  asAcpError,
  AcpAuthRequiredError,
  AcpForbiddenModeError,
  AcpMethodNotFoundError,
  AcpModeError,
  AcpNativeServersError,
  chooseAcpMode,
  confineAcpFsPath,
  extractRequestPaths,
  pickOnceOption,
  roleShapeFor,
  runAcpWorker,
  type AcpAgentConnection,
  type AcpPermissionInput,
} from '../../src/core/team/workers/acpWorker'
import { WorkerUntrustedError } from '../../src/core/team/workers/engineWorker'
import type { WorkerRolePolicy, WorkerTask } from '../../src/core/team/workers/workerTypes'

const FOLDER = '/storage/agents/engineering/t-9'

const WRITER: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'shell', 'skills', 'report'],
  reportShape: 'summary',
}

const READ_ONLY: WorkerRolePolicy = {
  roleId: 'code-review',
  workspaceMode: 'read-only',
  toolGroups: ['read', 'codeIntel', 'readOnlyShell', 'skills', 'report'],
  reportShape: 'review',
}

const TASK: WorkerTask = {
  taskId: 't-9',
  roleId: 'engineering',
  brief: 'Add the parser.',
  branch: 'agents/engineering/t-9',
  folder: FOLDER,
  files: [],
}

const IO = { realPath: (absolutePath: string) => Promise.resolve(absolutePath) }

function permission(
  role: WorkerRolePolicy,
  toolCall: AcpPermissionInput['toolCall'],
  writePaths?: readonly string[],
): Promise<{ readonly action: string }> {
  return answerAcpPermission({
    role: writePaths === undefined ? role : { ...role, writePaths },
    folder: FOLDER,
    platform: 'linux',
    io: IO,
    dialect: 'bash',
    readOnlyCommands: new Set(['git diff', 'git log', 'git show', 'git blame', 'git status', 'ls']),
    toolCall,
  })
}

describe('roleShapeFor', () => {
  it('maps read-only, write-paths and whole-branch roles', () => {
    expect(roleShapeFor(READ_ONLY)).toBe('readOnly')
    expect(roleShapeFor({ ...WRITER, writePaths: ['docs/**'] })).toBe('writePaths')
    expect(roleShapeFor(WRITER)).toBe('engineering')
  })
})

describe('chooseAcpMode', () => {
  it('picks the preset table mode when the agent offers it', () => {
    expect(chooseAcpMode(ACP_PRESETS.claude, 'readOnly', ['default', 'plan'])).toBe('plan')
    expect(chooseAcpMode(ACP_PRESETS.codex, 'engineering', ['read-only', 'workspace-write'])).toBe(
      'workspace-write',
    )
  })

  it('refuses when the agent does not offer the table mode', () => {
    expect(() => chooseAcpMode(ACP_PRESETS.claude, 'readOnly', ['default'])).toThrow(AcpModeError)
  })

  it('refuses a shape the table leaves unmapped', () => {
    expect(() => chooseAcpMode(ACP_PRESETS.codex, 'writePaths', ['workspace-write'])).toThrow(
      AcpModeError,
    )
    expect(() => chooseAcpMode(ACP_PRESETS.gemini, 'readOnly', ['plan'])).toThrow(AcpModeError)
  })

  it('never takes a mode that skips asking, even advertised', () => {
    const bypassing = {
      ...ACP_PRESETS.claude,
      modes: { ...ACP_PRESETS.claude.modes, readOnly: 'bypassPermissions' as const },
    }
    expect(() => chooseAcpMode(bypassing, 'readOnly', ['bypassPermissions'])).toThrow(
      AcpForbiddenModeError,
    )
  })
})

describe('pickOnceOption', () => {
  const options = [
    { optionId: 'a-once', kind: 'allow_once' as const },
    { optionId: 'a-always', kind: 'allow_always' as const },
    { optionId: 'r-once', kind: 'reject_once' as const },
  ]

  it('forwards only the once options', () => {
    expect(pickOnceOption(options, true)).toBe('a-once')
    expect(pickOnceOption(options, false)).toBe('r-once')
  })

  it('has no answer when the once option is missing', () => {
    expect(pickOnceOption([{ optionId: 'a-always', kind: 'allow_always' }], true)).toBeUndefined()
  })
})

describe('extractRequestPaths', () => {
  it('collects absolute paths two levels down', () => {
    const extracted = extractRequestPaths({ command: 'git diff', path: '/repo/a.ts' })
    expect(extracted.paths).toEqual(['/repo/a.ts'])
    expect(extracted.isTruncated).toBe(false)
  })

  it('ignores relative text and non-strings', () => {
    expect(extractRequestPaths({ command: 'ls', count: 3 }).paths).toEqual([])
  })
})

describe('answerAcpPermission', () => {
  it('RVM96A-6 rejects relative escapes, missing paths, opaque commands and unknown tools', async () => {
    for (const toolCall of [
      { toolCallId: 'c1', title: 'edit', kind: 'edit', rawInput: { path: '../../outside.txt' } },
      { toolCallId: 'c1', title: 'edit', kind: 'edit', rawInput: {} },
      { toolCallId: 'c1', title: 'run', kind: 'execute', rawInput: {} },
      { toolCallId: 'c1', title: 'unknown', kind: 'other', rawInput: {} },
    ]) {
      expect(await permission(WRITER, toolCall, ['docs/**'])).toEqual({ action: 'rejectOnce' })
    }
    expect(
      await permission(READ_ONLY, { toolCallId: 'c1', title: 'run', kind: 'execute' }),
    ).toEqual({ action: 'rejectOnce' })
    expect(
      await permission(
        WRITER,
        { toolCallId: 'c1', title: 'edit', kind: 'edit', rawInput: { path: 'docs/a.md' } },
        ['docs/**'],
      ),
    ).toEqual({ action: 'askUser' })
  })

  it('RVM96A-20 consumes full read commands and project QA test commands', async () => {
    expect(
      await permission(READ_ONLY, {
        toolCallId: 'c1',
        title: 'run',
        kind: 'execute',
        rawInput: { command: 'git diff HEAD' },
      }),
    ).toEqual({ action: 'askUser' })
    expect(
      await permission(READ_ONLY, {
        toolCallId: 'c1',
        title: 'run',
        kind: 'execute',
        rawInput: { command: 'git diff --output=/fake/out' },
      }),
    ).toEqual({ action: 'rejectOnce' })
    const input: AcpPermissionInput = {
      role: { ...WRITER, roleId: 'qa', toolGroups: ['testShell', 'report'] },
      folder: FOLDER,
      platform: 'linux',
      io: IO,
      dialect: 'bash',
      readOnlyCommands: new Set(),
      testCommands: new Set(['npm test']),
      toolCall: {
        toolCallId: 'c1',
        title: 'test',
        kind: 'execute',
        rawInput: { command: 'npm test' },
      },
    }
    expect(await answerAcpPermission(input)).toEqual({ action: 'askUser' })
    expect(
      await answerAcpPermission({
        ...input,
        toolCall: { ...input.toolCall, rawInput: { command: 'npm install' } },
      }),
    ).toEqual({ action: 'rejectOnce' })
  })

  it('rejects a path outside the working copy without asking', async () => {
    const verdict = await permission(WRITER, {
      toolCallId: 'c1',
      title: 'read',
      kind: 'read',
      locations: [{ path: '/etc/passwd' }],
    })
    expect(verdict.action).toBe('rejectOnce')
  })

  it('rejects a link that leads outside, links followed', async () => {
    const linking = {
      realPath: (absolutePath: string) =>
        Promise.resolve(absolutePath === `${FOLDER}/link` ? '/etc/shadow' : absolutePath),
    }
    const verdict = await answerAcpPermission({
      role: WRITER,
      folder: FOLDER,
      platform: 'linux',
      io: linking,
      dialect: 'bash',
      readOnlyCommands: new Set(['git']),
      toolCall: { toolCallId: 'c1', title: 'read', kind: 'read', locations: [{ path: 'link' }] },
    })
    expect(verdict.action).toBe('rejectOnce')
  })

  it('rejects an edit outside the write paths', async () => {
    const verdict = await permission(
      WRITER,
      { toolCallId: 'c1', title: 'edit', kind: 'edit', locations: [{ path: 'src/a.ts' }] },
      ['docs/**'],
    )
    expect(verdict.action).toBe('rejectOnce')
  })

  it('allows an edit under the write paths to reach the user', async () => {
    const verdict = await permission(
      WRITER,
      { toolCallId: 'c1', title: 'edit', kind: 'edit', locations: [{ path: 'docs/a.md' }] },
      ['docs/**'],
    )
    expect(verdict.action).toBe('askUser')
  })

  it('rejects an execute for a role without the shell', async () => {
    const verdict = await permission(
      { ...WRITER, toolGroups: ['read', 'write', 'report'] },
      { toolCallId: 'c1', title: 'run', kind: 'execute', rawInput: { command: 'npm test' } },
    )
    expect(verdict.action).toBe('rejectOnce')
  })

  it('rejects a ref-moving command without asking', async () => {
    const verdict = await permission(WRITER, {
      toolCallId: 'c1',
      title: 'run',
      kind: 'execute',
      rawInput: { command: 'git push' },
    })
    expect(verdict.action).toBe('rejectOnce')
  })

  it('rejects any edit and any off-list command for a read-only role', async () => {
    const edit = await permission(READ_ONLY, {
      toolCallId: 'c1',
      title: 'edit',
      kind: 'edit',
      locations: [{ path: 'a.ts' }],
    })
    expect(edit.action).toBe('rejectOnce')
    const command = await permission(READ_ONLY, {
      toolCallId: 'c2',
      title: 'run',
      kind: 'execute',
      rawInput: { command: 'npm test' },
    })
    expect(command.action).toBe('rejectOnce')
  })

  it('sends an on-list read-only command to the user', async () => {
    const verdict = await permission(READ_ONLY, {
      toolCallId: 'c1',
      title: 'run',
      kind: 'execute',
      rawInput: { command: 'git status' },
    })
    expect(verdict.action).toBe('askUser')
  })

  it('rejects a fetch for a role without the network', async () => {
    const verdict = await permission(WRITER, {
      toolCallId: 'c1',
      title: 'fetch',
      kind: 'fetch',
      locations: [],
    })
    expect(verdict.action).toBe('rejectOnce')
  })
})

describe('confineAcpFsPath', () => {
  it('keeps fs paths inside the working copy', async () => {
    await expect(
      confineAcpFsPath({ folder: FOLDER, given: 'a.ts', platform: 'linux', io: IO }),
    ).resolves.toEqual({ ok: true, absolute: `${FOLDER}/a.ts` })
    await expect(
      confineAcpFsPath({ folder: FOLDER, given: '../out.ts', platform: 'linux', io: IO }),
    ).resolves.toEqual({ ok: false })
  })
})

describe('acpFsRead', () => {
  const files: Record<string, string> = { [`${FOLDER}/a.ts`]: 'content' }
  const input = {
    role: READ_ONLY,
    folder: FOLDER,
    platform: 'linux' as const,
    io: IO,
    readTextFile: (absolutePath: string) => Promise.resolve(files[absolutePath]),
    writeTextFile: () => Promise.resolve(),
  }

  it('reads inside the copy and refuses outside', async () => {
    await expect(acpFsRead(input, 'a.ts')).resolves.toEqual({ content: 'content' })
    await expect(acpFsRead(input, '../out.ts')).resolves.toEqual({
      error: 'outside the working copy',
    })
  })
})

describe('acpFsWrite', () => {
  const written: Record<string, string> = {}
  const input = {
    role: { ...WRITER, writePaths: ['docs/**'] as const },
    folder: FOLDER,
    platform: 'linux' as const,
    io: IO,
    readTextFile: () => Promise.resolve(undefined),
    writeTextFile: (absolutePath: string, content: string) => {
      written[absolutePath] = content
      return Promise.resolve()
    },
  }

  it('writes under the write paths and refuses the rest', async () => {
    await expect(acpFsWrite(input, 'docs/a.md', 'hi')).resolves.toEqual({ ok: true })
    expect(written[`${FOLDER}/docs/a.md`]).toBe('hi')
    await expect(acpFsWrite(input, 'src/a.ts', 'hi')).resolves.toEqual({
      error: 'outside the write paths',
    })
    await expect(acpFsWrite(input, '../out.ts', 'hi')).resolves.toEqual({
      error: 'outside the working copy',
    })
  })

  it('never writes for a read-only role', async () => {
    await expect(acpFsWrite({ ...input, role: READ_ONLY }, 'docs/a.md', 'hi')).resolves.toEqual({
      error: 'the role is read-only',
    })
  })
})

describe('asAcpError', () => {
  it('turns auth_required into the sign-in handoff', () => {
    const error = asAcpError({ code: 'auth_required' })
    expect(error).toBeInstanceOf(AcpAuthRequiredError)
  })

  it('passes anything else through', () => {
    const failure = new Error('boom')
    expect(asAcpError(failure)).toBe(failure)
  })
})

function connectionWith(overrides: Partial<AcpAgentConnection>): AcpAgentConnection {
  return {
    initialize: () => Promise.resolve({ protocolVersion: 1, authMethods: [] }),
    sessionNew: () => Promise.resolve({ sessionId: 's-1', advertisedModes: ['default', 'plan'] }),
    setConfigOption: () => Promise.resolve(),
    setMode: () => Promise.resolve(),
    prompt: () =>
      Promise.resolve({
        stopReason: 'end_turn',
        lastMessage: '```muse-team-report\n{"status":"done","summary":"Done."}\n```',
      }),
    cancel: () => Promise.resolve(),
    close: () => undefined,
    ...overrides,
  }
}

function depsWith(overrides: { connection: AcpAgentConnection }) {
  return {
    task: TASK,
    role: WRITER,
    preset: ACP_PRESETS.claude,
    prompt: {
      charter: 'You are the engineering worker.',
      body: 'Write clean code.',
      rulesAndSkills: 'Follow the repo rules.',
    },
    workspaceRoot: '/user/checkout',
    nativeServersExcluded: true,
    isTrusted: true,
    io: { ...IO, readTextFile: () => Promise.resolve(undefined) },
    platform: 'linux' as const,
    bridgeServers: [],
    ...overrides,
  }
}

/** A wire-shaped refusal that is still an Error, as promise rules require. */
class AuthRequiredFailure extends Error {
  public readonly code = 'auth_required'
}

describe('runAcpWorker', () => {
  it('RVM96A-4 refuses the checkout and its aliases before initialize', async () => {
    const initialize = vi.fn(() => Promise.resolve({ protocolVersion: 1, authMethods: [] }))
    const connection = connectionWith({ initialize })
    for (const folder of ['/user/checkout', '/user/checkout/sub', '/user', '/alias']) {
      await expect(
        runAcpWorker({
          ...depsWith({ connection }),
          task: { ...TASK, folder },
          io: {
            realPath: (given) => Promise.resolve(given === '/alias' ? '/user/checkout' : given),
            readTextFile: () => Promise.resolve(undefined),
          },
        }),
      ).rejects.toThrow()
    }
    expect(initialize).not.toHaveBeenCalled()
  })

  it('RVM96A-8 requires native-server isolation before initialize', async () => {
    const initialize = vi.fn(() => Promise.resolve({ protocolVersion: 1, authMethods: [] }))
    const connection = connectionWith({ initialize })
    await expect(
      runAcpWorker({ ...depsWith({ connection }), nativeServersExcluded: false }),
    ).rejects.toBeInstanceOf(AcpNativeServersError)
    expect(initialize).not.toHaveBeenCalled()
  })
  it('initializes, opens the session in the folder, sets the mode and reports', async () => {
    const seen: string[] = []
    const connection = connectionWith({
      sessionNew: (params) => {
        seen.push(`cwd:${params.cwd}`, `servers:${String(params.mcpServers.length)}`)
        return Promise.resolve({ sessionId: 's-1', advertisedModes: ['default', 'plan'] })
      },
      setConfigOption: (sessionId, value) => {
        seen.push(`mode:${sessionId}:${value}`)
        return Promise.resolve()
      },
      prompt: (sessionId, text) => {
        seen.push(`prompt:${sessionId}:${String(text.includes('You are the engineering worker.'))}`)
        return Promise.resolve({ stopReason: 'end_turn', lastMessage: 'no block' })
      },
    })
    const result = await runAcpWorker(depsWith({ connection }))
    expect(seen).toEqual([`cwd:${FOLDER}`, 'servers:0', 'mode:s-1:default', 'prompt:s-1:true'])
    expect(result.sessionId).toBe('s-1')
    expect(result.report).toEqual({ ok: false, status: 'unstructured', summary: 'no block' })
  })

  it('falls back to set_mode when the agent predates config options', async () => {
    const setMode = vi.fn(() => Promise.resolve())
    const connection = connectionWith({
      setConfigOption: () =>
        Promise.reject(new AcpMethodNotFoundError('session/set_config_option')),
      setMode,
    })
    await runAcpWorker(depsWith({ connection }))
    expect(setMode).toHaveBeenCalledWith('s-1', 'default')
  })

  it('hands an auth_required session to the sign-in flow', async () => {
    const connection = connectionWith({
      sessionNew: () => Promise.reject(new AuthRequiredFailure()),
    })
    await expect(runAcpWorker(depsWith({ connection }))).rejects.toBeInstanceOf(
      AcpAuthRequiredError,
    )
  })

  it('refuses an untrusted workspace before initializing', async () => {
    const initialize = vi.fn(() => Promise.resolve({ protocolVersion: 1, authMethods: [] }))
    const connection = connectionWith({ initialize })
    await expect(
      runAcpWorker({ ...depsWith({ connection }), isTrusted: false }),
    ).rejects.toBeInstanceOf(WorkerUntrustedError)
    expect(initialize).not.toHaveBeenCalled()
  })
})
