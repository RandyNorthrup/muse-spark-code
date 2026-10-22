import { describe, expect, it } from 'vitest'
import {
  CONTEXT_KEYS,
  DEFAULT_MODEL_ID,
  MACHINE_SCOPED_SETTINGS,
  PAID_FEATURES,
  PAID_FEATURE_SETTINGS,
  PROMPT_CACHE_KEY_PREFIX,
  SETTING_DEFAULTS,
  TAB_AUTOMATIC_LATENCY_CEILING_MS,
  TAB_CACHE_ENTRIES,
  TAB_CONTEXT_CHARS,
  TAB_DAILY_BUDGET_MIN_USD,
  TAB_NO_BUDGET_USD,
  TAB_DEBOUNCE_MS,
  TAB_EDIT_HOOK_QUEUE,
  TAB_FAST_MAX_LINES,
  TAB_FAST_MAX_OUTPUT_TOKENS,
  TAB_FAST_PREFIX_CHARS,
  TAB_FAST_SUFFIX_CHARS,
  TAB_FILE_MAX_BYTES,
  TAB_HOLE_MARKER,
  TAB_HOOK_TIMEOUT_MS,
  TAB_HOOK_VERDICT_CACHE,
  TAB_MAX_COMPLETION_CHARS,
  TAB_MODEL_TEXT,
  TAB_MODELS,
  TAB_MULTILINE_MAX_LINES,
  TAB_MULTILINE_MAX_OUTPUT_TOKENS,
  TAB_MULTILINE_MODES,
  TAB_MULTILINE_PREFIX_CHARS,
  TAB_MULTILINE_SUFFIX_CHARS,
  TAB_PREFIX_ANCHOR_LINES,
  TAB_PROMPT_CACHE_KEY_PREFIX,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
  TAB_SNOOZE_LONG_MINUTES,
  TAB_SNOOZE_SHORT_MINUTES,
  TAB_TRIGGER_MODES,
  TAB_WITH_COPILOT_MODES,
} from '../../src/shared/constants'

// Lane 0's contract (M94, PLAN.md D73): every constant lanes C, L, H, K and
// U need, at D73's planned values. The probe (lane P, M94 step 1) retunes
// the starred values from measured figures and updates this file with them.
describe('Tab constants (M94 lane 0, PLAN.md D73)', () => {
  it('keeps the D73 window, line and cap values', () => {
    expect(TAB_FAST_PREFIX_CHARS).toBe(6000)
    expect(TAB_FAST_SUFFIX_CHARS).toBe(1600)
    expect(TAB_MULTILINE_PREFIX_CHARS).toBe(12_000)
    expect(TAB_MULTILINE_SUFFIX_CHARS).toBe(3200)
    expect(TAB_CONTEXT_CHARS).toBe(8000)
    expect(TAB_PREFIX_ANCHOR_LINES).toBe(32)
    expect(TAB_FAST_MAX_LINES).toBe(3)
    expect(TAB_MULTILINE_MAX_LINES).toBe(16)
    expect(TAB_MAX_COMPLETION_CHARS).toBe(2000)
  })

  it('keeps the debounce and request bounds the probe retunes', () => {
    // The probe's values (docs/certification/m94.md, "Probe", 2026-10-04).
    // Acceptance 9 (D121): no count of ours paces requests — the in-flight
    // and per-minute caps are gone, and pacing is the debounce plus the
    // shared client's provider-driven pacing.
    // Acceptance 7: a sent request is never aborted — the request timeout
    // is gone with them.
    expect(TAB_DEBOUNCE_MS).toBe(350)
    expect(TAB_FAST_MAX_OUTPUT_TOKENS).toBe(608)
    expect(TAB_MULTILINE_MAX_OUTPUT_TOKENS).toBe(1536)
    expect(TAB_CACHE_ENTRIES).toBe(64)
    expect(TAB_HOOK_VERDICT_CACHE).toBe(128)
    expect(TAB_AUTOMATIC_LATENCY_CEILING_MS).toBe(1500)
  })

  it('keeps no default budget and no ceiling, with the dust floor for a set budget', () => {
    // NOLIMITS5: only a budget the person sets caps the day; 0 is no budget.
    expect(TAB_NO_BUDGET_USD).toBe(0)
    expect(SETTING_DEFAULTS.tabDailyBudgetUsd).toBe(0)
    expect(TAB_DAILY_BUDGET_MIN_USD).toBe(0.05)
    expect(TAB_FILE_MAX_BYTES).toBe(192 * 1024)
    expect(TAB_HOOK_TIMEOUT_MS).toBe(1500)
    expect(TAB_EDIT_HOOK_QUEUE).toBe(8)
    expect(TAB_SNOOZE_SHORT_MINUTES).toBe(15)
    expect(TAB_SNOOZE_LONG_MINUTES).toBe(60)
  })

  it('keeps the setting domains on their D73 values', () => {
    expect([...TAB_MODELS]).toEqual(['muse-spark-1.3', 'muse-spark-1.3-contributor'])
    expect(TAB_MODELS[0]).toBe(DEFAULT_MODEL_ID)
    expect([...TAB_MULTILINE_MODES]).toEqual(['auto', 'onInvoke', 'never'])
    expect([...TAB_TRIGGER_MODES]).toEqual(['automatic', 'onInvoke'])
    expect([...TAB_WITH_COPILOT_MODES]).toEqual(['yield', 'both'])
  })

  it('keeps Tab on its own prompt-cache prefix, never a conversation’s', () => {
    expect(TAB_PROMPT_CACHE_KEY_PREFIX).not.toBe(PROMPT_CACHE_KEY_PREFIX)
    expect(TAB_PROMPT_CACHE_KEY_PREFIX).toBe('muse-spark-tab-')
  })

  it('keeps the hole marker and the reply tags the filters look for', () => {
    expect(TAB_HOLE_MARKER).toBe('{{FILL_HERE}}')
    expect(TAB_REPLY_OPEN_TAG).toBe('<COMPLETION>')
    expect(TAB_REPLY_CLOSE_TAG).toBe('</COMPLETION>')
    expect(TAB_MODEL_TEXT.tabSystem).toContain('hole')
    expect(TAB_MODEL_TEXT.tabSystem).toContain(TAB_REPLY_OPEN_TAG)
    expect(TAB_MODEL_TEXT.tabSystem).toContain(TAB_REPLY_CLOSE_TAG)
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain(TAB_REPLY_OPEN_TAG)
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain(TAB_REPLY_CLOSE_TAG)
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain('{path}')
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain('{languageId}')
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain('{prefix}')
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain('{holeMarker}')
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain('{suffix}')
    expect(TAB_MODEL_TEXT.tabUserTemplate).toContain('{snippets}')
  })

  it('declares the tab paid feature with its setting', () => {
    expect(PAID_FEATURES).toContain('tab')
    expect(PAID_FEATURE_SETTINGS.tab).toBe('modelApiTab')
  })

  it('keeps the seven Tab settings on their decided defaults', () => {
    expect(SETTING_DEFAULTS.modelApiTab).toBe(true)
    expect(SETTING_DEFAULTS.tabModel).toBe('muse-spark-1.3')
    expect(SETTING_DEFAULTS.tabDailyBudgetUsd).toBe(TAB_NO_BUDGET_USD)
    expect(SETTING_DEFAULTS.tabLanguages).toEqual({
      '*': true,
      plaintext: false,
      markdown: false,
      scminput: false,
    })
    expect(SETTING_DEFAULTS.tabMultiline).toBe('auto')
    // The probe's latency gate: the median fast first text was over the ceiling.
    expect(SETTING_DEFAULTS.tabTrigger).toBe('onInvoke')
    expect(SETTING_DEFAULTS.tabWithCopilot).toBe('yield')
  })

  it('machine-scopes every Tab setting, so a repository cannot set what Tab spends', () => {
    for (const setting of [
      'modelApiTab',
      'tabModel',
      'tabDailyBudgetUsd',
      'tabLanguages',
      'tabMultiline',
      'tabTrigger',
      'tabWithCopilot',
    ] as const) {
      expect(MACHINE_SCOPED_SETTINGS, setting).toContain(setting)
    }
  })

  it('names the Tab context key (lane W binds Invoke under it)', () => {
    expect(CONTEXT_KEYS.tabOn).toBe('museSpark.tabOn')
  })
})
