import { fakeWorkerIdentity } from './helpers/workerIdentity'
// M77's attempt host for engine workers (M96 lane W): the prompt order
// and caps, the shell's confinement, the `report` tool, the depth guard,
// and limit errors handed to lane A's marks.

import { describe, expect, it, vi } from 'vitest'
import type {
  WorktreeSession,
  WorktreeSessionEvent,
} from '../../src/core/bestOfN/worktreeConversationHost'
import {
  buildWorkerPrompt,
  checkWorkerDepth,
  classifyLimitError,
  createReportCapture,
  createWorkerShellRunner,
  resolveWorkerReport,
  runEngineWorker,
  WorkerBriefError,
  WorkerDepthError,
  WorkerUntrustedError,
  type EngineWorkerDeps,
  type WorkerShellSpawn,
} from '../../src/core/team/workers/engineWorker'
import type { WorkerFileIo } from '../../src/core/team/workers/engineWorker'
import type {
  WorkerPromptParts,
  WorkerRolePolicy,
  WorkerTask,
} from '../../src/core/team/workers/workerTypes'
import { FakeLogOutputChannel } from './helpers/fakes'
import { WORKER_BRIEF_FILES_MAX_BYTES } from '../../src/shared/constants'

const ROLE: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'shell', 'report'],
  reportShape: 'summary',
}

const TASK: WorkerTask = {
  taskId: 't-1',
  roleId: 'engineering',
  brief: 'Add the parser.',
  branch: 'agents/engineering/t-1',
  folder: '/storage/agents/engineering/t-1',
  files: [],
}

const PARTS: WorkerPromptParts = {
  charter: 'You are the engineering worker.',
  body: 'Write clean code.',
  rulesAndSkills: 'Follow the repo rules.',
}

function resolveRealPath(absolutePath: string): Promise<string> {
  return Promise.resolve(absolutePath)
}

function readFilesFrom(files: Readonly<Record<string, string>>) {
  return (absolutePath: string): Promise<string | undefined> => Promise.resolve(files[absolutePath])
}

function fileIo(files: Readonly<Record<string, string>> = {}): WorkerFileIo {
  return {
    pathIdentity: fakeWorkerIdentity,
    realPath: resolveRealPath,
    readTextFile: readFilesFrom(files),
  }
}

function resolvedVoid(): Promise<void> {
  return Promise.resolve()
}

class FakeSession implements WorktreeSession {
  private listener: ((event: WorktreeSessionEvent) => void) | undefined
  public readonly sessionId = 'worker-session'
  public readonly sent: string[] = []
  public readonly decideApproval = vi.fn<WorktreeSession['decideApproval']>(resolvedVoid)
  public readonly cancelQuestions = vi.fn<WorktreeSession['cancelQuestions']>(resolvedVoid)
  public readonly cancel = vi.fn<WorktreeSession['cancel']>(resolvedVoid)

  public onEvent(listener: (event: WorktreeSessionEvent) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = undefined
    }
  }

  public sendTurn(
    parts: readonly [{ readonly type: 'text'; readonly text: string }],
  ): Promise<unknown> {
    this.sent.push(parts[0].text)
    this.listener?.({ type: 'turnStarted', turnId: 'turn-1' })
    this.listener?.({ type: 'modelRequestCompleted' })
    this.listener?.({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'stopped' })
    return Promise.resolve({ turnId: 'turn-1' })
  }
}

/** A limit-shaped failure that is still an Error, as promise rules require. */
class StatusFailure extends Error {
  public readonly status = 429
  public readonly retryAfter = '60'
}

class FailingSession extends FakeSession {
  public constructor(private readonly failure: unknown) {
    super()
  }

  public override sendTurn(): Promise<unknown> {
    if (this.failure instanceof Error) {
      throw this.failure
    }
    throw new Error(`failing session: ${String(this.failure)}`)
  }
}

function depsWith(
  overrides: Partial<EngineWorkerDeps> & { session: WorktreeSession },
): EngineWorkerDeps {
  return {
    task: TASK,
    workspaceRoot: '/user/checkout',
    role: ROLE,
    prompt: PARTS,
    isTrusted: true,
    io: fileIo(),
    platform: 'linux',
    requestCeiling: 5,
    declineChoiceId: 'abort',
    agentId: 'agent-1',
    marks: { markRateLimited: () => undefined, markUsageLimited: () => undefined },
    log: new FakeLogOutputChannel(),
    ...overrides,
  }
}

describe('buildWorkerPrompt', () => {
  it('RVM96W2C-N14 labels inlined bounded excerpts as possibly truncated', async () => {
    const data = 'x'.repeat(WORKER_BRIEF_FILES_MAX_BYTES)
    const prompt = await buildWorkerPrompt(
      PARTS,
      { ...TASK, files: ['large.txt'] },
      fileIo({ [`${TASK.folder}/large.txt`]: data }),
      'linux',
      '/user/checkout',
    )
    expect(prompt).toContain('(bounded excerpt; may be truncated)')
    expect(prompt).toContain(data)
  })

  it('orders charter, body, rules, then the task', async () => {
    const prompt = await buildWorkerPrompt(PARTS, TASK, fileIo(), 'linux', '/user/checkout')
    const charterAt = prompt.indexOf(PARTS.charter)
    const bodyAt = prompt.indexOf(PARTS.body)
    const rulesAt = prompt.indexOf(PARTS.rulesAndSkills)
    const taskAt = prompt.indexOf('Task t-1')
    expect(charterAt).toBeGreaterThanOrEqual(0)
    expect(bodyAt).toBeGreaterThan(charterAt)
    expect(rulesAt).toBeGreaterThan(bodyAt)
    expect(taskAt).toBeGreaterThan(rulesAt)
    expect(prompt).toContain('agents/engineering/t-1')
    expect(prompt).toContain(TASK.folder)
    expect(prompt).toContain('Add the parser.')
  })

  it('never carries the parent conversation', async () => {
    const prompt = await buildWorkerPrompt(PARTS, TASK, fileIo(), 'linux', '/user/checkout')
    expect(prompt).not.toContain('parent conversation')
    expect(prompt).not.toContain('earlier user message')
  })

  it('refuses a brief past the cap', async () => {
    const long = { ...TASK, brief: `x${'y'.repeat(8000)}` }
    await expect(
      buildWorkerPrompt(PARTS, long, fileIo(), 'linux', '/user/checkout'),
    ).rejects.toBeInstanceOf(WorkerBriefError)
  })

  it('inlines small named files as data inside the folder', async () => {
    const task: WorkerTask = { ...TASK, files: ['src/a.ts'] }
    const io = fileIo({ '/storage/agents/engineering/t-1/src/a.ts': 'export const a = 1' })
    const prompt = await buildWorkerPrompt(PARTS, task, io, 'linux', '/user/checkout')
    expect(prompt).toContain('marked as data')
    expect(prompt).toContain('export const a = 1')
  })

  it('names an escaped file without reading its contents', async () => {
    const task: WorkerTask = { ...TASK, files: ['../secret.txt'] }
    const prompt = await buildWorkerPrompt(PARTS, task, fileIo(), 'linux', '/user/checkout')
    expect(prompt).toContain('Files: ../secret.txt')
    expect(prompt).not.toContain('File data')
  })

  it('RVM96A-3 refuses private and protected prompt reads including aliases', async () => {
    const readTextFile = vi.fn(() => Promise.resolve('synthetic-private-sentinel'))
    const io: WorkerFileIo = {
      pathIdentity: fakeWorkerIdentity,
      realPath: (given) =>
        Promise.resolve(given.endsWith('/alias.txt') ? `${TASK.folder}/.env` : given),
      readTextFile,
    }
    const files = [
      '.env',
      '.env.production',
      'key.pem',
      '.muse/config.json',
      '.git/config',
      'AGENTS.md',
      'alias.txt',
    ]
    const prompt = await buildWorkerPrompt(PARTS, { ...TASK, files }, io, 'linux', '/user/checkout')
    expect(readTextFile).not.toHaveBeenCalled()
    expect(prompt).not.toContain('synthetic-private-sentinel')
    for (const file of files) expect(prompt).toContain(file)
  })

  it('RVM96A-21 bounds aggregate UTF-8 data and always names unreadable files', async () => {
    const content = '漢'.repeat(20_000)
    const readTextFile = vi.fn((given: string, maxBytes: number) =>
      Promise.resolve(
        given.endsWith('/missing.txt') ? undefined : content.slice(0, Math.floor(maxBytes / 3)),
      ),
    )
    const files = ['first.txt', 'second.txt', 'missing.txt', 'after-cap.txt']
    const prompt = await buildWorkerPrompt(
      PARTS,
      { ...TASK, files },
      { pathIdentity: fakeWorkerIdentity, realPath: resolveRealPath, readTextFile },
      'linux',
      '/user/checkout',
    )
    const data = (prompt.match(/漢/g) ?? []).join('')
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(WORKER_BRIEF_FILES_MAX_BYTES)
    for (const file of files) expect(prompt).toContain(file)
    expect(readTextFile.mock.calls[1]?.[1]).toBe(
      WORKER_BRIEF_FILES_MAX_BYTES - Buffer.byteLength(content, 'utf8'),
    )
  })

  it('refuses oversized text from a faulty bounded reader', async () => {
    const prompt = await buildWorkerPrompt(
      PARTS,
      { ...TASK, files: ['large.txt'] },
      fileIo({
        [`${TASK.folder}/large.txt`]: '漢'.repeat(WORKER_BRIEF_FILES_MAX_BYTES),
      }),
      'linux',
      '/user/checkout',
    )
    expect(prompt).not.toContain('漢')
  })
})

describe('createWorkerShellRunner', () => {
  it('runs in the task folder with a scrubbed environment', async () => {
    const seen: { cwd?: string; env?: NodeJS.ProcessEnv }[] = []
    const spawn: WorkerShellSpawn = (input) => {
      seen.push({ cwd: input.cwd, env: input.env })
      return Promise.resolve({ wait: () => Promise.resolve({ exitCode: 0 }) })
    }
    const run = createWorkerShellRunner({
      root: TASK.folder,
      workspaceRoot: '/user/checkout',
      role: ROLE,
      io: fileIo(),
      readOnlyCommands: new Set(['git status']),
      platform: 'linux',
      baseEnv: { PATH: '/usr/bin', META_API_KEY: 'key-1' },
      spawn,
    })
    await expect(run('npm', ['test'])).resolves.toEqual({ exitCode: 0 })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.cwd).toBe(TASK.folder)
    expect(seen[0]?.env?.['META_API_KEY']).toBeUndefined()
    expect(seen[0]?.env?.['GIT_TERMINAL_PROMPT']).toBe('0')
  })
})

describe('report capture', () => {
  it('prefers the report call over the last message', () => {
    const capture = createReportCapture()
    expect(capture.called(JSON.stringify({ status: 'done', summary: 'Via tool.' }))).toBe(
      'reported',
    )
    const outcome = resolveWorkerReport({
      reportedText: capture.take(),
      lastMessage: '```muse-team-report\n{"status":"failed","summary":"Other"}\n```',
    })
    expect(outcome).toEqual({ ok: true, report: { status: 'done', summary: 'Via tool.' } })
  })

  it('falls back to the last message block', () => {
    const outcome = resolveWorkerReport({
      reportedText: undefined,
      lastMessage: '```muse-team-report\n{"status":"capped","summary":"Hit the cap"}\n```',
    })
    expect(outcome).toEqual({ ok: true, report: { status: 'capped', summary: 'Hit the cap' } })
  })
})

describe('classifyLimitError', () => {
  it('marks a 429 with its Retry-After as rate-limited', () => {
    expect(classifyLimitError({ status: 429, retryAfter: '120' })).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 120_000,
    })
  })

  it('marks a recognised usage-limit handoff', () => {
    expect(classifyLimitError({ code: 'usage_limited' })).toEqual({ kind: 'usageLimited' })
  })

  it('leaves an uncaptured shape a plain failure', () => {
    expect(classifyLimitError(new Error('boom'))).toBeUndefined()
    expect(classifyLimitError({ status: 500 })).toBeUndefined()
    expect(classifyLimitError('nope')).toBeUndefined()
  })
})

describe('runEngineWorker', () => {
  it('RVM96W2C-N8 retains the last message after a malformed report call', async () => {
    const capture = createReportCapture()
    capture.called('{"status":"done"')
    const tail = vi.fn(() => Promise.resolve('Tests failed; parser remains incomplete.'))
    const result = await runEngineWorker(
      depsWith({ session: new FakeSession(), capture, readTranscriptTail: tail }),
    )
    expect(tail).toHaveBeenCalledOnce()
    expect(result.report).toEqual({
      ok: false,
      status: 'unstructured',
      summary: 'Tests failed; parser remains incomplete.',
    })
  })

  it('runs the attempt confined to the task folder and reports', async () => {
    const session = new FakeSession()
    const capture = createReportCapture()
    capture.called(JSON.stringify({ status: 'done', summary: 'Done.' }))
    const result = await runEngineWorker(depsWith({ session, capture }))
    expect(session.sent).toHaveLength(1)
    expect(session.sent[0]).toContain('You are the engineering worker.')
    expect(result.outcome.requestsMade).toBe(1)
    expect(result.report).toEqual({ ok: true, report: { status: 'done', summary: 'Done.' } })
  })

  it('refuses an untrusted workspace before anything runs', async () => {
    const session = new FakeSession()
    await expect(runEngineWorker(depsWith({ session, isTrusted: false }))).rejects.toBeInstanceOf(
      WorkerUntrustedError,
    )
    expect(session.sent).toHaveLength(0)
  })

  it('marks the agent on a rate limit and rethrows', async () => {
    const markRateLimited = vi.fn()
    const failing: WorktreeSession = new FailingSession(new StatusFailure())
    await expect(
      runEngineWorker(
        depsWith({
          session: failing,
          marks: { markRateLimited, markUsageLimited: () => undefined },
        }),
      ),
    ).rejects.toBeInstanceOf(StatusFailure)
    expect(markRateLimited).toHaveBeenCalledWith('agent-1', 60_000)
  })

  it('does not mark a plain failure', async () => {
    const markRateLimited = vi.fn()
    const markUsageLimited = vi.fn()
    const failing: WorktreeSession = new FailingSession(new Error('boom'))
    await expect(
      runEngineWorker(depsWith({ session: failing, marks: { markRateLimited, markUsageLimited } })),
    ).rejects.toThrow('boom')
    expect(markRateLimited).not.toHaveBeenCalled()
    expect(markUsageLimited).not.toHaveBeenCalled()
  })
})

describe('checkWorkerDepth', () => {
  it('allows depth 1, and depth 2 through delegates', () => {
    expect(() => {
      checkWorkerDepth(1, ROLE)
    }).not.toThrow()
    expect(() => {
      checkWorkerDepth(2, { ...ROLE, delegates: ['research'] })
    }).not.toThrow()
  })

  it('refuses depth past delegates or past the bound', () => {
    expect(() => {
      checkWorkerDepth(2, ROLE)
    }).toThrow(WorkerDepthError)
    expect(() => {
      checkWorkerDepth(3, { ...ROLE, delegates: ['research'] })
    }).toThrow(WorkerDepthError)
  })
})
