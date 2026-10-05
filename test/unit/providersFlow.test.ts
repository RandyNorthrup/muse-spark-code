// Lane P: the wizard flow, suggestions, scan diffs and model filters
// (M95, D74) — every step, every facet, every badge, each able to fail.

import { describe, expect, it } from 'vitest'
import {
  badgesFor,
  familyOf,
  filterModels,
  sortModels,
  type ModelRow,
} from '../../src/core/providers/modelFilters'
import { diffModelScans, isScanStale } from '../../src/core/providers/scanDiff'
import {
  isDefaultCapable,
  suggestDefaultModel,
  suggestSessionBudget,
} from '../../src/core/providers/suggest'
import {
  applyWizardEvent,
  startWizard,
  wizardBlockers,
  wizardSummary,
  type WizardState,
} from '../../src/core/providers/wizardFlow'

function selectOpenai(state: WizardState): WizardState {
  const selected = applyWizardEvent(state, {
    type: 'select-preset',
    presetId: 'openai',
    auth: 'apiKey',
  })
  return applyWizardEvent(selected, {
    type: 'edit-form',
    fields: { address: 'https://api.openai.com' },
  })
}

function row(
  overrides: Partial<ModelRow> & { ref: string; providerId: string; modelId: string },
): ModelRow {
  return {
    toolCalling: true,
    vision: false,
    reasoning: false,
    freeOrLocal: false,
    ...overrides,
  }
}

describe('wizardFlow', () => {
  it('walks every step for a keyed provider', () => {
    let state = selectOpenai(startWizard())
    state = applyWizardEvent(state, { type: 'next' })
    expect(state.step).toBe('credential')
    state = applyWizardEvent(state, { type: 'submit-key', shapeOk: true })
    state = applyWizardEvent(state, { type: 'next' })
    expect(state.step).toBe('test')
    state = applyWizardEvent(state, { type: 'test-complete', result: { ok: true, modelCount: 1 } })
    state = applyWizardEvent(state, { type: 'next' })
    expect(state.step).toBe('models')
    state = applyWizardEvent(state, { type: 'set-models', models: ['gpt-5.6-luna'] })
    state = applyWizardEvent(state, { type: 'next' })
    // Not OpenRouter: privacy is skipped.
    expect(state.step).toBe('suggestions')
    state = applyWizardEvent(state, { type: 'next' })
    expect(state.step).toBe('confirm')
    expect(wizardBlockers(state)).toEqual([])
    state = applyWizardEvent(state, { type: 'confirm' })
    expect(state.step).toBe('done')
  })

  it('skips the credential for a local server and keeps privacy for OpenRouter', () => {
    let local = applyWizardEvent(startWizard(), {
      type: 'select-preset',
      presetId: 'ollama',
      auth: 'none',
    })
    local = applyWizardEvent(local, { type: 'next' })
    expect(local.step).toBe('test')
    let router = applyWizardEvent(startWizard(), {
      type: 'select-preset',
      presetId: 'openrouter',
      auth: 'apiKey',
    })
    router = applyWizardEvent(router, { type: 'connect-oauth' })
    expect(router.error).toContain('its own step')
    router = applyWizardEvent(applyWizardEvent(router, { type: 'next' }), { type: 'connect-oauth' })
    expect(router.draft.connected).toBe(true)
    expect(router.draft.privacy).toBe('zdr')
  })

  it('goes back through the steps it came by', () => {
    let state = selectOpenai(startWizard())
    state = applyWizardEvent(state, { type: 'next' })
    state = applyWizardEvent(state, { type: 'back' })
    expect(state.step).toBe('configure')
    state = applyWizardEvent(state, { type: 'back' })
    expect(state.step).toBe('pick-provider')
  })

  it('refuses to advance past failures, and names them', () => {
    let state = selectOpenai(startWizard())
    state = applyWizardEvent(state, { type: 'next' })
    const noKey = applyWizardEvent(state, { type: 'next' })
    expect(noKey.step).toBe('credential')
    expect(noKey.error).toContain('key')
    const badShape = applyWizardEvent(state, { type: 'submit-key', shapeOk: false })
    expect(badShape.draft.keyPresent).toBe(false)
    const keyed = applyWizardEvent(state, { type: 'submit-key', shapeOk: true })
    const untested = applyWizardEvent(applyWizardEvent(keyed, { type: 'next' }), { type: 'next' })
    expect(untested.step).toBe('test')
    expect(untested.error).toContain('test')
    const failed = applyWizardEvent(untested, {
      type: 'test-complete',
      result: { ok: false, detail: '401' },
    })
    expect(failed.draft.test?.ok).toBe(false)
    expect(wizardBlockers(failed)).not.toEqual([])
  })

  it('states a paid test cost and waits for it to be accepted', () => {
    let state = applyWizardEvent(startWizard(), {
      type: 'select-preset',
      presetId: 'azure',
      auth: 'apiKey',
    })
    state = applyWizardEvent(state, {
      type: 'edit-form',
      fields: { address: 'https://x.openai.azure.com/openai/v1' },
    })
    state = applyWizardEvent(state, { type: 'next' })
    state = applyWizardEvent(state, { type: 'submit-key', shapeOk: true })
    state = applyWizardEvent(state, { type: 'next' })
    const unaccepted = applyWizardEvent(state, {
      type: 'test-complete',
      result: { ok: true, costUsd: 0.0001 },
    })
    expect(unaccepted.draft.test).toBeUndefined()
    expect(unaccepted.error).toContain('cost')
    const accepted = applyWizardEvent(applyWizardEvent(state, { type: 'accept-test-cost' }), {
      type: 'test-complete',
      result: { ok: true, costUsd: 0.0001 },
    })
    expect(accepted.draft.test?.ok).toBe(true)
  })

  it('cancels at any step with nothing saved, and summarizes the rest', () => {
    let state = selectOpenai(startWizard())
    state = applyWizardEvent(state, { type: 'cancel' })
    expect(state.cancelled).toBe(true)
    expect(wizardBlockers(state)).toEqual(['The wizard was cancelled.'])
    // A cancelled wizard takes no further event.
    expect(applyWizardEvent(state, { type: 'next' }).cancelled).toBe(true)
    const summary = wizardSummary(selectOpenai(startWizard()))
    expect(summary.origin).toBe('https://api.openai.com')
    expect(summary.lines.join('\n')).toContain('Code goes to: https://api.openai.com')
  })

  it('keeps Save disabled until the form is valid', () => {
    const fresh = wizardBlockers(startWizard())
    expect(fresh.length).toBeGreaterThan(0)
    const done = applyWizardEvent(startWizard(), { type: 'confirm' })
    expect(done.step).not.toBe('done')
  })
})

describe('suggest', () => {
  const capable = {
    ref: 'groq/openai/gpt-oss-20b',
    toolCalling: true,
    contextTokens: 131_072,
    inputUsd: 1e-7,
    outputUsd: 5e-7,
  }
  const dearer = {
    ref: 'anthropic/claude-sonnet-5-5',
    toolCalling: true,
    contextTokens: 1_000_000,
    inputUsd: 3e-6,
    outputUsd: 15e-6,
  }
  const toolLess = {
    ref: 'x/model-embed',
    toolCalling: false,
    contextTokens: 1_000_000,
    inputUsd: 1e-9,
    outputUsd: 1e-9,
  }

  it('suggests the cheapest capable model, each value with its reason', () => {
    const suggestion = suggestDefaultModel({ models: [dearer, toolLess, capable] })
    expect(suggestion?.value).toBe(capable.ref)
    expect(suggestion?.reason.trim()).not.toBe('')
    expect(suggestion?.reason).toContain(capable.ref)
    expect(isDefaultCapable(toolLess)).toBe(false)
    expect(isDefaultCapable({ ...capable, inputUsd: undefined })).toBe(false)
    expect(isDefaultCapable({ ...capable, contextTokens: 4000 })).toBe(false)
  })

  it('suggests nothing when nothing qualifies', () => {
    expect(suggestDefaultModel({ models: [toolLess] })).toBeUndefined()
    expect(suggestDefaultModel({ models: [] })).toBeUndefined()
  })

  it('remembers the last choice and prefers the recommended tie', () => {
    const recommended = { ...capable, ref: 'groq/other', recommended: true }
    const tied = suggestDefaultModel({
      models: [capable, recommended],
      lastDefaultRef: 'groq/other',
    })
    expect(tied?.value).toBe('groq/other')
    expect(tied?.reason).toContain('Recommended')
    expect(tied?.reason).toContain('last default')
  })

  it('budgets from history, else from a reference session at the default rates', () => {
    const fromHistory = suggestSessionBudget(undefined, 1.25)
    expect(fromHistory?.value.usd).toBe(1.25)
    expect(fromHistory?.reason).toContain('median')
    const card = { input: 2e-6, output: 8e-6, source: 'list' as const }
    const fallback = suggestSessionBudget(card, undefined)
    expect(fallback?.value.usd).toBeCloseTo(100_000 * 2e-6 + 10_000 * 8e-6, 12)
    expect(fallback?.reason).toContain('No history yet')
    expect(suggestSessionBudget(undefined, undefined)).toBeUndefined()
  })
})

describe('scanDiff', () => {
  const first = {
    providerId: 'openrouter',
    scannedAtMs: 1000,
    models: [
      { id: 'a', inputUsd: 1e-6, outputUsd: 2e-6 },
      { id: 'b', inputUsd: 1e-6, outputUsd: 2e-6 },
      { id: 'c', inputUsd: 1e-6, outputUsd: 2e-6 },
    ],
  }

  it('diffs a scan against the last one', () => {
    const current = {
      providerId: 'openrouter',
      scannedAtMs: 2000,
      models: [
        { id: 'a', inputUsd: 1e-6, outputUsd: 2e-6 },
        { id: 'b', inputUsd: 2e-6, outputUsd: 2e-6 },
        { id: 'd', inputUsd: 1e-6, outputUsd: 2e-6 },
      ],
    }
    const diff = diffModelScans(first, current)
    expect(diff.newIds).toEqual(['d'])
    expect(diff.removedIds).toEqual(['c'])
    expect(diff.repriced).toEqual([{ id: 'b', field: 'inputUsd', before: 1e-6, after: 2e-6 }])
    expect(diff.summary).toBe('1 new model, 1 removed model, 1 repriced model since the last scan.')
  })

  it('compares ids exactly and says when nothing changed', () => {
    const renamed = { ...first, scannedAtMs: 2000, models: [{ id: 'A' }] }
    const diff = diffModelScans(first, renamed)
    expect(diff.newIds).toEqual(['A'])
    expect(diff.removedIds).toEqual(['a', 'b', 'c'])
    expect(diffModelScans(first, { ...first, scannedAtMs: 2000 }).summary).toBe(
      'No changes since the last scan.',
    )
  })

  it('names a first scan and judges staleness', () => {
    expect(diffModelScans(undefined, first).summary).toBe('First scan: 3 models.')
    expect(isScanStale(1000, 1000 + 25 * 60 * 60 * 1000)).toBe(true)
    expect(isScanStale(1000, 1000 + 60 * 1000)).toBe(false)
    expect(isScanStale(2000, 1000)).toBe(true)
  })
})

describe('modelFilters', () => {
  const rows = [
    row({
      ref: 'openai/gpt-5.6-luna',
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      contextTokens: 400_000,
      inputPerMillion: 0.2,
      outputPerMillion: 1.2,
      recommended: true,
      description: 'Flagship reasoning model',
    }),
    row({
      ref: 'groq/openai/gpt-oss-20b',
      providerId: 'groq',
      modelId: 'openai/gpt-oss-20b',
      contextTokens: 131_072,
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      vision: true,
    }),
    row({
      ref: 'ollama/qwen3:8b',
      providerId: 'ollama',
      modelId: 'qwen3:8b',
      contextTokens: 32_768,
      freeOrLocal: true,
      reasoning: true,
      isNew: true,
    }),
    row({
      ref: 'x/embed',
      providerId: 'x',
      modelId: 'embed-1',
      toolCalling: false,
      contextTokens: 8000,
      inputPerMillion: 0.01,
      outputPerMillion: 0.01,
    }),
  ]

  it('searches by name and description', () => {
    expect(filterModels(rows, { search: 'gpt-oss' }).map((found) => found.ref)).toEqual([
      'groq/openai/gpt-oss-20b',
    ])
    expect(filterModels(rows, { search: 'flagship reasoning' }).map((found) => found.ref)).toEqual([
      'openai/gpt-5.6-luna',
    ])
    expect(filterModels(rows, { search: 'OLLAMA' }).map((found) => found.ref)).toEqual([
      'ollama/qwen3:8b',
    ])
    expect(filterModels(rows, {}).length).toBe(4)
  })

  it('applies every facet alone and combined', () => {
    expect(filterModels(rows, { toolCalling: true }).length).toBe(3)
    expect(filterModels(rows, { vision: true }).map((found) => found.ref)).toEqual([
      'groq/openai/gpt-oss-20b',
    ])
    expect(filterModels(rows, { freeOrLocal: true }).map((found) => found.ref)).toEqual([
      'ollama/qwen3:8b',
    ])
    expect(filterModels(rows, { providerId: 'openai' }).map((found) => found.ref)).toEqual([
      'openai/gpt-5.6-luna',
    ])
    expect(filterModels(rows, { family: 'gpt' }).length).toBe(2)
    expect(filterModels(rows, { family: 'qwen3' }).map((found) => found.ref)).toEqual([
      'ollama/qwen3:8b',
    ])
    expect(
      filterModels(rows, { toolCalling: true, vision: true, providerId: 'groq' }).map(
        (found) => found.ref,
      ),
    ).toEqual(['groq/openai/gpt-oss-20b'])
  })

  it('keeps range bounds inclusive', () => {
    expect(
      filterModels(rows, { contextMin: 131_072, contextMax: 131_072 }).map((found) => found.ref),
    ).toEqual(['groq/openai/gpt-oss-20b'])
    expect(filterModels(rows, { maxInputPerMillion: 0.1 }).map((found) => found.ref)).toEqual([
      'groq/openai/gpt-oss-20b',
      'x/embed',
    ])
    // Unpriced rows pass no price facet.
    expect(filterModels(rows, { maxInputPerMillion: 100 }).map((found) => found.ref)).toEqual([
      'openai/gpt-5.6-luna',
      'groq/openai/gpt-oss-20b',
      'x/embed',
    ])
  })

  it('sorts stably, with unknowns last in ascending order', () => {
    const byPrice = sortModels(rows, 'input-price').map((found) => found.ref)
    expect(byPrice).toEqual([
      'x/embed',
      'groq/openai/gpt-oss-20b',
      'openai/gpt-5.6-luna',
      'ollama/qwen3:8b',
    ])
    const byName = sortModels(rows, 'name', 'desc').map((found) => found.ref)
    expect(byName[0]).toBe('ollama/qwen3:8b')
  })

  it('awards badges by their rules', () => {
    const byRef = (ref: string): ModelRow => {
      const found = rows.find((candidate) => candidate.ref === ref)
      if (found === undefined) {
        throw new Error(`missing fixture row ${ref}`)
      }
      return found
    }
    const flagship = byRef('openai/gpt-5.6-luna')
    const oss = byRef('groq/openai/gpt-oss-20b')
    const local = byRef('ollama/qwen3:8b')
    const embed = byRef('x/embed')
    expect(badgesFor(flagship, rows)).toMatchObject({ recommended: true, largestContext: true })
    expect(badgesFor(oss, rows)).toMatchObject({ recommended: false, cheapestCapable: true })
    expect(badgesFor(local, rows)).toMatchObject({ isNew: true, cheapestCapable: false })
    // A tool-less model never wins cheapest capable, however cheap.
    expect(badgesFor(embed, rows).cheapestCapable).toBe(false)
    // A non-serverless listing (Together) never wins it either.
    const dedicated = row({
      ref: 'together/m',
      providerId: 'together',
      modelId: 'm',
      contextTokens: 200_000,
      inputPerMillion: 0.01,
      outputPerMillion: 0.01,
      serverless: false,
    })
    expect(badgesFor(dedicated, [...rows, dedicated]).cheapestCapable).toBe(false)
  })

  it('reads families off model ids', () => {
    expect(familyOf('openai/gpt-oss-20b')).toBe('gpt')
    expect(familyOf('deepseek-flash')).toBe('deepseek')
    expect(familyOf('qwen3:8b')).toBe('qwen3')
    expect(familyOf('claude-sonnet-5-5')).toBe('claude')
  })
})
