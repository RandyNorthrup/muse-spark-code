// RVM98P2R fix round: the SystemOne (C) side in the production window and
// the cascade, through the real paid host (`createPaidFeatures`, its popup
// and `PaidUseConsent`) and the built `dist/judgeP2.js`. A C verdict only
// ever adds caution; its consent is bound to the route and asks again after
// "Ask again"; a trigger change while admission or HTTP waits cancels before
// the POST and refunds; the window's C charge writes its paid usage row over
// the M95 providers' pinned transport; the cascade accepts the route's served
// dated model by the CLI's own rule. Fakes only: no live, paid or local call.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { ReviewBreaker } from '../../src/core/backends/modelapi/autoReviewer'
import { cascadeJudge, type JudgeCascadeSide } from '../../src/core/judge/cascade'
import type { ModelApiJudgeConnection } from '../../src/core/judge/same/modelApiSource'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import type { JudgeWindowDeps } from '../../src/host/judge/judgeBundle'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import { ReviewedApprovals, type ReviewHold } from '../../src/host/review/reviewedApprovals'
import type { MuseCodeReviewOutcome } from '../../src/host/review/museCodeReviewer'
import { JUDGE_EVIDENCE_DIRNAME, UI_TEXT, WORKSPACE_STATE_KEYS } from '../../src/shared/constants'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { EN } from '../../src/shared/l10n/en'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtJudgeFactories } from './helpers/judgeFactoryBundles'
import { memento } from './helpers/memento'
import {
  SYSTEMONE_ROUTE,
  recordingDailyLedger,
  storedOpenRouterKey,
  systemOneTransport,
} from './helpers/judgeSystemOneRig'
import { wiringFixture } from './helpers/judgeWiring'
import {
  capturedApproval,
  JUDGE_MODEL_API_BODY,
  type CapturedApproval,
} from './helpers/judgeApprovalFixtures'
import { confirmModal } from './helpers/vscodeViews'
import { REQUEST } from './judgeCliFixtures'

type Approval = CapturedApproval

const built = builtJudgeFactories()
const storage = mkdtempSync(path.join(tmpdir(), 'muse-p2r2-'))
afterAll(() => {
  rmSync(storage, { recursive: true, force: true })
})

function titleOf(item: unknown): string {
  return typeof item === 'string' ? item : (item as vscode.MessageItem).title
}

/** Every popup answers with this button (the real paid host's modal). */
function answerPopups(title: string): void {
  vi.mocked(confirmModal).mockImplementation((_message, _options, ...items: unknown[]) =>
    Promise.resolve(items.find((item) => titleOf(item) === title) as never),
  )
}

beforeEach(() => {
  vi.mocked(confirmModal).mockReset()
  answerPopups(UI_TEXT.allowOnce)
})

const approval = capturedApproval

const ACTION = {
  backend: 'museCode',
  sessionId: 's1',
  turnId: 't1',
  tool: 'bash',
  args: {},
} as const

/** The production window with the C route configured, over the real paid host. */
function systemOneWindow(
  options: {
    readonly noul?: number
    readonly ledgerHold?: Promise<unknown>
    readonly httpHold?: Promise<unknown>
    readonly rememberedJudge?: boolean
    readonly isMetaKeyStored?: boolean
  } = {},
) {
  const transport = systemOneTransport({
    noul: options.noul ?? 0.95,
    ...(options.httpHold !== undefined && { hold: options.httpHold }),
  })
  const ledger = recordingDailyLedger(options.ledgerHold)
  const emitted: AgentEvent[] = []
  const workspace = new Map<string, unknown>()
  if (options.rememberedJudge === true)
    workspace.set(WORKSPACE_STATE_KEYS.paidWorkspaceGrants, { judge: 0 })
  const paid = createPaidFeatures({
    globalState: memento(new Map()),
    workspaceState: memento(workspace),
    isSettingOn: (feature) => feature === 'judge',
    isDefaultOn: () => true,
    isJudgeOn: () => true,
    isKeyStored: () => options.isMetaKeyStored ?? false,
    canRememberPaidUse: () => true,
    log: new FakeLogOutputChannel(),
  })
  let owner = 'window'
  let model = 'muse-spark-1.3'
  let separateId = SYSTEMONE_ROUTE
  const deps: JudgeWindowDeps = {
    engine: () => 'separate',
    separateId: () => separateId,
    evidenceRoot: path.join(storage, JUDGE_EVIDENCE_DIRNAME),
    judgeP2BundlePath: path.join(built.folder, 'judgeP2.js'),
    readStoredCredential: storedOpenRouterKey(),
    separateTransport: { resolve: transport.resolve, send: transport.send },
    ledger,
    dailyBudgetUsd: () => 1,
    context: () => ({
      backend: 'museCode',
      modelId: model,
      ownerId: owner,
      contextLimit: 100_000,
      confidential: false,
    }),
    readSettingsText: () => undefined,
    startSession: vi.fn(),
    modelApi: () => undefined,
    paid,
    emit: (_action, event) => {
      emitted.push(event)
    },
    status: vi.fn(),
    notice: vi.fn(),
    log: new FakeLogOutputChannel(),
  }
  return {
    judge: createWindowJudge(deps, EN, 'en'),
    transport,
    ledger,
    emitted,
    paid,
    popups: () =>
      vi
        .mocked(confirmModal)
        .mock.calls.filter((call) => (call[1].detail ?? '').includes('openrouter.ai')),
    setOwner: (value: string) => {
      owner = value
    },
    setModel: (value: string) => {
      model = value
    },
    setSeparate: (value: string) => {
      separateId = value
    },
  }
}

/** The approval path that consumes the fence (M90's reviewed approvals). */
function reviewedApprovals(
  window: ReturnType<typeof systemOneWindow>,
  outcome: MuseCodeReviewOutcome,
) {
  const session = new FakeAgentSession('s1', 'muse-spark-1.3')
  const cards = vi.fn<(event: Approval, note: string | undefined) => void>()
  const approvals = new ReviewedApprovals(
    {
      judge: window.judge,
      showCard: cards,
      notice: vi.fn(),
      mayAllow: () => true,
      log: new FakeLogOutputChannel(),
      describeFailure: () => 'fixture failure',
    },
    new ReviewBreaker(),
    // The reviewer answers once the C verdict has settled: the fence never
    // waits for a judge, so a late verdict would have no say at all.
    async () => {
      await vi.waitFor(
        () => {
          expect(window.ledger.settled).toHaveLength(1)
        },
        { timeout: 4000 },
      )
      return outcome
    },
    () => false,
  )
  const hold: ReviewHold = {
    session,
    host: () => Promise.resolve(new FakeAgentHost()),
    modelId: session.modelId,
    request: {
      userRequest: 'fixture request',
      recentCalls: [],
      tool: 'shell',
      action: 'fixture action',
      workspaceRoot: '/fixture',
      platform: 'darwin',
    },
  }
  return { approvals, hold, cards, session }
}

async function cardShown(t: ReturnType<typeof reviewedApprovals>): Promise<void> {
  await vi.waitFor(
    () => {
      expect(t.cards).toHaveBeenCalled()
    },
    { timeout: 4000 },
  )
}

describe('a C (SystemOne) verdict only ever adds caution', () => {
  const allow: MuseCodeReviewOutcome = {
    decision: 'allow',
    reason: 'fixture allow',
    hasTripped: false,
  }
  const ask: MuseCodeReviewOutcome = {
    decision: 'ask',
    cause: 'declined',
    reason: 'fixture ask',
    hasTripped: false,
  }

  it('a risky C verdict turns the reviewer ALLOW into the caution card', async () => {
    const window = systemOneWindow({ noul: 0.95 })
    const t = reviewedApprovals(window, allow)
    const event = approval()
    t.approvals.hold(event, t.hold)
    await cardShown(t)
    expect(window.transport.sent).toHaveLength(1)
    expect(t.cards).toHaveBeenCalledWith({ ...event, judgeCaution: true }, undefined)
    expect(t.session.decideApproval).not.toHaveBeenCalled()
    window.judge.dispose()
  })

  it('a safe C verdict never relaxes the reviewer ASK and never allows alone', async () => {
    const window = systemOneWindow({ noul: 0.01 })
    const t = reviewedApprovals(window, ask)
    const event = approval()
    t.approvals.hold(event, t.hold)
    await cardShown(t)
    expect(window.transport.sent).toHaveLength(1)
    expect(t.cards.mock.calls[0]?.[0]).not.toHaveProperty('judgeCaution', true)
    expect(t.session.decideApproval).not.toHaveBeenCalled()
    window.judge.dispose()
  })
})

describe('P1: C consent is bound to its route, tariff and revocation generation', () => {
  it('an ordinary always judge grant never covers C, and Ask again asks again', async () => {
    const window = systemOneWindow({ rememberedJudge: true, isMetaKeyStored: true })
    expect(window.paid.consent.remembered()).toContain('judge')
    const first = window.judge.start(ACTION, 'state one')
    await vi.waitFor(() => {
      expect(window.ledger.settled).toHaveLength(1)
    })
    expect(first?.read()).toBe('caution')
    expect(window.popups()).toHaveLength(1)
    // A second action in the window reuses the route's own once.
    window.judge.start({ ...ACTION, turnId: 't2' }, 'state two')
    await vi.waitFor(() => {
      expect(window.ledger.settled).toHaveLength(2)
    })
    expect(window.popups()).toHaveLength(1)
    await window.paid.consent.forget()
    window.judge.start({ ...ACTION, turnId: 't3' }, 'state three')
    await vi.waitFor(() => {
      expect(window.popups()).toHaveLength(2)
    })
    window.judge.dispose()
  })

  it('a denied route popup sends and reserves nothing', async () => {
    answerPopups(UI_TEXT.paidDeny)
    const window = systemOneWindow()
    const fence = window.judge.start(ACTION, 'state')
    await vi.waitFor(() => {
      expect(window.popups()).toHaveLength(1)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(window.transport.sent).toHaveLength(0)
    expect(window.ledger.reserved).toHaveLength(0)
    expect(fence?.read()).not.toBe('caution')
    window.judge.dispose()
  })

  it('a fresh Jev user with no Meta key sees the route popup (its own tariff and lane)', async () => {
    const window = systemOneWindow({ isMetaKeyStored: false })
    window.judge.start(ACTION, 'state')
    await vi.waitFor(() => {
      expect(window.transport.sent).toHaveLength(1)
    })
    expect(window.popups()).toHaveLength(1)
    expect(window.popups()[0]?.[1]?.detail).toContain('$0.002688')
    window.judge.dispose()
  })
})

describe('P1/P2: a trigger change while C waits cancels before the POST and refunds', () => {
  it.each([
    [
      'owner',
      (window: ReturnType<typeof systemOneWindow>) => {
        window.setOwner('owner-2')
      },
    ],
    [
      'chat model',
      (window: ReturnType<typeof systemOneWindow>) => {
        window.setModel('muse-spark-1.2')
      },
    ],
    [
      'separate source',
      (window: ReturnType<typeof systemOneWindow>) => {
        window.setSeparate('local:tev1:4b')
      },
    ],
  ])('a %s change during admission sends nothing and refunds the claim', async (_name, change) => {
    const admission = Promise.withResolvers<undefined>()
    const window = systemOneWindow({ ledgerHold: admission.promise })
    const fence = window.judge.start(ACTION, 'state')
    await vi.waitFor(() => {
      expect(window.ledger.reserved).toHaveLength(1)
    })
    change(window)
    admission.resolve(undefined)
    await vi.waitFor(() => {
      expect(window.ledger.settled).toEqual([0])
    })
    expect(window.transport.sent).toHaveLength(0)
    expect(fence?.read()).not.toBe('caution')
    window.judge.dispose()
  })

  it('a separate source change during HTTP rejects the old route result', async () => {
    const http = Promise.withResolvers<undefined>()
    const window = systemOneWindow({ httpHold: http.promise })
    const fence = window.judge.start(ACTION, 'state')
    await vi.waitFor(() => {
      expect(window.transport.sent).toHaveLength(1)
    })
    window.setSeparate('local:tev1:4b')
    http.resolve(undefined)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fence?.read()).not.toBe('caution')
    window.judge.dispose()
  })
})

describe('P2: the window C charge, first use, usage row and pinned M95 transport', () => {
  it('a valid stored key serves the very first action: no gap, one pinned send', async () => {
    const window = systemOneWindow()
    // Started at once after construction, before any key read completes.
    const fence = window.judge.start(ACTION, 'state')
    await vi.waitFor(() => {
      expect(window.ledger.settled).toHaveLength(1)
    })
    expect(fence?.read()).toBe('caution')
    expect(window.transport.sent[0]?.target).toMatchObject({
      host: 'openrouter.ai',
      address: '104.18.2.115',
    })
    window.judge.dispose()
  })

  it('writes its paid judge row at the route rates', async () => {
    const window = systemOneWindow()
    window.judge.start(ACTION, 'state')
    await vi.waitFor(() => {
      expect(window.ledger.settled).toHaveLength(1)
    })
    expect(window.ledger.reserved).toEqual([0.002688])
    const settled = window.ledger.settled[0] ?? 0
    expect(window.paid.usage.current.judgeCalls).toBe(1)
    expect(window.paid.usage.current.judgeCostUsd).toBeCloseTo(settled, 12)
    expect(window.paid.usage.current.judgeTokens).toBe(491)
    const rows = window.emitted.filter((event) => 'item' in event && event.item.tool === 'judge')
    expect(rows.map((event) => event.type)).toEqual(['itemStarted', 'itemCompleted'])
    expect(rows[0]).toMatchObject({
      item: { paid: 'judge', visibleOutput: 'Separate judge: typesafe/jev-1.13' },
    })
    window.judge.dispose()
  })
})

describe('P2: Model API Allow once reaches the plan, so phase 1 still judges', () => {
  const BODY = JUDGE_MODEL_API_BODY

  it.each(['', 'fixture-source'])(
    'separate id %j: one popup, one admitted phase-1 send and its caution',
    async (separateId) => {
      const send = vi.fn<ModelApiJudgeConnection['transport']['send']>(
        async (_body, _signal, guard) => {
          await Promise.resolve()
          guard?.('account')
          guard?.onRequestStarted?.()
          return {
            text: '{"answer":"yes","confidence":99}',
            usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, reasoningTokens: 0 },
          }
        },
      )
      const connection: ModelApiJudgeConnection = {
        keyDigest: 'account',
        source: {
          readMainBody: () => BODY,
          keyPrefix: () => 'judge',
          prefixTokens: () => undefined,
        },
        transport: { send },
      }
      const ledger = recordingDailyLedger()
      const paid = createPaidFeatures({
        globalState: memento(new Map()),
        workspaceState: memento(new Map()),
        isSettingOn: (feature) => feature === 'judge',
        isDefaultOn: () => true,
        isJudgeOn: () => true,
        isKeyStored: () => true,
        canRememberPaidUse: () => false,
        dailyBudgetUsd: () => 5,
        log: new FakeLogOutputChannel(),
      })
      const judge = createWindowJudge(
        {
          engine: () => 'auto',
          separateId: () => separateId,
          evidenceRoot: path.join(storage, JUDGE_EVIDENCE_DIRNAME),
          judgeP2BundlePath: path.join(built.folder, 'judgeP2.js'),
          context: () => ({
            backend: 'modelApi',
            modelId: 'muse-spark-1.3',
            ownerId: 'window',
            contextLimit: 100_000,
            confidential: false,
          }),
          readSettingsText: () => undefined,
          startSession: vi.fn(),
          modelApi: () => connection,
          ledger,
          paid,
          emit: vi.fn(),
          status: vi.fn(),
          notice: vi.fn(),
          log: new FakeLogOutputChannel(),
        },
        EN,
        'en',
      )
      const fence = judge.start({ ...ACTION, backend: 'modelApi' }, 'state')
      await vi.waitFor(
        () => {
          expect(send).toHaveBeenCalledTimes(1)
        },
        { timeout: 4000 },
      )
      await vi.waitFor(() => {
        expect(fence?.read()).toBe('caution')
      })
      expect(vi.mocked(confirmModal)).toHaveBeenCalledTimes(1)
      expect(ledger.reserved).toHaveLength(1)
      judge.dispose()
    },
  )
})

/** The fixture separate side answering under another model id. */
function aliased(reported: string, served: readonly string[] | undefined): JudgeCascadeSide {
  const side = wiringFixture().separate
  return {
    ...side,
    ...(served !== undefined && { servedModels: served }),
    run: async (request, signal) => {
      const receipt = await side.run(request, signal)
      if (receipt.outcome.outcome !== 'answered') return receipt
      const result = receipt.outcome.result
      return {
        ...receipt,
        outcome: {
          outcome: 'answered',
          result: {
            ...result,
            model: reported,
            muse: Object.fromEntries(
              Object.entries(result.muse).map(([id, meta]) => [id, { ...meta, model: reported }]),
            ),
          },
        },
      }
    },
  }
}

describe('the cascade accepts a served dated model exactly where the alias maps to it', () => {
  it('combines a both run whose separate side reports its captured dated name', async () => {
    const fixture = wiringFixture()
    const outcome = await cascadeJudge(
      { ...REQUEST },
      fixture.options,
      {
        same: fixture.same,
        separate: aliased('separate-model-20260917', ['separate-model-20260917']),
      },
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: {
        model: 'separate-model-20260917',
        muse: { risk: { source: 'both', technique: 'cascade' } },
      },
    })
  })

  it('still refuses a dated name the capture does not list', async () => {
    const fixture = wiringFixture()
    const outcome = await cascadeJudge(
      { ...REQUEST },
      fixture.options,
      {
        same: fixture.same,
        separate: aliased('separate-model-foreign', ['separate-model-20260917']),
      },
      new AbortController().signal,
    )
    expect(outcome).not.toMatchObject({ result: { muse: { risk: { source: 'both' } } } })
  })
})
