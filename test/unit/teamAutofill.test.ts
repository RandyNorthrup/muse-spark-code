import { Usd } from '../../src/shared/usd'
// Adaptive autofill (M96 lane F): each rule fires with its reason, and
// a dismissal holds.

import { describe, expect, it } from 'vitest'
import {
  budgetShareFor,
  buildTeamSuggestions,
  dismissTeamSuggestion,
  TEAM_LEARNED_MIN_TASKS,
  typicalTokensFor,
  typicalUseFor,
  type TeamAutofillContext,
  type TeamDismissalStore,
  type TeamSuggestionKind,
  type TeamSuggestionModel,
} from '../../src/core/team/autofill'
import { buildTemplateDraft, type TeamCapDraft } from '../../src/core/team/templates'

const META: TeamSuggestionModel = {
  modelRef: 'muse-spark-1.3',
  vendor: 'meta',
  usdPerMTokInput: 3,
  free: false,
}
const CODEX: TeamSuggestionModel = {
  modelRef: 'codex-cli',
  vendor: 'openai',
  usdPerMTokInput: 5,
  free: false,
}
const LOCAL: TeamSuggestionModel = {
  modelRef: 'ollama-qwen',
  vendor: 'ollama',
  usdPerMTokInput: undefined,
  free: true,
}

function store(): TeamDismissalStore {
  const dismissed = new Set<string>()
  return {
    isDismissed: (role, kind) => dismissed.has(`${role}:${kind}`),
    dismiss: (role, kind) => {
      dismissed.add(`${role}:${kind}`)
    },
  }
}

function context(
  models: readonly TeamSuggestionModel[],
  dismissals: TeamDismissalStore,
  isCapable: (modelRef: string) => boolean = () => true,
): TeamAutofillContext {
  return {
    draft: buildTemplateDraft('pair', [
      { modelRef: 'muse-spark-1.3', vendor: 'meta', payKind: 'key' },
      { modelRef: 'codex-cli', vendor: 'openai', payKind: 'subscription' },
    ]),
    models,
    records: [],
    dismissals,
    isCapable,
    remainingDailyBudgetUsd: Usd.from(50).toAmount(),
  }
}

function fullContext(
  models: readonly TeamSuggestionModel[],
  isCapable: (modelRef: string) => boolean = () => true,
): TeamAutofillContext {
  return {
    ...context(models, store(), isCapable),
    draft: buildTemplateDraft('full', [
      { modelRef: 'muse-spark-1.3', vendor: 'meta', payKind: 'key' },
    ]),
  }
}

describe('review on another vendor', () => {
  it('suggests the other-vendor model for code-review with its reason', () => {
    const suggestions = buildTeamSuggestions(context([META, LOCAL], store()))
    const review = suggestions.find((suggestion) => suggestion.kind === 'reviewVendor')
    expect(review?.modelRef).toBe('ollama-qwen')
    expect(review?.reason).toContain('ollama-qwen')
    expect(review?.reason).toContain('ollama')
  })

  it('stays silent when every offer shares engineering vendor', () => {
    const sameVendor: TeamSuggestionModel = { ...LOCAL, vendor: 'meta' }
    const suggestions = buildTeamSuggestions(context([META, sameVendor], store()))
    expect(suggestions.some((suggestion) => suggestion.kind === 'reviewVendor')).toBe(false)
  })

  it('stays silent with no review role, a dismissal, or an empty pool', () => {
    const solo: TeamAutofillContext = {
      ...context([META, LOCAL], store()),
      draft: buildTemplateDraft('solo', []),
    }
    expect(
      buildTeamSuggestions(solo).some((suggestion) => suggestion.kind === 'reviewVendor'),
    ).toBe(false)
    const dismissed = store()
    dismissed.dismiss('code-review', 'reviewVendor')
    expect(
      buildTeamSuggestions(context([META, LOCAL], dismissed)).some(
        (suggestion) => suggestion.kind === 'reviewVendor',
      ),
    ).toBe(false)
    const emptyPool: TeamAutofillContext = {
      ...context([META, LOCAL], store()),
      draft: buildTemplateDraft('pair', []),
    }
    expect(
      buildTeamSuggestions(emptyPool).some((suggestion) => suggestion.kind === 'reviewVendor'),
    ).toBe(false)
  })
})

describe('cheapest capable and fallback', () => {
  it('names the free local model for research and docs', () => {
    const suggestions = buildTeamSuggestions(fullContext([META, CODEX, LOCAL]))
    const research = suggestions.find(
      (suggestion) => suggestion.kind === 'roleModel' && suggestion.role === 'research',
    )
    expect(research?.modelRef).toBe('ollama-qwen')
  })

  it('warns about single-entry pools with a second entry', () => {
    const suggestions = buildTeamSuggestions(context([META, CODEX], store()))
    const fallback = suggestions.find((suggestion) => suggestion.kind === 'poolFallback')
    expect(fallback?.modelRef).toBe('codex-cli')
    expect(fallback?.reason).toContain('codex-cli')
  })

  it('falls back to the cheapest priced model when nothing is free', () => {
    const suggestions = buildTeamSuggestions(fullContext([META, CODEX]))
    const research = suggestions.find(
      (suggestion) => suggestion.kind === 'roleModel' && suggestion.role === 'research',
    )
    expect(research?.modelRef).toBe('muse-spark-1.3')
  })

  it('suggests no model when nothing passes the capability check', () => {
    const suggestions = buildTeamSuggestions(fullContext([META, LOCAL], () => false))
    expect(suggestions.some((suggestion) => suggestion.kind === 'roleModel')).toBe(false)
  })

  it('sorts an unpriced model last', () => {
    const unpriced: TeamSuggestionModel = {
      modelRef: 'mystery-model',
      vendor: 'mystery',
      usdPerMTokInput: undefined,
      free: false,
    }
    const suggestions = buildTeamSuggestions(fullContext([unpriced, META]))
    const research = suggestions.find(
      (suggestion) => suggestion.kind === 'roleModel' && suggestion.role === 'research',
    )
    expect(research?.modelRef).toBe('muse-spark-1.3')
  })

  it('skips models the capability check refuses', () => {
    const suggestions = buildTeamSuggestions(
      context([META, LOCAL], store(), (modelRef) => modelRef !== 'ollama-qwen'),
    )
    expect(
      suggestions.some(
        (suggestion) => suggestion.modelRef === 'ollama-qwen' && suggestion.kind === 'roleModel',
      ),
    ).toBe(false)
  })
})

describe('budget caps and learning', () => {
  it('changes actual budget suggestions using five-task local medians', () => {
    const ctx = context([META, CODEX], store())
    const budgets = (records: TeamAutofillContext['records']) =>
      buildTeamSuggestions({ ...ctx, records }).filter(
        (suggestion) => suggestion.kind === 'roleBudget',
      )
    const before = budgets([])
    const records = [
      { role: 'engineering', taskTokens: [10_000, 10_000, 10_000, 10_000, 10_000] },
      { role: 'code-review', taskTokens: [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000] },
    ]
    const learned = budgets(records)
    expect(learned).not.toEqual(before)
    expect(learned.find((suggestion) => suggestion.role === 'engineering')?.amount).toBe(0.49)
    expect(learned.find((suggestion) => suggestion.role === 'code-review')?.amount).toBe(49.5)
    expect(
      learned.reduce((sum, suggestion) => sum + (suggestion.amount ?? 0), 0),
    ).toBeLessThanOrEqual(50)
    expect(
      budgets(records.map((record) => ({ ...record, taskTokens: record.taskTokens.slice(1) }))),
    ).toEqual(before)
    expect(records[0]?.taskTokens).toHaveLength(5)
  })

  it('suggests day caps from the remaining budget, split by typical use', () => {
    const suggestions = buildTeamSuggestions(context([META, CODEX], store()))
    const budgets = suggestions.filter((suggestion) => suggestion.kind === 'roleBudget')
    expect(budgets.length).toBeGreaterThan(0)
    const total = budgets.reduce((sum, suggestion) => sum + (suggestion.amount ?? 0), 0)
    expect(total).toBeLessThanOrEqual(50)
    const engineering = budgets.find((suggestion) => suggestion.role === 'engineering')
    const review = budgets.find((suggestion) => suggestion.role === 'code-review')
    expect((engineering?.amount ?? 0) / (review?.amount ?? 1)).toBeCloseTo(400_000 / 120_000, 2)
  })

  it('medians an even record', () => {
    expect(
      typicalUseFor('engineering', [
        { role: 'engineering', taskTokens: [300_000, 310_000, 320_000, 330_000, 340_000, 350_000] },
      ]),
    ).toEqual({ tokens: 325_000, learned: true })
  })

  it('suggests no budget cap when nothing remains or one is set', () => {
    const empty = buildTeamSuggestions({
      ...context([META], store()),
      remainingDailyBudgetUsd: Usd.from(0).toAmount(),
    })
    expect(empty.some((suggestion) => suggestion.kind === 'roleBudget')).toBe(false)
    const draft = buildTemplateDraft('pair', [
      { modelRef: 'muse-spark-1.3', vendor: 'meta', payKind: 'key' },
    ])
    const dayCap: TeamCapDraft = { measure: 'spendUsd', window: 'day', amount: 5 }
    const capped = {
      ...draft,
      roles: draft.roles.map((role) =>
        role.role === 'engineering'
          ? {
              ...role,
              pool: role.pool.map((entry) => ({ ...entry, caps: [...entry.caps, dayCap] })),
            }
          : role,
      ),
    }
    const suggestions = buildTeamSuggestions({ ...context([META], store()), draft: capped })
    expect(
      suggestions.some(
        (suggestion) => suggestion.kind === 'roleBudget' && suggestion.role === 'engineering',
      ),
    ).toBe(false)
    expect(
      suggestions.some(
        (suggestion) => suggestion.kind === 'roleBudget' && suggestion.role === 'code-review',
      ),
    ).toBe(true)
  })

  it('follows the record once a role has five tasks', () => {
    expect(TEAM_LEARNED_MIN_TASKS).toBe(5)
    expect(typicalUseFor('engineering', [])).toEqual({ tokens: 400_000, learned: false })
    expect(
      typicalUseFor('engineering', [{ role: 'engineering', taskTokens: [1, 2, 3, 4] }]),
    ).toEqual({ tokens: 400_000, learned: false })
    expect(
      typicalUseFor('engineering', [
        { role: 'engineering', taskTokens: [300_000, 310_000, 320_000, 330_000, 340_000] },
      ]),
    ).toEqual({ tokens: 320_000, learned: true })
  })

  it('reads unknown roles as engineering', () => {
    expect(typicalTokensFor('custom-role')).toBe(400_000)
  })

  it('shares the budget by typical use', () => {
    expect(budgetShareFor('engineering', ['engineering', 'code-review'])).toBeCloseTo(
      400_000 / 520_000,
      10,
    )
    expect(budgetShareFor('engineering', [])).toBe(0)
  })
})

describe('dismissals', () => {
  it('a dismissal holds for that role', () => {
    const dismissals = store()
    const before = buildTeamSuggestions(context([META, CODEX], dismissals))
    expect(before.some((suggestion) => suggestion.kind === 'poolFallback')).toBe(true)
    dismissTeamSuggestion(dismissals, 'engineering', 'poolFallback')
    const kinds = new Map<string, TeamSuggestionKind[]>()
    const after = buildTeamSuggestions(context([META, CODEX], dismissals))
    for (const suggestion of after) {
      kinds.set(suggestion.role, [...(kinds.get(suggestion.role) ?? []), suggestion.kind])
    }
    expect(kinds.get('engineering') ?? []).not.toContain('poolFallback')
    dismissTeamSuggestion(dismissals, 'code-review', 'roleBudget')
    const budgets = buildTeamSuggestions(context([META, CODEX], dismissals)).filter(
      (suggestion) => suggestion.kind === 'roleBudget' && suggestion.role === 'code-review',
    )
    expect(budgets).toEqual([])
    const other = buildTeamSuggestions(context([META, CODEX], dismissals)).find(
      (suggestion) => suggestion.kind === 'poolFallback' && suggestion.role === 'code-review',
    )
    expect(other).toBeDefined()
  })
})
