import { Usd } from '../../src/shared/usd'
import { memento } from './helpers/memento'
import type * as vscode from 'vscode'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaidFeatures, askPaidUse } from '../../src/host/paid/paidHost'
import { paidUseQuestion } from '../../src/core/paid/paidConsent'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import { GLOBAL_STATE_KEYS, UI_TEXT } from '../../src/shared/constants'
import { paidCostUsd } from '../../src/shared/paid'
import { formatUsd } from '../../src/shared/l10n/text'
import { mockJudgePaidConfiguration } from './helpers/judgePaidConfiguration'
import { FakeLogOutputChannel } from './helpers/fakes'
import { window } from './mocks/vscode'

type MessageModal = (
  message: string,
  options: vscode.MessageOptions,
  ...items: vscode.MessageItem[]
) => Thenable<vscode.MessageItem | undefined>
const modal: MessageModal = window.showWarningMessage

function setup() {
  const globals = new Map<string, unknown>()
  const workspace = new Map<string, unknown>()
  let isOn = true
  let hasKey = true
  const paid = createPaidFeatures({
    globalState: memento(globals),
    workspaceState: memento(workspace),
    isSettingOn: () => false,
    isJudgeOn: () => isOn,
    isKeyStored: () => hasKey,
    canRememberPaidUse: () => true,
    log: new FakeLogOutputChannel(),
  })
  return {
    paid,
    globals,
    workspace,
    off: () => {
      isOn = false
    },
    noKey: () => {
      hasKey = false
    },
  }
}

function answer(title: string) {
  vi.mocked(modal).mockImplementationOnce((_message, _options, ...items) =>
    Promise.resolve(items.find((item) => item.title === title)),
  )
}

beforeEach(() => {
  vi.mocked(modal).mockReset()
  window.state.focused = true
  mockJudgePaidConfiguration(2)
})

describe('Judge first-charge consent hook', () => {
  it('does not prompt at activation; first charge gets exactly one three-choice modal with price and the shared daily budget', async () => {
    const rig = setup()
    await rig.paid.gate.review()
    expect(modal).not.toHaveBeenCalled()
    expect(rig.paid.gate.isOn('judge')).toBe(false)
    answer(UI_TEXT.paidAllowAlways)
    await expect(rig.paid.allowsJudgeUse('muse-spark-1.3')).resolves.toBe(true)
    const call = vi.mocked(modal).mock.calls[0]
    expect(
      call
        ?.slice(2)
        .map((item) => (typeof item === 'object' && 'title' in item ? item.title : item)),
    ).toEqual([UI_TEXT.allowOnce, UI_TEXT.paidAllowAlways, UI_TEXT.paidDeny])
    expect(call?.[1].detail).toContain(formatUsd(2, 2))
    expect(call?.[1].detail).toContain('$1.25')
    expect(rig.paid.gate.isOn('judge')).toBe(true)
    expect(rig.paid.consent.isRemembered('judge')).toBe(true)
    await rig.paid.allowsJudgeUse('muse-spark-1.3')
    expect(modal).toHaveBeenCalledTimes(1)
    expect(rig.globals.get(GLOBAL_STATE_KEYS.paidConfirmations)).toEqual(['judge'])
  })

  it('Allow once never becomes a remembered grant; Deny and closing never accept the price', async () => {
    const once = setup()
    answer(UI_TEXT.allowOnce)
    await expect(once.paid.allowsJudgeUse('muse-spark-1.3')).resolves.toBe(true)
    expect(once.paid.consent.isRemembered('judge')).toBe(false)
    answer(UI_TEXT.paidDeny)
    await expect(once.paid.allowsJudgeUse('muse-spark-1.3')).resolves.toBe(false)
    const denied = setup()
    vi.mocked(modal).mockResolvedValueOnce(undefined)
    await expect(denied.paid.allowsJudgeUse('muse-spark-1.3')).resolves.toBe(false)
    expect(denied.paid.gate.isOn('judge')).toBe(false)
  })

  it('re-checks a mode change while the first-charge modal is held', async () => {
    const rig = setup()
    const held = Promise.withResolvers<vscode.MessageItem | undefined>()
    vi.mocked(modal).mockReturnValueOnce(held.promise)
    const allowed = rig.paid.allowsJudgeUse('muse-spark-1.3')
    rig.off()
    held.resolve({ title: UI_TEXT.paidAllowAlways })
    await expect(allowed).resolves.toBe(false)
    expect(rig.globals.get(GLOBAL_STATE_KEYS.paidConfirmations)).toBeUndefined()
    expect(rig.workspace.size).toBe(0)
  })

  it('denies invalid Judge tariffs and budgets at the host boundary without a popup', async () => {
    await expect(
      askPaidUse(
        { feature: 'judge', modelId: 'unknown', dailyBudgetUsd: Usd.from(2).toAmount() },
        true,
      ),
    ).resolves.toBe('deny')
    await expect(
      askPaidUse(
        { feature: 'judge', modelId: 'muse-spark-1.3', dailyBudgetUsd: Usd.from(-1).toAmount() },
        true,
      ),
    ).resolves.toBe('deny')
    expect(modal).not.toHaveBeenCalled()
  })

  it('cannot accept a Judge price while its engine is off', async () => {
    const rig = setup()
    rig.off()
    await expect(rig.paid.gate.acceptJudgePrice()).resolves.toBe(false)
    expect(rig.globals.get(GLOBAL_STATE_KEYS.paidConfirmations)).toBeUndefined()
  })

  it('requires a stored key and a known tariff even after an always grant', async () => {
    const rig = setup()
    answer(UI_TEXT.paidAllowAlways)
    await rig.paid.allowsJudgeUse('muse-spark-1.3')
    await expect(rig.paid.allowsJudgeUse('unknown')).resolves.toBe(false)
    rig.noKey()
    await expect(rig.paid.allowsJudgeUse('muse-spark-1.3')).resolves.toBe(false)
    expect(modal).toHaveBeenCalledTimes(1)
  })

  it('refuses an invalid first-charge budget and an unpriced model before showing a popup', () => {
    for (const dailyBudgetUsd of [-1, NaN, Infinity]) {
      expect(() => {
        paidUseQuestion({
          feature: 'judge',
          modelId: 'muse-spark-1.3',
          dailyBudgetUsd: Usd.from(dailyBudgetUsd).toAmount(),
        })
      }).toThrow()
    }
    expect(() => {
      paidUseQuestion({
        feature: 'judge',
        modelId: 'unknown',
        dailyBudgetUsd: Usd.from(2).toAmount(),
      })
    }).toThrow()
    expect(modal).not.toHaveBeenCalled()
  })

  it('forgetting grants or withdrawing the price makes the paid source ask again', async () => {
    const rig = setup()
    answer(UI_TEXT.paidAllowAlways)
    await rig.paid.allowsJudgeUse('muse-spark-1.3')
    await rig.paid.consent.forget()
    answer(UI_TEXT.allowOnce)
    await rig.paid.allowsJudgeUse('muse-spark-1.3')
    expect(modal).toHaveBeenCalledTimes(2)
    rig.off()
    await rig.paid.gate.review()
    expect(rig.paid.gate.isOn('judge')).toBe(false)
    expect(rig.paid.consent.isRemembered('judge')).toBe(false)
  })
})

describe('Judge usage receipts', () => {
  it('counts attempts and known usage separately, retaining unknown attempts in the tally', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('judge', 2)
    usage.addJudgeUsage('muse-spark-1.3', {
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 500,
    })
    expect(usage.current).toMatchObject({
      judgeCalls: 2,
      judgeUnknownRequests: 1,
      judgeTokens: 1100,
    })
    expect(Number(paidCostUsd('judge', usage.current))).toBeCloseTo(0.001125)
    const unmatched = new PaidUsage(new FakeLogOutputChannel())
    unmatched.addJudgeUsage('muse-spark-1.3', {
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 0,
    })
    expect(unmatched.current.judgeTokens).toBeUndefined()
  })

  it('refuses unpriced, malformed or impossible usage instead of reporting a free call', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('judge', 1)
    expect(() => {
      usage.addJudgeUsage('unknown', { inputTokens: 10, outputTokens: 1, cachedTokens: 0 })
    }).toThrow()
    expect(() => {
      usage.addJudgeUsage('muse-spark-1.3', { inputTokens: 10, outputTokens: 1, cachedTokens: 20 })
    }).toThrow()
    expect(usage.current.judgeUnknownRequests).toBe(1)
  })
})
