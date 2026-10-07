import { quotedSearch } from './helpers/paidQuote'
import { Usd } from '../../src/shared/usd'
import { memento } from './helpers/memento'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import type { PaidUseAnswer } from '../../src/core/paid/paidConsent'
import { askPaidUse, createPaidFeatures } from '../../src/host/paid/paidHost'
import {
  GLOBAL_STATE_KEYS,
  SUBAGENT_PRICE_ACCEPTANCE_VERSION,
  type PaidFeature,
  UI_TEXT,
  WORKSPACE_STATE_KEYS,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { mockJudgePaidConfiguration } from './helpers/judgePaidConfiguration'
import { confirmModal } from './helpers/vscodeViews'
import { window } from './mocks/vscode'
import { usageRecordSchema } from '../../src/shared/usageJournal'

const TASK = {
  role: 'reviewer',
  objective: 'Review local changes',
  modelId: 'muse-spark-1.3',
  attemptLimit: 4,
}

beforeEach(() => {
  window.state.focused = true
  vi.mocked(confirmModal).mockReset()
})

function paidWithSettings(
  data: Map<string, unknown>,
  enabled: readonly PaidFeature[],
  options: {
    workspace?: Map<string, unknown>
    canRemember?: () => boolean
    defaultOn?: boolean
  } = {},
) {
  const settings = new Set(enabled)
  const paid = createPaidFeatures({
    globalState: memento(data),
    workspaceState: memento(options.workspace ?? new Map<string, unknown>()),
    isSettingOn: (feature) => settings.has(feature),
    isDefaultOn: () => options.defaultOn === true,
    isKeyStored: () => true,
    canRememberPaidUse: options.canRemember ?? (() => true),
    log: new FakeLogOutputChannel(),
  })
  return { paid, settings }
}

/** A modal item's label: a plain string, or a `MessageItem`'s title. */
function titleOf(item: unknown): string {
  return typeof item === 'string' ? item : (item as vscode.MessageItem).title
}

/** The popup's buttons, as the last `showWarningMessage` call offered them. */
function offeredButtons(): string[] {
  const call: unknown[] = vi.mocked(confirmModal).mock.calls.at(-1) ?? []
  return call.slice(2).map((item) => titleOf(item))
}

/** Answers the next modal with the button titled `title`, or closes it. */
function answerWith(title: string | undefined): void {
  vi.mocked(confirmModal).mockImplementationOnce((_message, _options, ...items: unknown[]) =>
    Promise.resolve(items.find((item) => titleOf(item) === title) as never),
  )
}

/** What the popup says for one use: its question and its detail. */
async function details(request: Parameters<typeof askPaidUse>[0]) {
  answerWith(undefined)
  await askPaidUse(request, true, Usd.from(5).toAmount())
  const call = vi.mocked(confirmModal).mock.calls.at(-1)
  return { title: call?.[0], detail: call?.[1]?.detail ?? '' }
}

describe('the paid-use popup (M58)', () => {
  it('restores prior journal units once while keeping additions during the read', async () => {
    const opened = vi.spyOn(Date, 'now').mockReturnValue(100)
    try {
      const record = usageRecordSchema.parse({
        v: 1,
        type: 'usage',
        id: 'old',
        at: 99,
        day: '2026-10-05',
        timezoneOffsetMins: 0,
        client: 'Zed',
        backend: 'modelApi',
        provider: 'meta',
        model: 'muse-image-1.0',
        startedAt: 99,
        kind: 'image',
        tokens: {},
        units: { images: 2 },
        cost: { certainty: 'computed', usd: 0.01 },
        outcome: 'completed',
      })
      const read = Promise.withResolvers<readonly (typeof record)[]>()
      const paid = createPaidFeatures({
        globalState: memento(new Map()),
        workspaceState: memento(new Map()),
        isSettingOn: () => false,
        isKeyStored: () => true,
        canRememberPaidUse: () => true,
        log: new FakeLogOutputChannel(),
        usageRecording: {
          note: vi.fn(),
          limit: vi.fn(),
          today: () => read.promise,
          flush: () => Promise.resolve(),
        },
      })
      paid.usage.add('imageGeneration', 1)
      read.resolve([record, { ...record, id: 'live', at: 100, units: { images: 1 } }])
      await vi.waitFor(() => {
        expect(paid.usage.current.images).toBe(3)
      })
    } finally {
      opened.mockRestore()
    }
  })
  it('offers Allow once, Allow always in this workspace and Deny, Deny closing it', async () => {
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(
      askPaidUse({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }, true),
    ).resolves.toBe('always')
    expect(offeredButtons()).toEqual([UI_TEXT.allowOnce, UI_TEXT.paidAllowAlways, UI_TEXT.paidDeny])
    const deny = vi.mocked(confirmModal).mock.calls[0]?.slice(2).at(-1) as vscode.MessageItem
    expect(deny.isCloseAffordance).toBe(true)
    expect(vi.mocked(confirmModal).mock.calls[0]?.[1]).toMatchObject({ modal: true })
    answerWith(UI_TEXT.allowOnce)
    await expect(
      askPaidUse({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }, true),
    ).resolves.toBe('once')
    answerWith(UI_TEXT.paidDeny)
    await expect(
      askPaidUse({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }, true),
    ).resolves.toBe('deny')
    answerWith(undefined)
    await expect(
      askPaidUse({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }, true),
    ).resolves.toBe('deny')
  })

  it('refuses an Auto review on a model without verified rates before any popup (M78)', async () => {
    await expect(
      askPaidUse(
        { feature: 'autoReviewer', modelId: 'muse-spark-future', tool: 'bash', action: 'ls' },
        true,
      ),
    ).resolves.toBe('deny')
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('names the reviewed action, the model and its token rates (M78)', async () => {
    const review = await details({
      feature: 'autoReviewer',
      modelId: 'muse-spark-1.3-contributor',
      tool: 'bash',
      action: 'npm test',
    })
    expect(review.title).toBe(fill(UI_TEXT.paidUseAutoReviewerTitle, { tool: 'bash' }))
    expect(review.detail).toContain('npm test')
    expect(review.detail).toContain('muse-spark-1.3-contributor')
    expect(review.detail).toContain('$0.100/1M input')
  })

  it('refuses a child task on a model without verified rates before any popup', async () => {
    await expect(
      askPaidUse({ feature: 'subagents', task: { ...TASK, modelId: 'muse-spark-future' } }, true),
    ).resolves.toBe('deny')
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('leaves "always" out where it cannot be kept', async () => {
    answerWith(UI_TEXT.allowOnce)
    await expect(askPaidUse({ feature: 'voice' }, false)).resolves.toBe('once')
    expect(offeredButtons()).toEqual([UI_TEXT.allowOnce, UI_TEXT.paidDeny])
  })

  it('refuses a best-of-N run on a model without verified rates before any popup', async () => {
    await expect(
      askPaidUse(
        {
          feature: 'bestOfN',
          modelId: 'muse-spark-future',
          prompt: 'Refactor this',
          attempts: 3,
          requestCeilingPerAttempt: 20,
        },
        true,
      ),
    ).resolves.toBe('deny')
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('names a best-of-N run with its prompt, rates, N and ceiling', async () => {
    const run = await details({
      feature: 'bestOfN',
      modelId: 'muse-spark-1.3',
      prompt: 'Refactor this',
      attempts: 3,
      requestCeilingPerAttempt: 20,
    })
    expect(run.title).toContain('3')
    expect(run.detail).toContain('Refactor this')
    expect(run.detail).toContain('muse-spark-1.3')
    expect(run.detail).toContain('$1.250')
    expect(run.detail).toContain('3 attempts')
    expect(run.detail).toContain('20 requests')
  })

  it('names what each use is and what it costs', async () => {
    const search = await details({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() })
    expect(search.title).toBe(UI_TEXT.paidUseWebSearchTitle)
    expect(search.detail).toContain('$2.50 per 1,000 searches')
    expect(search.detail).toContain('$5.00')
    expect(search.detail).toContain('Tab')
    const voice = await details({ feature: 'voice' })
    expect(voice.title).toBe(UI_TEXT.paidUseVoiceTitle)
    expect(voice.detail).toContain('$0.18 per hour of audio')
    const image = await details({
      feature: 'imageGeneration',
      kind: 'edit',
      path: 'art/new.png',
      sources: ['art/a.png', 'art/b.png'],
      prompt: 'Blend them',
    })
    expect(image.title).toContain('art/new.png')
    expect(image.detail).toContain('Blend them')
    expect(image.detail).toContain('art/a.png, art/b.png')
    expect(image.detail).toContain('$0.01 per image')
    const task = await details({ feature: 'subagents', task: TASK })
    expect(task.title).toContain('reviewer')
    expect(task.detail).toContain('Review local changes')
    expect(task.detail).toContain('muse-spark-1.3')
    expect(task.detail).toContain('$1.250')
    expect(task.detail).toContain('$0.150')
    expect(task.detail).toContain('$4.250')
    expect(task.detail).toContain('4 requests per task, including retries')
  })
})

describe('Allow always in this workspace (M58)', () => {
  it('persists a quote ceiling and asks again for a higher tariff after reopening the window', async () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]])
    const workspace = new Map<string, unknown>()
    const first = paidWithSettings(data, ['webSearch'], { workspace }).paid
    answerWith(UI_TEXT.paidAllowAlways)
    await first.consent.allows({ feature: 'webSearch', priceUsd: Usd.from('0.0025').toAmount() })
    const reopened = paidWithSettings(data, ['webSearch'], { workspace }).paid
    expect(
      await reopened.consent.allows({
        feature: 'webSearch',
        priceUsd: Usd.from('0.001').toAmount(),
      }),
    ).toMatchObject({ tariffUsd: Usd.from('0.001').toAmount() })
    expect(confirmModal).toHaveBeenCalledOnce()
    answerWith(UI_TEXT.paidDeny)
    expect(
      await reopened.consent.allows({
        feature: 'webSearch',
        priceUsd: Usd.from('0.01').toAmount(),
      }),
    ).toBeUndefined()
    expect(confirmModal).toHaveBeenCalledTimes(2)
  })

  it('preserves default-on price acceptance and Always through backend unavailability and startup', async () => {
    const data = new Map<string, unknown>()
    const workspace = new Map<string, unknown>()
    let backend: 'modelApi' | 'museCode' | undefined
    const paid = createPaidFeatures({
      globalState: memento(data),
      workspaceState: memento(workspace),
      isSettingOn: (feature) => feature === 'imageGeneration',
      isDefaultOn: () => true,
      isAvailable: () => backend === 'modelApi',
      isKeyStored: () => true,
      canRememberPaidUse: () => true,
      log: new FakeLogOutputChannel(),
    })
    await paid.gate.review()
    expect(confirmModal).not.toHaveBeenCalled()
    expect(paid.gate.isOn('imageGeneration')).toBe(false)
    backend = 'modelApi'
    const image = {
      feature: 'imageGeneration',
      kind: 'generate',
      path: 'art.png',
      sources: [],
      prompt: 'A tree',
    } as const
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(paid.consent.allows(image)).resolves.toBe(true)
    const acceptance = structuredClone(data)
    backend = 'museCode'
    await paid.gate.review()
    expect(paid.gate.isOn('imageGeneration')).toBe(false)
    expect(data).toEqual(acceptance)
    backend = 'modelApi'
    await paid.gate.review()
    expect(paid.consent.isRemembered('imageGeneration')).toBe(true)
    await expect(paid.consent.allows(image)).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledOnce()
  })

  it('withdraws a default-on feature grant after OFF, even if the default is restored later', async () => {
    const { paid, settings } = paidWithSettings(new Map(), ['imageGeneration'], { defaultOn: true })
    const image = {
      feature: 'imageGeneration',
      kind: 'generate',
      path: 'art.png',
      sources: [],
      prompt: 'A tree',
    } as const
    answerWith(UI_TEXT.paidAllowAlways)
    await paid.consent.allows(image)
    expect(paid.consent.isRemembered('imageGeneration')).toBe(true)
    settings.delete('imageGeneration')
    await paid.gate.review()
    settings.add('imageGeneration')
    expect(paid.consent.isRemembered('imageGeneration')).toBe(false)
  })
  it('default availability cannot revive a subagent grant under an old tariff', async () => {
    const data = new Map<string, unknown>([
      [GLOBAL_STATE_KEYS.subagentPriceAcceptance, 'old-price'],
    ])
    const workspace = new Map<string, unknown>([
      [WORKSPACE_STATE_KEYS.paidWorkspaceGrants, { subagents: 0 }],
    ])
    const { paid } = paidWithSettings(data, ['subagents'], { workspace, defaultOn: true })
    expect(paid.gate.isOn('subagents')).toBe(true)
    expect(paid.consent.isRemembered('subagents')).toBe(false)
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(paid.consent.allows({ feature: 'subagents', task: TASK })).resolves.toBe(true)
    expect(data.get(GLOBAL_STATE_KEYS.subagentPriceAcceptance)).toBe(
      SUBAGENT_PRICE_ACCEPTANCE_VERSION,
    )
    expect(paid.consent.isRemembered('subagents')).toBe(true)
  })
  it('asks once, then remembers the feature in this workspace only', async () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]])
    const workspace = new Map<string, unknown>()
    const { paid } = paidWithSettings(data, ['webSearch'], { workspace })
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(
      paid.consent.allows({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }),
    ).resolves.toMatchObject({ feature: 'webSearch', tariffUsd: Usd.from('0.0025').toAmount() })
    await expect(
      paid.consent.allows({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }),
    ).resolves.toMatchObject({ feature: 'webSearch', tariffUsd: Usd.from('0.0025').toAmount() })
    expect(confirmModal).toHaveBeenCalledTimes(1)
    expect(
      Array.from(workspace, ([key]) => key).filter((key) =>
        key.startsWith(`${WORKSPACE_STATE_KEYS.paidQuoteGrants}:`),
      ),
    ).toHaveLength(1)
    expect(paid.state().alwaysAllowed).toEqual(['webSearch'])
    // Another workspace has its own (empty) store: it asks.
    const other = paidWithSettings(data, ['webSearch'])
    answerWith(UI_TEXT.allowOnce)
    await expect(
      other.paid.consent.allows({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }),
    ).resolves.toMatchObject({ feature: 'webSearch', tariffUsd: Usd.from('0.0025').toAmount() })
    expect(confirmModal).toHaveBeenCalledTimes(2)
    expect(other.paid.state().alwaysAllowed).toEqual([])
  })

  it('lapses everywhere once the price acceptance changes', async () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['voice']]])
    const workspace = new Map<string, unknown>()
    const { paid, settings } = paidWithSettings(data, ['voice'], { workspace })
    answerWith(UI_TEXT.paidAllowAlways)
    await paid.consent.allows({ feature: 'voice' })
    expect(paid.consent.isRemembered('voice')).toBe(true)
    // The setting turned off (anywhere): the review withdraws the acceptance.
    settings.delete('voice')
    await paid.gate.review()
    expect(paid.consent.isRemembered('voice')).toBe(false)
    // Turned on again with a fresh price acceptance: the old "always" is void.
    settings.add('voice')
    answerWith(UI_TEXT.paidConfirmAccept)
    await paid.gate.review()
    expect(paid.gate.isOn('voice')).toBe(true)
    expect(paid.consent.isRemembered('voice')).toBe(false)
    answerWith(UI_TEXT.paidDeny)
    await expect(paid.consent.allows({ feature: 'voice' })).resolves.toBe(false)
  })

  it('is neither offered nor honoured where it cannot be kept', async () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]])
    const workspace = new Map<string, unknown>([
      [WORKSPACE_STATE_KEYS.paidWorkspaceGrants, { webSearch: 0 }],
    ])
    let canRemember = false
    const { paid } = paidWithSettings(data, ['webSearch'], {
      workspace,
      canRemember: () => canRemember,
    })
    expect(paid.consent.isRemembered('webSearch')).toBe(false)
    answerWith(UI_TEXT.allowOnce)
    await expect(
      paid.consent.allows({ feature: 'webSearch', priceUsd: Usd.from(0.0025).toAmount() }),
    ).resolves.toMatchObject({ feature: 'webSearch', tariffUsd: Usd.from('0.0025').toAmount() })
    expect(offeredButtons()).toEqual([UI_TEXT.allowOnce, UI_TEXT.paidDeny])
    canRemember = true
    expect(paid.consent.isRemembered('webSearch')).toBe(true)
  })

  it('ignores a stored grant that is malformed or from an older acceptance', () => {
    const data = new Map<string, unknown>([
      [GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch', 'voice']],
      [GLOBAL_STATE_KEYS.paidGrantGenerations, { webSearch: 2 }],
    ])
    const workspace = new Map<string, unknown>([
      [WORKSPACE_STATE_KEYS.paidWorkspaceGrants, { webSearch: 1, voice: 0 }],
    ])
    const { paid } = paidWithSettings(data, ['webSearch', 'voice'], { workspace })
    expect(paid.consent.remembered()).toEqual(['voice'])
    workspace.set(WORKSPACE_STATE_KEYS.paidWorkspaceGrants, 'everything')
    expect(paid.consent.remembered()).toEqual([])
  })

  it('asks again after "Ask again", and a protected write asks despite "always"', async () => {
    const data = new Map<string, unknown>([
      [GLOBAL_STATE_KEYS.paidConfirmations, ['imageGeneration']],
    ])
    const { paid } = paidWithSettings(data, ['imageGeneration'])
    const image = {
      feature: 'imageGeneration',
      kind: 'generate',
      path: '.vscode/logo.png',
      sources: [],
      prompt: 'A logo',
    } as const
    answerWith(UI_TEXT.paidAllowAlways)
    await paid.consent.allows(image)
    answerWith(UI_TEXT.paidDeny)
    await expect(paid.consent.allows(image, true)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(2)
    await paid.consent.forget()
    expect(paid.state().alwaysAllowed).toEqual([])
    answerWith(UI_TEXT.allowOnce)
    await expect(paid.consent.allows(image)).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledTimes(3)
  })
})

describe('M94 Tab wording and window question (lane L, PLAN.md D73)', () => {
  const TAB = {
    feature: 'tab',
    modelId: 'muse-spark-1.3',
    budgetUsd: Usd.from(1).toAmount(),
  } as const

  it('refuses Tab on a model without verified rates before any popup', async () => {
    await expect(
      askPaidUse(
        { feature: 'tab', modelId: 'muse-spark-future', budgetUsd: Usd.from(1).toAmount() },
        true,
      ),
    ).resolves.toBe('deny')
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('refuses Tab with an unusable budget before any popup', async () => {
    await expect(
      askPaidUse(
        { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: Usd.from(-1).toAmount() },
        true,
      ),
    ).resolves.toBe('deny')
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('names Tab, the model, its rates and today\u{2019}s budget', async () => {
    const standard = await details(TAB)
    expect(standard.title).toBe(UI_TEXT.paidUseTabTitle)
    expect(standard.detail).toContain('muse-spark-1.3')
    expect(standard.detail).toContain('$1.250/1M input')
    expect(standard.detail).toContain('$1.00')
    expect(standard.detail).toContain('Allow once covers this window until it closes')
    const contributor = await details({ ...TAB, modelId: 'muse-spark-1.3-contributor' })
    expect(contributor.detail).toContain('muse-spark-1.3-contributor')
    expect(contributor.detail).toContain(UI_TEXT.tabTrainingContributor)
  })

  it('shows no turn-on confirmation: Tab is on, and its first request asks (owner 2026-10-04)', async () => {
    const data = new Map<string, unknown>()
    const { paid } = paidWithSettings(data, ['tab'])
    await paid.gate.review()
    expect(confirmModal).not.toHaveBeenCalled()
    expect(paid.gate.isOn('tab')).toBe(true)
    // The price is named by the first request's question instead.
    answerWith(UI_TEXT.paidDeny)
    await expect(paid.consent.allows(TAB)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(1)
    expect(vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail).toContain('$1.250/1M input')
  })

  it('asks once per window, and again after the price acceptance changes', async () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['tab']]])
    const { paid, settings } = paidWithSettings(data, ['tab'])
    answerWith(UI_TEXT.allowOnce)
    await expect(paid.consent.allows(TAB)).resolves.toBe(true)
    await expect(paid.consent.allows(TAB)).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledTimes(1)
    // Nothing was stored for this window: only the setting's price was kept.
    expect(data.get(GLOBAL_STATE_KEYS.paidConfirmations)).toEqual(['tab'])
    // The setting turned off and on again (no turn-on modal for Tab, M94):
    // the acceptance changed under the window's once, so it asks again.
    settings.delete('tab')
    await paid.gate.review()
    settings.add('tab')
    await paid.gate.review()
    expect(paid.gate.isOn('tab')).toBe(true)
    expect(confirmModal).toHaveBeenCalledTimes(1)
    answerWith(UI_TEXT.allowOnce)
    await expect(paid.consent.allows(TAB)).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledTimes(2)
  })

  it('asks again after another window withdrew and accepted the price anew (RVM94LC finding 7)', async () => {
    // Two windows: each its own memory, one shared global state.
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['tab']]])
    const windowA = paidWithSettings(data, ['tab'])
    const windowB = paidWithSettings(data, ['tab'])
    answerWith(UI_TEXT.allowOnce)
    await expect(windowA.paid.consent.allows(TAB)).resolves.toBe(true)
    // Window B withdraws Tab's price, then accepts it again.
    windowB.settings.delete('tab')
    await windowB.paid.gate.review()
    windowB.settings.add('tab')
    // No turn-on modal for Tab (M94, owner 2026-10-04): the acceptance
    // follows the setting, and the generation still moves.
    await windowB.paid.gate.review()
    expect(data.get(GLOBAL_STATE_KEYS.paidGrantGenerations)).toEqual({ tab: 2 })
    expect(windowA.paid.gate.isOn('tab')).toBe(true)
    // Window A's once was given under the withdrawn acceptance: it asks.
    answerWith(UI_TEXT.paidDeny)
    await expect(windowA.paid.consent.allows(TAB)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(2)
    // A reload keeps nothing either: it asks under the current acceptance.
    const reloaded = paidWithSettings(data, ['tab'])
    answerWith(UI_TEXT.paidDeny)
    await expect(reloaded.paid.consent.allows(TAB)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(3)
  })
})

describe('M48 paid child task price', () => {
  it('requires the current price revision in addition to the setting and accepted feature', () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['subagents']]])
    const { paid } = paidWithSettings(data, ['subagents'])
    expect(paid.gate.isOn('subagents')).toBe(false)
    data.set(GLOBAL_STATE_KEYS.subagentPriceAcceptance, 'old-price')
    expect(paid.gate.isOn('subagents')).toBe(false)
    data.set(GLOBAL_STATE_KEYS.subagentPriceAcceptance, SUBAGENT_PRICE_ACCEPTANCE_VERSION)
    expect(paid.gate.isOn('subagents')).toBe(true)
  })
})

describe('M52 scheduled feature acceptance', () => {
  it('shows both verified tariff tiers before enabling the feature', async () => {
    const data = new Map<string, unknown>()
    const { paid } = paidWithSettings(data, ['scheduledPrompts'])
    vi.mocked(confirmModal).mockResolvedValueOnce(UI_TEXT.paidConfirmAccept)
    await paid.gate.review()
    const detail = vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail
    expect(detail).toContain('muse-spark-1.3:')
    expect(detail).toContain('muse-spark-1.3-contributor:')
    expect(detail).toContain('$1.250/1M input')
    expect(detail).toContain('$0.100/1M input')
    expect(detail).toContain('$0.0020/1M cached input')
    expect(paid.gate.isOn('scheduledPrompts')).toBe(true)
  })
})

describe('M77 best-of-N feature acceptance', () => {
  it('shows the attempts and the ceiling with both tariff tiers before enabling', async () => {
    const data = new Map<string, unknown>()
    const { paid } = paidWithSettings(data, ['bestOfN'])
    vi.mocked(confirmModal).mockResolvedValueOnce(UI_TEXT.paidConfirmAccept)
    await paid.gate.review()
    const detail = vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail
    expect(detail).toContain('separate worktrees')
    expect(detail).toContain('muse-spark-1.3:')
    expect(detail).toContain('muse-spark-1.3-contributor:')
    expect(detail).toContain('3 attempts')
    expect(detail).toContain('20 requests')
    expect(paid.gate.isOn('bestOfN')).toBe(true)
  })

  it('stays off until its own setting and price are accepted', () => {
    const data = new Map<string, unknown>()
    const { paid } = paidWithSettings(data, [])
    expect(paid.gate.isOn('bestOfN')).toBe(false)
  })
})

async function judgeDetail(budget: unknown) {
  const { get } = mockJudgePaidConfiguration(budget)
  // U defers the same price text to the actual first-charge three-choice popup.
  const { paid } = paidWithSettings(new Map<string, unknown>(), ['judge'])
  answerWith(UI_TEXT.allowOnce)
  await paid.allowsJudgeUse('muse-spark-1.3')
  const detail = vi.mocked(confirmModal).mock.calls[0]?.[1]?.detail ?? ''
  return { detail, get }
}

describe('M98 judge first-charge detail', () => {
  it('asks once before the first charge and fills the shared daily budget', async () => {
    const { detail, get } = await judgeDetail(12.5)
    expect(detail).toContain('asks once before the first charge')
    expect(detail).not.toContain('Every judgment asks first')
    expect(detail).toContain('$12.50')
    expect(detail).not.toContain('{budget}')
    expect(detail).not.toContain('{price}')
    expect(detail).toContain('$1.250/1M input')
    expect(get).toHaveBeenCalledWith('paidDailyBudgetUsd')
  })

  it.each([undefined, NaN, Infinity, -1])(
    'shows zero rather than an invalid shared daily budget (%s)',
    async (budget) => {
      const { detail } = await judgeDetail(budget)
      expect(detail).toContain('shared daily budget: $0.00')
      expect(detail).not.toContain('{budget}')
    },
  )
})

function heldPaidQuoteWriter() {
  const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]])
  const workspace = new Map<string, unknown>()
  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  const base = memento(workspace)
  let isFirst = true
  const paid = createPaidFeatures({
    globalState: memento(data),
    workspaceState: {
      keys: base.keys,
      get: base.get,
      update: async (key, value) => {
        if (isFirst && key.startsWith(`${WORKSPACE_STATE_KEYS.paidQuoteGrants}:`)) {
          isFirst = false
          entered.resolve(undefined)
          await released.promise
        }
        await base.update(key, value)
      },
    },
    isSettingOn: () => true,
    isKeyStored: () => true,
    canRememberPaidUse: () => true,
    log: new FakeLogOutputChannel(),
  })
  return { data, workspace, paid, entered, released }
}

describe('R3 Memento grant races', () => {
  it('P2-1: a model B Always answer after Ask again never restores revoked model A', async () => {
    const workspace = new Map<string, unknown>()
    const { paid } = paidWithSettings(
      new Map([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]]),
      ['webSearch'],
      { workspace },
    )
    answerWith(UI_TEXT.paidAllowAlways)
    await paid.consent.allows(quotedSearch('0.01'))
    const held = Promise.withResolvers<PaidUseAnswer>()
    const pending = paid.consent.allows(quotedSearch('0.01', 'model-b'), false, () => held.promise)
    await paid.consent.forget()
    held.resolve('always')
    expect(await pending).toBeUndefined()
    answerWith(UI_TEXT.paidDeny)
    expect(await paid.consent.allows(quotedSearch('0.01'))).toBeUndefined()
    expect(confirmModal).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])(
    'R4 P2-1: older approval with three Once answers cannot replace a newer cheaper ceiling (revocation %s)',
    async (revokes) => {
      const { data, workspace, paid: first, entered, released } = heldPaidQuoteWriter()
      for (const id of ['once-a', 'once-b', 'once-c'])
        await first.consent.allows(quotedSearch('0.01', 'model-a', id), false, () =>
          Promise.resolve('once'),
        )
      const pending = first.consent.allows(quotedSearch('0.01'), true, () =>
        Promise.resolve('always'),
      )
      await entered.promise
      const second = paidWithSettings(data, ['webSearch'], { workspace }).paid
      if (revokes) await second.consent.forget()
      await second.consent.allows(quotedSearch('0.0025'), false, () => Promise.resolve('always'))
      released.resolve(undefined)
      expect(await pending).toBeUndefined()
      const reopened = paidWithSettings(data, ['webSearch'], { workspace }).paid
      const denied = vi.fn(() => Promise.resolve<PaidUseAnswer>('deny'))
      expect(await reopened.consent.allows(quotedSearch('0.0025'), false, denied)).toMatchObject({
        tariffUsd: Usd.from('0.0025').toAmount(),
      })
      expect(denied).not.toHaveBeenCalled()
      expect(await reopened.consent.allows(quotedSearch('0.01'), false, denied)).toBeUndefined()
      expect(denied).toHaveBeenCalledOnce()
    },
  )
})

it('R4 P2-2: a revoked save completion preserves the same owner replacement approval', async () => {
  const { paid, entered, released } = heldPaidQuoteWriter()
  const old = paid.consent.allows(quotedSearch('0.01'), false, () => Promise.resolve('always'))
  await entered.promise
  await paid.consent.forget()
  const fresh = quotedSearch('0.0025', 'model-a', 'replacement')
  await paid.consent.allows(fresh, false, () => Promise.resolve('always'))
  expect(paid.consent.authority.canSpend(fresh.quote)).toBe(true)
  released.resolve(undefined)
  expect(await old).toBeUndefined()
  expect(paid.consent.authority.canSpend(fresh.quote)).toBe(true)
  expect(paid.consent.isRemembered('webSearch')).toBe(true)
})

it('R4 P2-1: incomparable legacy owner orders ask again in the profile chronology', async () => {
  const workspace = new Map<string, unknown>()
  const old = quotedSearch('0.01')
  const generation = JSON.stringify([0, 0])
  workspace.set(
    `${WORKSPACE_STATE_KEYS.paidQuoteGrants}:${JSON.stringify(['webSearch', 'meta', 'model-a'])}:${generation}:100:old`,
    { generation, order: 100, quote: old.quote },
  )
  const { paid } = paidWithSettings(
    new Map([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]]),
    ['webSearch'],
    { workspace },
  )
  const ask = vi.fn(() => Promise.resolve<PaidUseAnswer>('deny'))
  expect(await paid.consent.allows(old, false, ask)).toBeUndefined()
  expect(ask).toHaveBeenCalledOnce()
})

describe('FIXM106W search window consent', () => {
  it('covers distinct quotes in this window and asks again on model, price, revocation and required asking', async () => {
    const { paid } = paidWithSettings(
      new Map([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]]),
      ['webSearch'],
    )
    const ask = vi.fn(() => Promise.resolve<PaidUseAnswer>('once'))
    for (const id of ['first', 'second']) {
      const request = quotedSearch('0.01', 'model-a', id)
      expect(await paid.consent.allows(request, false, ask)).toEqual(request.quote)
      expect(paid.consent.authority.canSpend(request.quote)).toBe(true)
    }
    expect(ask).toHaveBeenCalledOnce()
    expect(paid.consent.remembered()).not.toContain('webSearch')
    await paid.consent.allows(quotedSearch('0.01', 'model-a', 'required'), true, ask)
    await paid.consent.allows(quotedSearch('0.01', 'model-b', 'model'), false, ask)
    await paid.consent.allows(quotedSearch('0.02', 'model-b', 'price'), false, ask)
    expect(ask).toHaveBeenCalledTimes(4)
    await paid.consent.forget()
    await paid.consent.allows(quotedSearch('0.01', 'model-a', 'revoked'), false, ask)
    expect(ask).toHaveBeenCalledTimes(5)
    const nextWindow = paidWithSettings(
      new Map([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]]),
      ['webSearch'],
    ).paid
    await nextWindow.consent.allows(quotedSearch('0.01', 'model-a', 'new-window'), false, ask)
    expect(ask).toHaveBeenCalledTimes(6)
  })

  it('shares the first popup between concurrent quotes and refuses its revoked answer', async () => {
    const { paid } = paidWithSettings(
      new Map([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]]),
      ['webSearch'],
    )
    const held = Promise.withResolvers<PaidUseAnswer>()
    const ask = vi.fn(() => held.promise)
    const requests = ['a', 'b'].map((id) => quotedSearch('0.01', 'model-a', id))
    const answers = requests.map((request) => paid.consent.allows(request, false, ask))
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledOnce()
    })
    held.resolve('once')
    expect(await Promise.all(answers)).toEqual(requests.map((request) => request.quote))
    await paid.consent.forget()
    const stale = Promise.withResolvers<PaidUseAnswer>()
    const staleAsk = vi.fn(() => stale.promise)
    const pending = paid.consent.allows(quotedSearch('0.01', 'model-a', 'stale'), false, staleAsk)
    await vi.waitFor(() => {
      expect(staleAsk).toHaveBeenCalledOnce()
    })
    await paid.consent.forget()
    stale.resolve('once')
    expect(await pending).toBeUndefined()
  })
})

// TRAIN15D: an explanation on Muse Code still names its shared daily budget.
it('passes the legal explanation feature to daily-budget disclosure before consent', async () => {
  const readBudget = vi.fn((feature?: PaidFeature) =>
    feature === 'legalExplanation' ? Usd.from(5).toAmount() : undefined,
  )
  const store = memento(
    new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['legalExplanation']]]),
  )
  const paid = createPaidFeatures({
    globalState: store,
    workspaceState: store,
    isSettingOn: () => true,
    isKeyStored: () => true,
    canRememberPaidUse: () => false,
    dailyBudgetUsd: readBudget,
    log: new FakeLogOutputChannel(),
  })
  answerWith(UI_TEXT.paidDeny)
  expect(
    await paid.consent.allows({ feature: 'legalExplanation', modelId: 'muse-spark-1.3' }),
  ).toBe(false)
  expect(readBudget).toHaveBeenCalledWith('legalExplanation')
  const detail = vi.mocked(confirmModal).mock.calls.at(-1)?.[1]?.detail ?? ''
  expect(detail).toContain('$5.00')
  expect(detail).toContain('$1.250/1M input')
})
