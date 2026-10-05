import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
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
import { confirmModal } from './helpers/vscodeViews'
import { window } from './mocks/vscode'

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

function memento(data: Map<string, unknown>) {
  return {
    get: (key: string) => data.get(key),
    update: (key: string, value: unknown) => {
      data.set(key, value)
      return Promise.resolve()
    },
  }
}

function paidWithSettings(
  data: Map<string, unknown>,
  enabled: readonly PaidFeature[],
  options: { workspace?: Map<string, unknown>; canRemember?: () => boolean } = {},
) {
  const settings = new Set(enabled)
  const paid = createPaidFeatures({
    globalState: memento(data),
    workspaceState: memento(options.workspace ?? new Map<string, unknown>()),
    isSettingOn: (feature) => settings.has(feature),
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
  await askPaidUse(request, true)
  const call = vi.mocked(confirmModal).mock.calls.at(-1)
  return { title: call?.[0], detail: call?.[1]?.detail ?? '' }
}

describe('the paid-use popup (M58)', () => {
  it('offers Allow once, Allow always in this workspace and Deny, Deny closing it', async () => {
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(askPaidUse({ feature: 'webSearch' }, true)).resolves.toBe('always')
    expect(offeredButtons()).toEqual([UI_TEXT.allowOnce, UI_TEXT.paidAllowAlways, UI_TEXT.paidDeny])
    const deny = vi.mocked(confirmModal).mock.calls[0]?.slice(2).at(-1) as vscode.MessageItem
    expect(deny.isCloseAffordance).toBe(true)
    expect(vi.mocked(confirmModal).mock.calls[0]?.[1]).toMatchObject({ modal: true })
    answerWith(UI_TEXT.allowOnce)
    await expect(askPaidUse({ feature: 'webSearch' }, true)).resolves.toBe('once')
    answerWith(UI_TEXT.paidDeny)
    await expect(askPaidUse({ feature: 'webSearch' }, true)).resolves.toBe('deny')
    answerWith(undefined)
    await expect(askPaidUse({ feature: 'webSearch' }, true)).resolves.toBe('deny')
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
    const search = await details({ feature: 'webSearch' })
    expect(search.title).toBe(UI_TEXT.paidUseWebSearchTitle)
    expect(search.detail).toContain('$2.50 per 1,000 searches')
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
  it('asks once, then remembers the feature in this workspace only', async () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['webSearch']]])
    const workspace = new Map<string, unknown>()
    const { paid } = paidWithSettings(data, ['webSearch'], { workspace })
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(paid.consent.allows({ feature: 'webSearch' })).resolves.toBe(true)
    await expect(paid.consent.allows({ feature: 'webSearch' })).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledTimes(1)
    expect(workspace.get(WORKSPACE_STATE_KEYS.paidWorkspaceGrants)).toEqual({ webSearch: 0 })
    expect(paid.state().alwaysAllowed).toEqual(['webSearch'])
    // Another workspace has its own (empty) store: it asks.
    const other = paidWithSettings(data, ['webSearch'])
    answerWith(UI_TEXT.allowOnce)
    await expect(other.paid.consent.allows({ feature: 'webSearch' })).resolves.toBe(true)
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
    await expect(paid.consent.allows({ feature: 'webSearch' })).resolves.toBe(true)
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
  const TAB = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 } as const

  it('refuses Tab on a model without verified rates before any popup', async () => {
    await expect(
      askPaidUse({ feature: 'tab', modelId: 'muse-spark-future', budgetUsd: 1 }, true),
    ).resolves.toBe('deny')
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('refuses Tab with an unusable budget before any popup', async () => {
    await expect(
      askPaidUse({ feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: NaN }, true),
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
    expect(detail).toContain('$0.002/1M cached input')
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
