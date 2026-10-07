import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  JUDGE_LABELS,
  JUDGE_NO_ANSWER_REASONS,
  JUDGE_SOURCES,
  JUDGE_TECHNIQUES,
} from '../../src/core/judge/schema'
import { UI_TEXT } from '../../src/shared/constants'
import {
  JUDGE_PANEL_LABELS,
  JUDGE_PANEL_REASONS,
  JUDGE_PANEL_SOURCES,
  JUDGE_PANEL_TECHNIQUES,
  judgePanelMoney,
  judgePanelRows,
  judgePanelStatusText,
  projectJudgePanel,
  unavailableJudgePanel,
  type JudgePanelFacts,
  type JudgePanelTechnique,
} from '../../src/shared/judgePanel'
import { formatUsd } from '../../src/shared/l10n/text'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'
import {
  parseHostToPanelMessage,
  parseModelsPanelState,
  parsePanelToHostMessage,
} from '../../src/shared/modelsPanel'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { makeState } from './modelsPanelFixtures'
import { judgeCapability, judgeFacts, modelApiFacts, subscriptionFacts } from './judgePanelFixtures'

const root = fileURLToPath(new URL('../..', import.meta.url))

function sourceText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('judge panel projection', () => {
  it('keeps the shared technique, label and reason enums, plus an absent source', () => {
    expect([...JUDGE_PANEL_TECHNIQUES]).toEqual([...JUDGE_TECHNIQUES])
    expect([...JUDGE_PANEL_LABELS]).toEqual([...JUDGE_LABELS])
    expect([...JUDGE_PANEL_REASONS]).toEqual([...JUDGE_NO_ANSWER_REASONS])
    expect(JUDGE_PANEL_SOURCES.filter((source) => source !== 'none')).toEqual([...JUDGE_SOURCES])
  })

  it('follows the selected model record, not the provider name', () => {
    for (const providerId of ['openai', 'anthropic', 'ollama', 'xai']) {
      const snapshot = projectJudgePanel(
        judgeFacts({
          providerId,
          capability: judgeCapability({ providerId }),
        }),
      )
      expect(snapshot.technique, providerId).toBe('logprob')
    }
    const refused = projectJudgePanel(
      judgeFacts({
        providerId: 'muse',
        capability: judgeCapability({ providerId: 'muse', logprobs: { kind: 'refused' } }),
      }),
    )
    expect(refused.technique).toBeUndefined()
    expect(refused.reason).toBe('capability-unavailable')
  })

  it('shows a technique only when that model record can honour it', () => {
    const rows: readonly {
      readonly name: string
      readonly technique: JudgePanelTechnique
      readonly facts: Partial<JudgePanelFacts>
      readonly kept: boolean
    }[] = [
      { name: 'logprob top-k', technique: 'logprob', facts: {}, kept: true },
      {
        name: 'logprob top-1',
        technique: 'logprob',
        facts: { capability: judgeCapability({ logprobs: { kind: 'top1' } }) },
        kept: false,
      },
      {
        name: 'top-1',
        technique: 'top1',
        facts: { capability: judgeCapability({ logprobs: { kind: 'top1' } }) },
        kept: true,
      },
      { name: 'stated', technique: 'stated', facts: {}, kept: true },
      {
        name: 'stated refused',
        technique: 'stated',
        facts: { capability: judgeCapability({ stated: false, logprobs: { kind: 'refused' } }) },
        kept: false,
      },
      {
        name: 'systemone',
        technique: 'systemone',
        facts: { capability: judgeCapability({ systemone: true }) },
        kept: true,
      },
      { name: 'systemone off', technique: 'systemone', facts: {}, kept: false },
      { name: 'sampling', technique: 'sampling', facts: {}, kept: true },
      {
        name: 'sampling reasoning',
        technique: 'sampling',
        facts: { capability: judgeCapability({ reasoningForced: true }) },
        kept: false,
      },
      {
        name: 'sampling no cache',
        technique: 'sampling',
        facts: { capability: judgeCapability({ cache: false }) },
        kept: false,
      },
      { name: 'contrastive stated', technique: 'contrastive', facts: {}, kept: true },
      {
        name: 'contrastive top-k only',
        technique: 'contrastive',
        facts: { capability: judgeCapability({ stated: false }) },
        kept: true,
      },
      {
        name: 'contrastive neither',
        technique: 'contrastive',
        facts: {
          capability: judgeCapability({ stated: false, logprobs: { kind: 'top1' } }),
        },
        kept: false,
      },
      {
        name: 'embedding',
        technique: 'embedding',
        facts: { capability: judgeCapability({ embedding: true }) },
        kept: true,
      },
      { name: 'embedding absent', technique: 'embedding', facts: {}, kept: false },
      {
        name: 'cascade both',
        technique: 'cascade',
        facts: { effectiveSource: 'both', capability: undefined },
        kept: true,
      },
      { name: 'cascade same', technique: 'cascade', facts: {}, kept: false },
      {
        name: 'cascade other model',
        technique: 'cascade',
        facts: {
          effectiveSource: 'both',
          capability: judgeCapability({ model: 'other-model' }),
        },
        kept: false,
      },
    ]
    for (const row of rows) {
      const snapshot = projectJudgePanel(judgeFacts({ technique: row.technique, ...row.facts }))
      expect(snapshot.technique, row.name).toBe(row.kept ? row.technique : undefined)
      if (!row.kept) {
        expect(snapshot.reason, row.name).toBe('capability-unavailable')
      }
    }
  })

  it('does not invent a technique when no record was supplied', () => {
    const snapshot = projectJudgePanel(judgeFacts({ capability: undefined, technique: 'logprob' }))
    expect(snapshot.technique).toBeUndefined()
    expect(snapshot.reason).toBe('capability-unavailable')
    const quiet = projectJudgePanel(judgeFacts({ capability: undefined, technique: undefined }))
    expect(quiet.technique).toBeUndefined()
    expect(quiet.reason).toBeUndefined()
  })

  it('clears a record that belongs to another model or provider', () => {
    const otherModel = projectJudgePanel(
      judgeFacts({ capability: judgeCapability({ model: 'other-model' }) }),
    )
    const otherProvider = projectJudgePanel(
      judgeFacts({ capability: judgeCapability({ providerId: 'other-provider' }) }),
    )
    expect(otherModel.technique).toBeUndefined()
    expect(otherProvider.technique).toBeUndefined()
    expect(otherModel.reason).toBe('capability-unavailable')
    expect(otherProvider.reason).toBe('capability-unavailable')
  })

  it('marks partial and calibration only for a technique the record supports', () => {
    const shown = projectJudgePanel(judgeFacts({ partial: true }))
    expect(shown.partial).toBe(true)
    expect(shown.label).toBe('calibrated (logprob)')
    const dropped = projectJudgePanel(
      judgeFacts({
        partial: true,
        capability: judgeCapability({ logprobs: { kind: 'refused' } }),
      }),
    )
    expect(dropped.partial).toBe(false)
    expect(dropped.label).toBeUndefined()
    const top1 = projectJudgePanel(
      judgeFacts({
        technique: 'top1',
        label: 'calibrated (logprob)',
        capability: judgeCapability({ logprobs: { kind: 'top1' } }),
      }),
    )
    expect(top1.label).toBe('approximate (top-1)')
    const mismatched = projectJudgePanel(
      judgeFacts({ technique: 'stated', label: 'calibrated (logprob)' }),
    )
    expect(mismatched.label).toBe('uncalibrated')
  })

  it('refuses an untested auto route and an unverified auto local endpoint', () => {
    const untested = projectJudgePanel(
      judgeFacts({
        engine: 'auto',
        effectiveSource: 'separate',
        experimental: true,
        billing: 'modelApi',
        consent: 'needed',
        inputPerMillion: 1,
        dailyBudgetUsd: 1,
      }),
    )
    expect(untested.effectiveSource).toBe('none')
    expect(untested.technique).toBeUndefined()
    expect(untested.untested).toBe(true)
    expect(untested.reason).toBe('source-untested')
    expect(untested.askFirstCharge).toBe(false)
    const explicit = projectJudgePanel(
      modelApiFacts({ engine: 'separate', effectiveSource: 'separate', experimental: true }),
    )
    expect(explicit.effectiveSource).toBe('separate')
    expect(explicit.technique).toBe('logprob')
    expect(explicit.untested).toBe(true)
    expect(explicit.askFirstCharge).toBe(true)
    const unverified = projectJudgePanel(
      judgeFacts({ engine: 'auto', effectiveSource: 'separate', locality: 'unverified' }),
    )
    expect(unverified.effectiveSource).toBe('none')
    expect(unverified.reason).toBe('local-unverified')
    expect(unverified.askFirstCharge).toBe(false)
  })

  it('refuses an unverified or non-same System One source in a confidential workspace', () => {
    const unverified = projectJudgePanel(
      modelApiFacts({
        confidential: true,
        locality: 'unverified',
        engine: 'separate',
        effectiveSource: 'separate',
      }),
    )
    expect(unverified.effectiveSource).toBe('none')
    expect(unverified.reason).toBe('confidential-refused')
    expect(unverified.askFirstCharge).toBe(false)
    const remote = projectJudgePanel(
      modelApiFacts({
        confidential: true,
        technique: 'systemone',
        effectiveSource: 'separate',
        capability: judgeCapability({ systemone: true }),
      }),
    )
    expect(remote.reason).toBe('confidential-refused')
    expect(remote.askFirstCharge).toBe(false)
    const same = projectJudgePanel(
      judgeFacts({
        confidential: true,
        technique: 'systemone',
        capability: judgeCapability({ systemone: true }),
      }),
    )
    expect(same.reason).toBeUndefined()
    expect(same.technique).toBe('systemone')
  })

  it('turns the engine off without asking, including over a stale consent reason', () => {
    const off = projectJudgePanel(modelApiFacts({ engine: 'off', reason: 'consent-needed' }))
    expect(off.effectiveSource).toBe('none')
    expect(off.technique).toBeUndefined()
    expect(off.reason).toBe('explicit-off')
    expect(off.askFirstCharge).toBe(false)
    const confidential = projectJudgePanel(
      judgeFacts({
        engine: 'off',
        confidential: true,
        locality: 'unverified',
        billing: 'modelApi',
        consent: 'needed',
      }),
    )
    expect(confidential.reason).toBe('confidential-refused')
    expect(confidential.askFirstCharge).toBe(false)
  })

  it('never asks for a first charge on a subscription with no paid source', () => {
    const snapshot = projectJudgePanel(subscriptionFacts())
    expect(snapshot.askFirstCharge).toBe(false)
    expect(snapshot.consent).toBe('not-required')
    expect(snapshot.showSubscriptionNote).toBe(true)
    expect(snapshot.reason).toBeUndefined()
    expect(snapshot.billing).toBe('subscription')
    const rows = judgePanelRows(snapshot)
    expect(rows.some((row) => row.term === UI_TEXT.judgePanel.reserved)).toBe(false)
    expect(rows.some((row) => row.detail === UI_TEXT.judgePanel.notKnown)).toBe(false)
    expect(judgePanelStatusText(snapshot)).toBe(UI_TEXT.judgeStatusSubscription)
  })

  it('asks once for a Model API charge and again when the paid identity changes', () => {
    const first = projectJudgePanel(modelApiFacts())
    expect(first.askFirstCharge).toBe(true)
    expect(first.showSubscriptionNote).toBe(false)
    const granted = projectJudgePanel(modelApiFacts({ consent: 'granted', reason: undefined }))
    expect(granted.askFirstCharge).toBe(false)
    const rebound = projectJudgePanel(
      modelApiFacts({
        consent: 'granted',
        reason: undefined,
        consentBoundTo: 'grant-a',
        paidIdentity: 'grant-b',
      }),
    )
    expect(rebound.consent).toBe('needed')
    expect(rebound.askFirstCharge).toBe(true)
    const sameGrant = projectJudgePanel(
      modelApiFacts({
        consent: 'granted',
        reason: undefined,
        consentBoundTo: 'grant-a',
        paidIdentity: 'grant-a',
      }),
    )
    expect(sameGrant.askFirstCharge).toBe(false)
  })

  it('asks when Muse Code has a paid source selected', () => {
    const snapshot = projectJudgePanel(
      judgeFacts({
        billing: 'subscription',
        paidSourceSelected: true,
        consent: 'needed',
        reason: 'consent-needed',
        inputPerMillion: 1,
        outputPerMillion: 4,
        dailyBudgetUsd: 2,
      }),
    )
    expect(snapshot.askFirstCharge).toBe(true)
    expect(snapshot.showSubscriptionNote).toBe(false)
  })

  it('does not ask a free local source or an unpriced paid source', () => {
    const free = projectJudgePanel(
      judgeFacts({ billing: 'free', paidSourceSelected: false, consent: 'needed' }),
    )
    expect(free.askFirstCharge).toBe(false)
    expect(free.consent).toBe('not-required')
    expect(judgePanelStatusText(free)).toBe(UI_TEXT.judgePanel.freeLocal)
    const unpriced = projectJudgePanel(
      judgeFacts({
        billing: 'modelApi',
        consent: 'needed',
        reason: 'consent-needed',
        dailyBudgetUsd: 5,
      }),
    )
    expect(unpriced.reason).toBe('unpriced')
    expect(unpriced.askFirstCharge).toBe(false)
    expect(unpriced.inputPerMillion).toBeUndefined()
    const price = judgePanelRows(unpriced).find((row) => row.term === UI_TEXT.judgePanel.price)
    expect(price?.detail).toBe(UI_TEXT.judgePanel.unpriced)
  })

  it('shows an absent paid amount as not known and keeps a real zero', () => {
    const absent = projectJudgePanel(modelApiFacts())
    expect(absent.dailyBudgetUsd).toBe(5)
    const reserved = judgePanelRows(absent).find((row) => row.term === UI_TEXT.judgePanel.reserved)
    expect(reserved?.detail).toBe(UI_TEXT.judgePanel.notKnown)
    expect(reserved?.detail).not.toBe(judgePanelMoney(0))
    const budget = judgePanelRows(
      projectJudgePanel(modelApiFacts({ dailyBudgetUsd: undefined })),
    ).find((row) => row.term === UI_TEXT.judgePanel.dailyBudget)
    expect(budget?.detail).toBe(UI_TEXT.judgePanel.notKnown)
    expect(budget?.detail).not.toBe(judgePanelMoney(1))
    const zero = judgePanelRows(projectJudgePanel(modelApiFacts({ settledUsd: 0 }))).find(
      (row) => row.term === UI_TEXT.judgePanel.settled,
    )
    expect(zero?.detail).toBe(judgePanelMoney(0))
  })

  it('formats amounts under one cent with six digits and drops a negative amount', () => {
    expect(judgePanelMoney(0.000012)).toBe(formatUsd(0.000012, 6))
    expect(judgePanelMoney(0.000012)).not.toBe(formatUsd(0.000012, 2))
    expect(judgePanelMoney(1.5)).toBe(formatUsd(1.5, 2))
    const snapshot = projectJudgePanel(modelApiFacts({ reservedUsd: 0.000012 }))
    const reserved = judgePanelRows(snapshot).find(
      (row) => row.term === UI_TEXT.judgePanel.reserved,
    )
    expect(reserved?.detail).toBe(judgePanelMoney(0.000012))
    const dropped = projectJudgePanel(modelApiFacts({ reservedUsd: -1 }))
    expect(dropped.reservedUsd).toBeUndefined()
    expect(
      judgePanelRows(dropped).find((row) => row.term === UI_TEXT.judgePanel.reserved)?.detail,
    ).toBe(UI_TEXT.judgePanel.notKnown)
  })

  it('refuses a non-finite amount instead of publishing zero', () => {
    expect(() => projectJudgePanel(modelApiFacts({ settledUsd: NaN }))).toThrow(TypeError)
    expect(() => projectJudgePanel(modelApiFacts({ settledUsd: Infinity }))).toThrow(TypeError)
  })

  it('rejects an unexpected field and an unavailable report asks for nothing', () => {
    expect(() =>
      projectJudgePanel({ ...subscriptionFacts(), unexpected: 'field' } as JudgePanelFacts),
    ).toThrow(TypeError)
    const unavailable = unavailableJudgePanel()
    expect(unavailable.askFirstCharge).toBe(false)
    expect(unavailable.reason).toBe('source-unavailable')
    expect(unavailable.effectiveSource).toBe('none')
    expect(JSON.stringify(unavailable)).not.toContain('unexpected')
    const snapshot = projectJudgePanel(modelApiFacts())
    expect(snapshot).not.toHaveProperty('capability')
    expect(parseHostToWebviewMessage({ type: 'judgeUsage', usage: snapshot }).ok).toBe(true)
    expect(
      parseHostToWebviewMessage({ type: 'judgeUsage', usage: { ...snapshot, unexpected: 'field' } })
        .ok,
    ).toBe(false)
    expect(parsePanelToHostMessage({ type: 'judge/askConsent' }).ok).toBe(true)
    expect(parsePanelToHostMessage({ type: 'judge/askConsent', unexpected: 'field' }).ok).toBe(
      false,
    )
    expect(parseHostToPanelMessage({ type: 'modelsPanel/navigate', section: 'judge' }).ok).toBe(
      true,
    )
    const state = makeState({ judge: snapshot })
    expect(parseModelsPanelState(state).ok).toBe(true)
    expect(
      parseModelsPanelState({ ...state, judge: { ...snapshot, unexpected: 'field' } }).ok,
    ).toBe(false)
  })

  it('keeps the usage snapshot when the conversation is cleared', () => {
    const usage = projectJudgePanel(subscriptionFacts())
    const shown = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: { type: 'judgeUsage', usage },
      at: 1,
    })
    expect(shown.judgeUsage).toEqual(usage)
    const cleared = uiReducer(shown, { type: 'conversationCleared' })
    expect(cleared.judgeUsage).toEqual(usage)
    expect(cleared.judge).toBeUndefined()
  })

  it('stays out of the core and the editor API', () => {
    for (const path of [
      'src/shared/judgePanel.ts',
      'src/webview/models/sections/judge/JudgeSection.tsx',
    ]) {
      const text = sourceText(path).replaceAll('\\', '/')
      expect(text, path).not.toMatch(/from ['"][^'"]*\/core\//)
      expect(text, path).not.toMatch(/from ['"]vscode['"]/)
    }
  })
})
