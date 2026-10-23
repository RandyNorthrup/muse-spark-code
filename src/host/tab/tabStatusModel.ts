// Tab's status bar content (M94, PLAN.md D73): the pure state-to-text
// model behind the bar, naming each state D73 names (on, snoozed, budget
// reached, no key, untrusted, the language off, on Invoke for Copilot,
// the last failure's class). The vscode-bound item lives beside it in
// tabStatusItem.ts and only applies the view. Pure: no `vscode` import.

import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { UiText } from '../../shared/l10n/en'
import { isPositiveUsd, type UsdAmount } from '../../shared/usd'
import type { TabFailureKind, TabOutcome, TabQuietReason } from './tabBundle'

/** Every state the bar reads, resolved by the item before the model runs. */
export interface TabStatusSnapshot {
  readonly isOn: boolean
  readonly totalUsd: UsdAmount
  readonly requests: number
  readonly budgetUsd: UsdAmount
  readonly model: string
  readonly snoozed: boolean
  readonly minutesLeft: number | undefined
  readonly budgetReached: boolean
  readonly isKeyStored: boolean
  readonly isTrusted: boolean
  readonly hooksInvalid: boolean
  readonly language: string | undefined
  readonly languageOn: boolean
  readonly yieldsToCopilot: boolean
  readonly lastFailure: TabFailureKind | undefined
  readonly table: UiText
}

/** What the bar shows for the snapshot. */
export interface TabStatusView {
  /** False hides the item (the feature is off). */
  readonly shown: boolean
  readonly text: string
  readonly tooltip: string
  /** True paints the warning background (the budget is reached). */
  readonly backgroundWarning: boolean
  /** True redraws in a minute (a timed snooze counts down). */
  readonly minuteTick: boolean
}

/**
The reasons a trigger stops at before the hook configuration is read: they
say nothing about it, so they leave its status as it was.
*/
const TAB_REASONS_BEFORE_HOOKS: ReadonlySet<TabQuietReason> = new Set([
  'suggest-selection',
  'trigger-setting',
  'snoozed',
  'no-key',
  'paid-off',
  'untrusted',
  'scheme',
  'outside-workspace',
  'language-off',
  'copilot',
])

/** The bar's latched outcome state: the last failure and the hooks row. */
export interface TabFailureState {
  readonly lastFailure: TabFailureKind | undefined
  readonly hooksInvalid: boolean
}

/** The empty latch: no failure shown, the hooks row off. */
export const TAB_FAILURE_STATE_INIT: TabFailureState = {
  lastFailure: undefined,
  hooksInvalid: false,
}

/**
Folds one provider outcome into the latch: a failure shows until a later
trigger clears it (quiet states have their own rows), and a hook file
that did not load whole shows until a trigger finds it loads.
*/
export function nextTabFailureState(state: TabFailureState, outcome: TabOutcome): TabFailureState {
  const lastFailure = outcome.kind === 'failed' ? outcome.failure : undefined
  if (outcome.kind === 'quiet' && TAB_REASONS_BEFORE_HOOKS.has(outcome.reason)) {
    return { lastFailure, hooksInvalid: state.hooksInvalid }
  }
  return {
    lastFailure,
    hooksInvalid: outcome.kind === 'quiet' && outcome.reason === 'hooks-invalid',
  }
}

/** The bar's text, tooltip and background for the resolved snapshot. */
export function tabStatusViewOf(snapshot: TabStatusSnapshot): TabStatusView {
  if (!snapshot.isOn) {
    return { shown: false, text: '', tooltip: '', backgroundWarning: false, minuteTick: false }
  }
  const table = snapshot.table
  const spendText = formatUsd(snapshot.totalUsd, 2)
  // 0 is no budget: the tooltip says so instead of naming a $0.00 cap.
  const tooltip = isPositiveUsd(snapshot.budgetUsd)
    ? fill(table.tabStatusTooltip, {
        model: snapshot.model,
        requests: snapshot.requests,
        spend: spendText,
        budget: formatUsd(snapshot.budgetUsd, 2),
      })
    : fill(table.tabStatusTooltipNoBudget, {
        model: snapshot.model,
        requests: snapshot.requests,
        spend: spendText,
      })
  if (snapshot.snoozed) {
    const snoozedText =
      snapshot.minutesLeft === undefined
        ? table.tabMenuSnoozeRestart
        : fill(table.tabStatusSnoozed, { left: snapshot.minutesLeft })
    return {
      shown: true,
      text: `$(clock) ${snoozedText}`,
      // The filled sentence, never the template (RVM94HU 26).
      tooltip: snoozedText,
      backgroundWarning: false,
      minuteTick: snapshot.minutesLeft !== undefined,
    }
  }
  if (snapshot.budgetReached) {
    return {
      shown: true,
      text: `$(warning) ${table.tabStatusBudget}`,
      tooltip,
      backgroundWarning: true,
      minuteTick: false,
    }
  }
  if (!snapshot.isKeyStored) {
    // No key: the bar says so and Tab never prompts for one (Acceptance 2).
    return {
      shown: true,
      text: `$(circle-slash) ${table.tabStatusNoKey}`,
      tooltip: table.tabStatusNoKey,
      backgroundWarning: false,
      minuteTick: false,
    }
  }
  if (snapshot.isTrusted) {
    if (snapshot.hooksInvalid) {
      return {
        shown: true,
        text: `$(error) ${table.tabStatusHooksInvalid}`,
        tooltip: table.tabStatusHooksInvalidDetail,
        backgroundWarning: false,
        minuteTick: false,
      }
    }
    if (snapshot.language !== undefined && !snapshot.languageOn) {
      return {
        shown: true,
        text: `$(circle-slash) ${fill(table.tabStatusLanguageOff, { language: snapshot.language })}`,
        tooltip: fill(table.tabStatusLanguageOff, { language: snapshot.language }),
        backgroundWarning: false,
        minuteTick: false,
      }
    }
    if (snapshot.yieldsToCopilot) {
      return {
        shown: true,
        text: `$(code) ${table.tabStatusCopilot}`,
        tooltip: table.tabStatusCopilot,
        backgroundWarning: false,
        minuteTick: false,
      }
    }
    if (snapshot.lastFailure === undefined) {
      return {
        shown: true,
        text: `$(code) ${fill(table.tabStatusSpend, { spend: spendText })}`,
        tooltip,
        backgroundWarning: false,
        minuteTick: false,
      }
    }
    return {
      shown: true,
      text: `$(error) ${fill(table.tabStatusError, { kind: snapshot.lastFailure })}`,
      tooltip: fill(table.tabStatusError, { kind: snapshot.lastFailure }),
      backgroundWarning: false,
      minuteTick: false,
    }
  }
  return {
    shown: true,
    text: `$(circle-slash) ${table.tabStatusUntrusted}`,
    tooltip: table.tabStatusUntrusted,
    backgroundWarning: false,
    minuteTick: false,
  }
}
