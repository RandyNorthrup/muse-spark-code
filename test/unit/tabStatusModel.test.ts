import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type { TabFailureKind, TabOutcome } from '../../src/host/tab/tabBundle'
import {
  nextTabFailureState,
  TAB_FAILURE_STATE_INIT,
  tabStatusViewOf,
  type TabStatusSnapshot,
} from '../../src/host/tab/tabStatusModel'

// M94 acceptance 15 (every state D73 names) and acceptance 2 (the no-key
// row): the pure status model over the real English table. Each state has
// its own codicon and its filled sentence; no template ever shows.

function snapshotOf(overrides: Partial<TabStatusSnapshot> = {}): TabStatusSnapshot {
  return {
    isOn: true,
    totalUsd: Usd.from(0.12).toAmount(),
    requests: 3,
    budgetUsd: Usd.from(1).toAmount(),
    model: 'muse-spark-1.3',
    snoozed: false,
    minutesLeft: undefined,
    budgetReached: false,
    isKeyStored: true,
    isTrusted: true,
    hooksInvalid: false,
    language: 'typescript',
    languageOn: true,
    yieldsToCopilot: false,
    lastFailure: undefined,
    table: UI_TEXT,
    ...overrides,
  }
}

describe('tabStatusViewOf', () => {
  it('hides the item while the feature is off', () => {
    expect(tabStatusViewOf(snapshotOf({ isOn: false })).shown).toBe(false)
  })

  it('shows the spend with the tooltip naming model, requests, spend and budget', () => {
    const view = tabStatusViewOf(snapshotOf())
    expect(view.shown).toBe(true)
    expect(view.text).toContain('$(code)')
    expect(view.text).toContain('$0.12')
    expect(view.tooltip).toContain('muse-spark-1.3')
    expect(view.tooltip).toContain('$1.00')
    expect(view.backgroundWarning).toBe(false)
    expect(view.minuteTick).toBe(false)
  })

  it('says no budget in the tooltip instead of a $0.00 cap', () => {
    const view = tabStatusViewOf(snapshotOf({ budgetUsd: Usd.from(0).toAmount() }))
    expect(view.tooltip).not.toContain('$0.00')
    expect(view.tooltip).toContain('$0.12')
  })

  it('counts a timed snooze down and shows the restart sentence without a count', () => {
    const timed = tabStatusViewOf(snapshotOf({ snoozed: true, minutesLeft: 14 }))
    expect(timed.text).toContain('$(clock)')
    expect(timed.text).toContain('14')
    expect(timed.text).not.toContain('{left}')
    expect(timed.tooltip).toBe(timed.text.slice('$(clock) '.length))
    expect(timed.minuteTick).toBe(true)
    const restart = tabStatusViewOf(snapshotOf({ snoozed: true, minutesLeft: undefined }))
    expect(restart.text).toContain('Snooze Until Restart')
    expect(restart.minuteTick).toBe(false)
  })

  it('warns on the budget with the warning background', () => {
    const view = tabStatusViewOf(snapshotOf({ budgetReached: true }))
    expect(view.text).toContain('$(warning)')
    expect(view.backgroundWarning).toBe(true)
  })

  it('says no key without prompting for one', () => {
    const view = tabStatusViewOf(snapshotOf({ isKeyStored: false }))
    expect(view.text).toContain('$(circle-slash)')
    expect(view.text).toContain('no key')
    expect(view.tooltip).toBe('Tab: no key')
  })

  it('says untrusted in an untrusted workspace', () => {
    const view = tabStatusViewOf(snapshotOf({ isTrusted: false }))
    expect(view.text).toContain('untrusted')
  })

  it('names the hooks row until the configuration loads whole', () => {
    const view = tabStatusViewOf(snapshotOf({ hooksInvalid: true }))
    expect(view.text).toContain('$(error)')
    expect(view.tooltip).not.toBe(view.text)
  })

  it('names the language that is off and the Copilot yield', () => {
    const language = tabStatusViewOf(snapshotOf({ languageOn: false }))
    expect(language.text).toContain('typescript')
    expect(language.text).not.toContain('{language}')
    const copilot = tabStatusViewOf(snapshotOf({ yieldsToCopilot: true }))
    expect(copilot.text).toContain('$(code)')
    expect(copilot.text).toContain('Copilot')
  })

  it('names the last failure until a later trigger clears it', () => {
    const failed = tabStatusViewOf(snapshotOf({ lastFailure: 'request' }))
    expect(failed.text).toContain('$(error)')
    expect(failed.text).toContain('request')
    expect(failed.text).not.toContain('{kind}')
  })

  it('orders the rows: snooze over budget over key over trust over hooks over language over yield', () => {
    const snoozed = tabStatusViewOf(
      snapshotOf({ snoozed: true, minutesLeft: 1, budgetReached: true, isKeyStored: false }),
    )
    expect(snoozed.text).toContain('$(clock)')
    const budgeted = tabStatusViewOf(snapshotOf({ budgetReached: true, isKeyStored: false }))
    expect(budgeted.text).toContain('$(warning)')
    const keyless = tabStatusViewOf(snapshotOf({ isKeyStored: false, isTrusted: false }))
    expect(keyless.text).toContain('no key')
    const hooks = tabStatusViewOf(snapshotOf({ hooksInvalid: true, languageOn: false }))
    expect(hooks.text).toContain('hook file')
  })
})

describe('nextTabFailureState', () => {
  const failures: TabFailureKind[] = ['load', 'request']

  it.each(failures)('latches a %s failure until a later trigger clears it', (failure) => {
    const latched = nextTabFailureState(TAB_FAILURE_STATE_INIT, { kind: 'failed', failure })
    expect(latched.lastFailure).toBe(failure)
    const cleared = nextTabFailureState(latched, { kind: 'served', mode: 'fast' })
    expect(cleared).toEqual(TAB_FAILURE_STATE_INIT)
  })

  it('keeps the hooks row across quiet reasons that say nothing about it', () => {
    const latched = nextTabFailureState(TAB_FAILURE_STATE_INIT, {
      kind: 'quiet',
      reason: 'hooks-invalid',
    })
    expect(latched.hooksInvalid).toBe(true)
    const kept = nextTabFailureState(latched, { kind: 'quiet', reason: 'no-key' })
    expect(kept.hooksInvalid).toBe(true)
    const cleared = nextTabFailureState(latched, { kind: 'served', mode: 'fast' })
    expect(cleared.hooksInvalid).toBe(false)
  })

  it('a later invalid verdict latches the row even over a cleared failure', () => {
    const outcome: TabOutcome = { kind: 'quiet', reason: 'hooks-invalid' }
    expect(nextTabFailureState(TAB_FAILURE_STATE_INIT, outcome).hooksInvalid).toBe(true)
  })
})
