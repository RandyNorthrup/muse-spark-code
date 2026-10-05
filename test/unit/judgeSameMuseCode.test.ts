// Lane M98-S: the Muse Code host adapter (PLAN.md M98 acceptance item 5).
// A fresh hidden session per batch (never M90's or the main one), in its own
// empty temporary folder deleted after, in Plan with no MCP servers; the
// judge stays off on standing always-allow rules; the M90 item guard cancels
// on tool items; late results are dropped; the main session's frames never
// change. Fast unit tests run on fakes; the frame test runs the real
// MuseCodeHost over the in-memory MSP transport.

import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import {
  judgeAgain,
  judgeJob,
  judgeOnce,
  SpyJudgeStore,
  startJudgeEntry,
  trackTempRoots,
  untilJudgeSettled,
} from './helpers/judgeSameRig'
import { MuseCodeSameJudge, type MuseCodeJudgeDeps } from '../../src/host/judge/museCodeSameJudge'
import { JudgeResultCache } from '../../src/core/judge/same/resultCache'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, type FakeHostHandle } from './helpers/fakeMsp'
import {
  reviewLeadFrames,
  reviewReplyFrames,
  reviewTurnCompleted,
  reviewTurnStarted,
  sideSessionStarted,
} from './helpers/reviewerCapture'
import { removeFolder } from './helpers/temporaryFolders'

const MODEL = 'muse-spark-1.3-contributor'
const NOUL = { id: 'risk', kind: 'noul' as const, text: 'Is deleting this risky?' }
const folders: string[] = []

afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

function startKey(entries: SpyJudgeStore): string {
  return startJudgeEntry(entries, {
    backend: 'muse-code',
    turnId: 't1',
    tool: 'run_shell',
    args: { command: 'rm -rf /tmp/x' },
  })
}

function itemCompleted(
  turnId: string,
  item: Record<string, unknown>,
): Extract<AgentEvent, { type: 'itemCompleted' }> {
  return {
    type: 'itemCompleted',
    item: { itemId: `${turnId}-item`, kind: 'agentMessage', status: 'completed', turnId, ...item },
  }
}

function turnCompleted(turnId: string): Extract<AgentEvent, { type: 'turnCompleted' }> {
  return { type: 'turnCompleted', turnId, terminal: 'completed' }
}

interface FakeRig {
  readonly entries: SpyJudgeStore
  readonly cache: JudgeResultCache
  readonly errors: unknown[]
  readonly warnings: string[]
  readonly infos: string[]
  readonly host: FakeAgentHost
  readonly sessions: FakeAgentSession[]
  readonly removed: string[]
  readonly sideIds: string[]
  readonly judge: MuseCodeSameJudge
  settingsText: string | undefined
  replyText: string
  emitToolItem: boolean
  autoReply: boolean
  flush: () => void
}

function fakeSetup(): FakeRig {
  const entries = new SpyJudgeStore()
  const cache = new JudgeResultCache()
  const errors: unknown[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const host = new FakeAgentHost()
  const sessions: FakeAgentSession[] = []
  const sideIds: string[] = []
  // Live bindings the deps close over: the returned rig mutates these, never
  // a copy.
  const mutable = {
    settingsText: undefined as string | undefined,
    replyText: '{"answer":"yes","confidence":95}',
    emitToolItem: false,
    autoReply: true,
  }
  const pending: (() => void)[] = []
  const flush = (): void => {
    for (const emit of pending.splice(0)) {
      emit()
    }
  }
  host.startSession.mockImplementation((options) => {
    const session = new FakeAgentSession(`side-${String(sessions.length + 1)}`, options.modelId)
    sessions.push(session)
    session.sendTurn.mockImplementation(() => {
      const submission = { turnId: `turn-${String(sessions.length)}`, disposition: 'started' }
      const emit = (): void => {
        if (mutable.emitToolItem) {
          session.emit(
            itemCompleted(submission.turnId, {
              kind: 'toolCall',
              tool: 'run_shell',
              status: 'inProgress',
            }),
          )
        }
        session.emit(
          itemCompleted(submission.turnId, { kind: 'userMessage', text: 'prompt' }),
          itemCompleted(submission.turnId, { kind: 'agentMessage', text: mutable.replyText }),
          turnCompleted(submission.turnId),
        )
      }
      pending.push(emit)
      if (mutable.autoReply) {
        queueMicrotask(flush)
      }
      return Promise.resolve(submission)
    })
    return Promise.resolve(session)
  })
  const roots = trackTempRoots(folders)
  const removed = roots.removed
  const deps: MuseCodeJudgeDeps = {
    startSession: (options) => host.startSession(options),
    readSettingsText: () => mutable.settingsText,
    makeTempRoot: roots.makeTempRoot,
    removeTempRoot: roots.removeTempRoot,
    entries,
    cache,
    onSideSession: (sessionId) => {
      sideIds.push(sessionId)
    },
    describeFailure: failureForLog,
    logInfo: (message) => {
      infos.push(message)
    },
    logWarn: (message) => {
      warnings.push(message)
    },
    modelId: MODEL,
    timeoutMs: 4000,
    measureTokens: (text) => text.length,
    onError: (error) => {
      errors.push(error)
    },
  }
  return {
    entries,
    cache,
    errors,
    warnings,
    infos,
    host,
    sessions,
    removed,
    sideIds,
    judge: new MuseCodeSameJudge(deps),
    get settingsText() {
      return mutable.settingsText
    },
    set settingsText(value: string | undefined) {
      mutable.settingsText = value
    },
    get replyText() {
      return mutable.replyText
    },
    set replyText(value: string) {
      mutable.replyText = value
    },
    get emitToolItem() {
      return mutable.emitToolItem
    },
    set emitToolItem(value: boolean) {
      mutable.emitToolItem = value
    },
    get autoReply() {
      return mutable.autoReply
    },
    set autoReply(value: boolean) {
      mutable.autoReply = value
    },
    flush,
  }
}

describe('MuseCodeSameJudge on fakes', () => {
  it('judges in a hidden session and deletes its folder after', async () => {
    const rig = fakeSetup()
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'rm -rf /tmp/x', [NOUL]))).toBe(
      'caution',
    )
    expect(rig.host.startSession).toHaveBeenCalledTimes(1)
    const options = rig.host.startSession.mock.calls[0]?.[0]
    expect(options?.modelId).toBe(MODEL)
    expect(options?.approvalMode).toBe('denyUnmatched')
    expect(options !== undefined && 'mcpServers' in options).toBe(false)
    expect(options?.workspaceRoot.startsWith(tmpdir())).toBe(true)
    const session = rig.sessions[0]
    if (session === undefined) {
      throw new Error('no side session started')
    }
    const sent = session.sendTurn.mock.calls[0]?.[0] ?? []
    expect(sent).toHaveLength(1)
    expect(sent[0]?.type).toBe('text')
    if (sent[0]?.type !== 'text') {
      throw new Error('no text turn sent')
    }
    expect(sent[0].text).toContain('Use no tools.')
    expect(rig.sideIds).toEqual([session.sessionId])
    expect(session.setReasoningEffort).toHaveBeenCalledWith('none')
    expect(session.dispose).toHaveBeenCalled()
    expect(rig.removed).toEqual([options?.workspaceRoot])
    expect(rig.cache.get(key)?.outcome).toBe('caution')
    expect(rig.errors).toEqual([])
  })

  it('starts a fresh session per batch, never reusing one', async () => {
    const rig = fakeSetup()
    const key = startKey(rig.entries)
    rig.judge.judge({
      entryKey: key,
      stateText: 'x',
      questions: [NOUL, { id: 'pick', kind: 'choice', text: 'Pick.', options: ['Aye', 'Nay'] }],
    })
    // The choice batch cannot answer from the noul reply: both settle, each
    // in its own session.
    await untilJudgeSettled(rig.entries, key)
    expect(rig.host.startSession).toHaveBeenCalledTimes(2)
    const roots = rig.host.startSession.mock.calls.map((call) => call[0].workspaceRoot)
    expect(new Set(roots).size).toBe(2)
    expect(rig.removed).toHaveLength(2)
  })

  it('starts a fresh session per call, never holding one across calls', async () => {
    const rig = fakeSetup()
    const first = startKey(rig.entries)
    rig.judge.judge({ entryKey: first, stateText: 'x', questions: [NOUL] })
    expect(await untilJudgeSettled(rig.entries, first)).toBe('caution')
    const second = startJudgeEntry(rig.entries, {
      backend: 'muse-code',
      turnId: 't2',
      tool: 'run_shell',
      args: { command: 'ls' },
    })
    rig.judge.judge({ entryKey: second, stateText: 'y', questions: [NOUL] })
    expect(await untilJudgeSettled(rig.entries, second)).toBe('caution')
    expect(rig.host.startSession).toHaveBeenCalledTimes(2)
    expect(rig.removed).toHaveLength(2)
  })

  it('stays off on standing always-allow rules without starting anything', async () => {
    const rig = fakeSetup()
    rig.settingsText = JSON.stringify({
      schema_version: 1,
      permissions: {
        schema_version: 1,
        default_profile: 'open',
        profiles: { open: { filesystem: { mode: 'write' }, network: { mode: 'enabled' } } },
      },
    })
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('failed')
    expect(rig.host.startSession).not.toHaveBeenCalled()
    expect(rig.removed).toEqual([])
    expect(rig.infos).toHaveLength(1)
  })

  it('cancels on a tool item and deletes the folder', async () => {
    const rig = fakeSetup()
    rig.emitToolItem = true
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('failed')
    const session = rig.sessions[0]
    if (session === undefined) {
      throw new Error('no side session started')
    }
    expect(session.cancel).toHaveBeenCalled()
    expect(session.dispose).toHaveBeenCalled()
    expect(rig.removed).toHaveLength(1)
    expect(rig.cache.get(key)).toBeUndefined()
  })

  it('drops a result that arrives after its fence', async () => {
    const rig = fakeSetup()
    rig.autoReply = false
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    await vi.waitFor(() => {
      expect(rig.sessions).toHaveLength(1)
    })
    // The fence reads first and consumes the entry, before any reply lands.
    expect(rig.entries.readLatch(key)).toBeUndefined()
    rig.flush()
    // The batch runs to completion afterwards: disposed, folder gone.
    const session = rig.sessions[0]
    if (session === undefined) {
      throw new Error('no side session started')
    }
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalled()
    })
    expect(rig.entries.settled).toEqual([])
    expect(rig.cache.get(key)).toBeUndefined()
    expect(rig.removed).toHaveLength(1)
  })

  it('settles a repeated action from the cache without a session', async () => {
    const rig = fakeSetup()
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('caution')
    expect(rig.host.startSession).toHaveBeenCalledTimes(1)
    expect(rig.entries.readLatch(key)).toBe('caution')
    await judgeAgain(rig.judge, judgeJob(key, 'x', [NOUL]))
    expect(rig.host.startSession).toHaveBeenCalledTimes(1)
  })
})

describe('MuseCodeSameJudge over MSP frames', () => {
  it('carries only the standalone prompt and leaves the main session alone', async () => {
    const handle: FakeHostHandle = fakeMspHost()
    const log = new FakeLogOutputChannel()
    const host = new MuseCodeHost(handle.host, log)
    handle.server.handle('session/start', (params) =>
      sideSessionStarted(
        `started-${String(handle.server.requestsFor('session/start').length)}`,
        params['workspaceRoot'],
        params['modelId'],
      ),
    )
    const main = await host.startSession({
      workspaceRoot: '/ws',
      modelId: MODEL,
      approvalMode: 'onRequest',
    })
    const startsBefore = handle.server.requestsFor('session/start').length
    handle.server.handle('session/setReasoningEffort', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    handle.server.handle('turn/start', (params) => {
      const turnId = 'jt-1'
      const started = reviewTurnStarted(params['commandId'], turnId)
      setTimeout(() => {
        for (const frame of [
          ...reviewLeadFrames(String(params['sessionId']), turnId, ''),
          ...reviewReplyFrames(
            String(params['sessionId']),
            turnId,
            '{"answer":"no","confidence":99}',
          ),
        ]) {
          handle.server.notify(frame.method, frame.params)
        }
        handle.server.notify(
          'turn/completed',
          reviewTurnCompleted(String(params['sessionId']), turnId),
        )
      }, 10)
      return started
    })
    for (const method of ['turn/cancel', 'task/stopAll']) {
      handle.server.handle(method, (params) => ({
        commandId: params['commandId'],
        status: 'accepted',
      }))
    }
    const entries = new SpyJudgeStore()
    const cache = new JudgeResultCache()
    const errors: unknown[] = []
    const sideIds: string[] = []
    const roots = trackTempRoots(folders)
    const removed = roots.removed
    const judge = new MuseCodeSameJudge({
      startSession: (options) => host.startSession(options),
      readSettingsText: () => undefined,
      makeTempRoot: roots.makeTempRoot,
      removeTempRoot: roots.removeTempRoot,
      entries,
      cache,
      onSideSession: (sessionId) => {
        sideIds.push(sessionId)
      },
      describeFailure: failureForLog,
      logInfo: () => undefined,
      logWarn: () => undefined,
      modelId: MODEL,
      timeoutMs: 5000,
      measureTokens: (text) => text.length,
      onError: (error) => {
        errors.push(error)
      },
    })
    const key = startKey(entries)
    judge.judge({ entryKey: key, stateText: 'ls /tmp', questions: [NOUL] })
    await vi.waitFor(() => {
      expect(entries.settled.find((entry) => entry.key === key)?.outcome).toBe('none')
    })
    // One fresh judge session besides the main one, with Plan and no servers.
    const starts = handle.server.requestsFor('session/start')
    expect(starts).toHaveLength(startsBefore + 1)
    const params = starts.at(-1)?.params ?? {}
    expect(params['modelId']).toBe(MODEL)
    expect(params['approvalMode']).toBe('denyUnmatched')
    expect(params['config']).toBeUndefined()
    const workspaceRoot = params['workspaceRoot']
    expect(typeof workspaceRoot === 'string' && workspaceRoot !== '/ws').toBe(true)
    // Its turn carries only the standalone prompt, using no tools.
    const turns = handle.server.requestsFor('turn/start')
    expect(turns).toHaveLength(1)
    const seen: unknown = turns.at(0)?.params['input']
    const parts = Array.isArray(seen) ? seen : []
    const said = parts
      .filter(
        (part: unknown): part is { text: unknown } =>
          typeof part === 'object' && part !== null && 'text' in part,
      )
      .map((part) => part.text)
      .filter((text): text is string => typeof text === 'string')
    expect(said).toHaveLength(1)
    expect(said.join('\n')).toContain('Use no tools.')
    // The main session is untouched: no turn, no mode change, still listed.
    expect(
      handle.server
        .requestsFor('turn/start')
        .filter((request) => request.params['sessionId'] === main.sessionId),
    ).toEqual([])
    expect(sideIds).toHaveLength(1)
    expect(sideIds[0]).not.toBe(main.sessionId)
    expect(removed).toHaveLength(1)
    expect(errors).toEqual([])
    main.dispose()
    await host.close()
  })
})

// Lane M98-G: main-session MSP frame invariance (PLAN.md M98 acceptance item
// 1). A main turn runs through the real MuseCodeHost over the in-memory MSP
// transport (the fake CLI); while the judge works, no frame touching the
// main session may appear, change or reorder. No claim about the CLI's own
// HTTP bytes: only MSP frames are recorded here.
describe('M98-G main-session frames unchanged while the judge runs', () => {
  it('leaves every main-session frame byte-equal with a main turn on the wire', async () => {
    const handle: FakeHostHandle = fakeMspHost()
    const log = new FakeLogOutputChannel()
    const host = new MuseCodeHost(handle.host, log)
    handle.server.handle('session/start', (params) => {
      const started = handle.server.requestsFor('session/start').length
      return sideSessionStarted(
        `started-${String(started)}`,
        params['workspaceRoot'],
        params['modelId'],
      )
    })
    const main = await host.startSession({
      workspaceRoot: '/ws',
      modelId: MODEL,
      approvalMode: 'onRequest',
    })
    // Every fire-and-forget method answers `accepted` with its command id.
    for (const method of ['session/setReasoningEffort', 'turn/cancel', 'task/stopAll']) {
      handle.server.handle(method, (params) => ({
        commandId: params['commandId'],
        status: 'accepted',
      }))
    }
    // Both turns answer through the same captured shapes; the router keeps
    // them apart by session, as `muse serve` would.
    handle.server.handle('turn/start', (params) => {
      const sessionId = String(params['sessionId'])
      const isMain = sessionId === main.sessionId
      const turnId = isMain ? 'main-1' : 'jt-1'
      const started = reviewTurnStarted(params['commandId'], turnId)
      setTimeout(() => {
        for (const frame of [
          ...reviewLeadFrames(sessionId, turnId, ''),
          ...reviewReplyFrames(
            sessionId,
            turnId,
            isMain ? 'Main reply.' : '{"answer":"no","confidence":99}',
          ),
        ]) {
          handle.server.notify(frame.method, frame.params)
        }
        handle.server.notify('turn/completed', reviewTurnCompleted(sessionId, turnId))
      }, 10)
      return started
    })
    // One real main turn first, awaited through its own completion.
    const submission = await main.sendTurn([{ type: 'text', text: 'Count the lines.' }])
    expect(submission.disposition).toBe('started')
    await new Promise<void>((resolve) => {
      const stop = main.onEvent((event: AgentEvent) => {
        if (event.type !== 'turnCompleted' || event.turnId !== submission.turnId) {
          return
        }
        stop()
        resolve()
      })
    })
    const mainFrames = (): string =>
      JSON.stringify(
        handle.server.requests.filter(
          (request) => request.params?.['sessionId'] === main.sessionId,
        ),
      )
    const before = mainFrames()
    const framesBefore: unknown = JSON.parse(before)
    if (!Array.isArray(framesBefore)) {
      throw new TypeError('expected the main session frames')
    }
    expect(framesBefore.length).toBeGreaterThan(0)
    // Then the judge works on a held action in the background.
    const entries = new SpyJudgeStore()
    const cache = new JudgeResultCache()
    const errors: unknown[] = []
    const sideIds: string[] = []
    const roots = trackTempRoots(folders)
    const removed = roots.removed
    const judge = new MuseCodeSameJudge({
      modelId: MODEL,
      timeoutMs: 5000,
      measureTokens: (text) => text.length,
      entries,
      cache,
      onError: (error) => {
        errors.push(error)
      },
      startSession: (options) => host.startSession(options),
      readSettingsText: () => undefined,
      makeTempRoot: roots.makeTempRoot,
      removeTempRoot: roots.removeTempRoot,
      onSideSession: (sessionId) => {
        sideIds.push(sessionId)
      },
      describeFailure: failureForLog,
      logInfo: () => undefined,
      logWarn: () => undefined,
    })
    const key = startKey(entries)
    expect(await judgeOnce(judge, entries, judgeJob(key, 'ls /tmp', [NOUL]))).toBe('none')
    // The main session's frames are unchanged: nothing added, changed or
    // reordered by the judge run.
    expect(mainFrames()).toBe(before)
    // And the judge session carried only its standalone prompt.
    expect(sideIds).toHaveLength(1)
    expect(sideIds[0]).not.toBe(main.sessionId)
    const sideTurns = handle.server
      .requestsFor('turn/start')
      .filter((request) => request.params?.['sessionId'] === sideIds[0])
    expect(sideTurns).toHaveLength(1)
    const seen: unknown = sideTurns.at(0)?.params?.['input']
    if (!Array.isArray(seen)) {
      throw new TypeError('expected the judge turn input')
    }
    const said = seen
      .map((part: unknown) =>
        typeof part === 'object' && part !== null && 'text' in part ? part.text : undefined,
      )
      .filter((text): text is string => typeof text === 'string')
    expect(said).toHaveLength(1)
    expect(said.join('\n')).toContain('Use no tools.')
    expect(said.join('\n')).toContain('ls /tmp')
    const starts = handle.server.requestsFor('session/start')
    // A `session/start` names no session yet: the judge start is the one in
    // its own folder, never the main workspace root.
    const sideStart = starts.find((request) => request.params?.['workspaceRoot'] !== '/ws')
    expect(sideStart?.params?.['approvalMode']).toBe('denyUnmatched')
    expect(sideStart?.params?.['config']).toBeUndefined()
    expect(removed).toHaveLength(1)
    expect(errors).toEqual([])
    main.dispose()
    await host.close()
  })
})
