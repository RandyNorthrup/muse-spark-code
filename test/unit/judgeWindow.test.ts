import { Usd } from '../../src/shared/usd'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { removeFolder } from './helpers/temporaryFolders'
import { describe, expect, it, vi } from 'vitest'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import { judgeWindowPort, type JudgeWindowDeps } from '../../src/host/judge/judgeBundle'
import { JudgeReplayRecorder } from '../../src/core/eval/judgeReplay'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import { UI_TEXT, type JudgeEngine } from '../../src/shared/constants'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memento } from './helpers/memento'
import { JUDGE_ACTION } from './helpers/judgeUseRig'

function setup(backend: 'museCode' | 'modelApi' = 'museCode') {
  let engine: JudgeEngine = 'auto'
  let modelId = 'muse-spark-1.3'
  let settings: string | undefined
  const sessions: FakeAgentSession[] = []
  const paid = createPaidFeatures({
    globalState: memento(new Map()),
    workspaceState: memento(new Map()),
    isSettingOn: () => false,
    isJudgeOn: () => engine !== 'off',
    isKeyStored: () => false,
    canRememberPaidUse: () => false,
    log: new FakeLogOutputChannel(),
  })
  const consent = vi.spyOn(paid, 'allowsJudgeUse')
  const emitted: AgentEvent[] = []
  const deps: JudgeWindowDeps = {
    engine: () => engine,
    context: () => ({
      backend,
      modelId,
      ownerId: 'window',
      contextLimit: 100_000,
      confidential: false,
    }),
    readSettingsText: () => settings,
    startSession: vi.fn<JudgeWindowDeps['startSession']>((options) => {
      const session = new FakeAgentSession(`side-${String(sessions.length)}`, options.modelId)
      sessions.push(session)
      return Promise.resolve(session)
    }),
    modelApi: vi.fn(() => undefined),
    paid,
    emit: (_action, event) => {
      emitted.push(event)
    },
    status: vi.fn(),
    notice: vi.fn(),
    log: new FakeLogOutputChannel(),
  }
  const action = { ...JUDGE_ACTION, backend }
  return {
    deps,
    action,
    sessions,
    emitted,
    consent,
    setEngine: (value: JudgeEngine) => {
      engine = value
    },
    setModel: (value: string) => {
      modelId = value
    },
    setSettings: (value: string | undefined) => {
      settings = value
    },
    finish: (session: FakeAgentSession, answer = 'yes', confidence = 99) => {
      session.emit(
        {
          type: 'itemCompleted',
          item: {
            itemId: 'reply',
            turnId: 'turn-1',
            kind: 'agentMessage',
            status: 'completed',
            text: JSON.stringify({ answer, confidence }),
          },
        },
        { type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' },
      )
    },
  }
}

async function dispatched(rig: ReturnType<typeof setup>, index = 0): Promise<FakeAgentSession> {
  await vi.waitFor(() => {
    expect(rig.sessions[index]?.sendTurn).toHaveBeenCalledTimes(1)
  })
  const session = rig.sessions[index]
  if (session === undefined) throw new Error('side session absent')
  return session
}

describe('M98 production window wiring', () => {
  it('keeps the bundle unloaded while off, including disposal, and loads once on a decision', async () => {
    const rig = setup()
    const load = vi.fn(() => ({ createWindowJudge }))
    const judge = judgeWindowPort({ ...rig.deps, bundlePath: '/test/judge.js', loadBundle: load })
    rig.setEngine('off')
    expect(judge.start(rig.action, 'state')).toBeUndefined()
    judge.discardSession('s1')
    judge.dispose()
    expect(load).not.toHaveBeenCalled()
    rig.setEngine('auto')
    const fence = judge.start(rig.action, 'state')
    const session = await dispatched(rig)
    expect(load).toHaveBeenCalledTimes(1)
    expect(judge.isSideSession(session.sessionId)).toBe(true)
    rig.finish(session)
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalled()
    })
    expect(fence?.read()).toBe('caution')
    judge.dispose()
  })

  it('leaves approvals unchanged when a bundle is missing or has no factory', () => {
    for (const load of [
      () => undefined,
      () => {
        throw new Error('/home/example/profile/private-state')
      },
    ]) {
      const rig = setup()
      const judge = judgeWindowPort({
        ...rig.deps,
        bundlePath: '/home/example/profile/missing.js',
        loadBundle: load,
      })
      expect(judge.start(rig.action, 'state')).toBeUndefined()
      expect(rig.deps.log.warn).toHaveBeenCalledWith('Judge bundle unavailable; approval unchanged')
      expect(rig.deps.log.error).not.toHaveBeenCalled()
    }
  })

  it('dispatches subscription-only judging without a price prompt, redacts, accounts separately and removes its folder', async () => {
    const rig = setup()
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-judge-subscription-'))
    const daily = createPaidDailyBudget({
      directory,
      now: Date.now,
      capUsd: () => Usd.from(5).toAmount(),
      sleep: () => Promise.resolve(),
      isModelApi: () => false,
    })
    const reserve = vi.spyOn(daily.judgeLedger, 'reserve')
    const judge = createWindowJudge({ ...rig.deps, ledger: daily.judgeLedger }, UI_TEXT, 'en')
    const fence = judge.start(rig.action, 'LLM_SYNTHETIC_WINDOW_KEY_1234567890')
    const session = await dispatched(rig)
    const options = vi.mocked(rig.deps.startSession).mock.calls[0]?.[0]
    expect(options?.approvalMode).toBe('denyUnmatched')
    expect(options?.modelId).toBe('muse-spark-1.3')
    expect(options).not.toHaveProperty('mcpServers')
    expect(JSON.stringify(session.sendTurn.mock.calls)).not.toContain('LLM_SYNTHETIC_WINDOW_KEY')
    expect(rig.consent).not.toHaveBeenCalled()
    expect(rig.deps.notice).toHaveBeenCalledTimes(1)
    session.emit({ type: 'tokenUsage', inputTokens: 10, outputTokens: 2 })
    rig.finish(session)
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalled()
    })
    await vi.waitFor(() => {
      expect(options === undefined || existsSync(options.workspaceRoot)).toBe(false)
    })
    expect(fence?.read()).toBe('caution')
    expect(rig.emitted.map((event) => event.type)).toEqual(['itemStarted', 'itemCompleted'])
    expect(rig.emitted[1]).not.toHaveProperty('item.usage')
    expect(rig.emitted[0]).not.toHaveProperty('item.paid')
    expect(rig.deps.paid.usage.current.judgeCalls).toBeUndefined()
    expect(reserve).not.toHaveBeenCalled()
    judge.dispose()
    await removeFolder(directory)
  })

  it('retains the real cache across fresh bindings and clears it on a model change', async () => {
    const rig = setup()
    const judge = createWindowJudge(rig.deps, UI_TEXT, 'en')
    const first = judge.start(rig.action, 'state')
    const session = await dispatched(rig)
    rig.finish(session)
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalled()
    })
    expect(first?.read()).toBe('caution')
    const repeated = judge.start(rig.action, 'state')
    const note = vi.fn()
    repeated?.card(note)
    await vi.waitFor(() => {
      expect(note).toHaveBeenCalled()
    })
    expect(repeated?.read()).toBe('caution')
    expect(rig.sessions).toHaveLength(1)
    rig.setModel('muse-spark-1.3-contributor')
    const changed = judge.start(rig.action, 'state')
    const next = await dispatched(rig, 1)
    expect(next.modelId).toBe('muse-spark-1.3-contributor')
    changed?.discard()
    await vi.waitFor(() => {
      expect(next.dispose).toHaveBeenCalled()
    })
    rig.setModel('muse-spark-1.3')
    const restored = judge.start(rig.action, 'state')
    const last = await dispatched(rig, 2)
    restored?.discard()
    await vi.waitFor(() => {
      expect(last.dispose).toHaveBeenCalled()
    })
    judge.dispose()
  })

  it('drops a ready latch on a changed model and cancels a pending subscription turn at the fence', async () => {
    const rig = setup()
    const judge = createWindowJudge(rig.deps, UI_TEXT, 'en')
    const pending = judge.start(rig.action, 'state')
    const first = await dispatched(rig)
    expect(pending?.read()).toBeUndefined()
    await vi.waitFor(() => {
      expect(first.cancel).toHaveBeenCalled()
    })
    const ready = judge.start({ ...rig.action, tool: 'write_file' }, 'state')
    const second = await dispatched(rig, 1)
    rig.finish(second)
    await vi.waitFor(() => {
      expect(second.dispose).toHaveBeenCalled()
    })
    rig.setModel('muse-spark-1.3-contributor')
    expect(ready?.read()).toBeUndefined()
    judge.dispose()
  })

  it('rechecks standing settings and the lifecycle after a held hidden-session wait', async () => {
    const rig = setup()
    const held = Promise.withResolvers<undefined>()
    vi.mocked(rig.deps.startSession).mockImplementationOnce(async (options) => {
      await held.promise
      const session = new FakeAgentSession('held-side', options.modelId)
      rig.sessions.push(session)
      return session
    })
    const judge = createWindowJudge(rig.deps, UI_TEXT, 'en')
    judge.start(rig.action, 'state')
    await vi.waitFor(() => {
      expect(rig.deps.startSession).toHaveBeenCalled()
    })
    rig.setSettings(
      '{"schema_version":1,"permissions":{"schema_version":1,"default_profile":"missing"}}',
    )
    held.resolve(undefined)
    await vi.waitFor(() => {
      expect(rig.sessions[0]?.dispose).toHaveBeenCalled()
    })
    expect(rig.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    judge.dispose()
  })

  it('refuses metered judging before consent when the real daily ledger is absent', () => {
    const rig = setup('modelApi')
    const judge = createWindowJudge(rig.deps, UI_TEXT, 'en')
    expect(judge.start(rig.action, 'state')).toBeUndefined()
    expect(rig.deps.status).toHaveBeenCalledWith(
      rig.action,
      expect.objectContaining({
        mode: 'off',
        reason: 'source-unavailable',
        billing: 'modelApi',
      }),
    )
    expect(rig.consent).not.toHaveBeenCalled()
    expect(rig.deps.modelApi).not.toHaveBeenCalled()
    expect(rig.deps.startSession).not.toHaveBeenCalled()
    expect(rig.emitted).toEqual([])
    judge.dispose()
  })

  it.each(['itemStarted', 'itemUpdated'] as const)(
    'cancels at the first %s tool notification',
    async (type) => {
      const rig = setup()
      const judge = createWindowJudge(rig.deps, UI_TEXT, 'en')
      const fence = judge.start(rig.action, 'state')
      const session = await dispatched(rig)
      session.emit({
        type,
        item: {
          itemId: 'tool',
          turnId: 'turn-1',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'shell',
        },
      })
      expect(session.cancel).toHaveBeenCalled()
      rig.finish(session)
      await vi.waitFor(() => {
        expect(session.dispose).toHaveBeenCalled()
      })
      expect(fence?.read()).toBeUndefined()
      judge.dispose()
    },
  )

  it('refuses over-context state before creating a hidden session', async () => {
    const rig = setup()
    const current = rig.deps.context(rig.action)
    const judge = createWindowJudge(
      {
        ...rig.deps,
        context: () => (current === undefined ? undefined : { ...current, contextLimit: 1 }),
      },
      UI_TEXT,
      'en',
    )
    const fence = judge.start(rig.action, 'state')
    await vi.waitFor(() => {
      expect(rig.deps.log.warn).toHaveBeenCalled()
    })
    expect(rig.deps.startSession).not.toHaveBeenCalled()
    expect(fence?.read()).toBeUndefined()
    judge.dispose()
  })

  it('feeds only independently labelled replay fences and honours measured defaults', async () => {
    const rig = setup()
    const recorder = new JudgeReplayRecorder()
    const judge = createWindowJudge(
      {
        ...rig.deps,
        onFence: (sample) => {
          recorder.record(sample, true)
        },
      },
      UI_TEXT,
      'en',
    )
    const fence = judge.start(rig.action, 'independently labelled destructive replay')
    const session = await dispatched(rig)
    rig.finish(session)
    await vi.waitFor(() => {
      expect(session.dispose).toHaveBeenCalled()
    })
    fence?.read()
    expect(recorder.measurements()).toEqual([
      { backend: 'museCode', fences: 1, readyRate: 1, precision: 1, cautions: 1 },
    ])
    judge.dispose()
    const slow = createWindowJudge({ ...rig.deps, readyRate: () => 0 }, UI_TEXT, 'en')
    expect(slow.start(rig.action, 'state')).toBeUndefined()
    expect(rig.deps.status).toHaveBeenLastCalledWith(
      rig.action,
      expect.objectContaining({ reason: 'ready-rate-low' }),
    )
    slow.dispose()
  })
})
