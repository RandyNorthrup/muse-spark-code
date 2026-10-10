import { usdInputSchema } from '../../../../src/shared/usdSchema'
import { accountPolicyFor } from '../../../../src/core/providers/accountPolicy'
import type {
  AccountsPolicyQuestion,
  ModelsAccountsSlice,
} from '../../../../src/shared/modelsPanel'
import type { AccountPolicy } from '../../../../src/core/providers/accountPolicy'

export function panelPolicy(): AccountPolicy {
  const row = accountPolicyFor('openai', 'api')
  if (row === undefined) throw new Error('missing bundled policy')
  return structuredClone(row)
}
export function panelQuestion(policy = panelSlice().policy!): AccountsPolicyQuestion {
  return {
    questionId: 'b34b2481-c87a-4d45-8f0a-5208c261ad75',
    providerGeneration: 1,
    policy,
  }
}
export function panelSlice(overrides: Partial<ModelsAccountsSlice> = {}): ModelsAccountsSlice {
  const row = panelPolicy()
  const { limitScopes: _limitScopes, ...policy } = row
  return {
    provider: 'openai',
    providerLabel: 'OpenAI',
    accounts: [
      {
        id: 'work',
        label: 'Work',
        order: 0,
        thresholds: { spendUsd: { day: usdInputSchema.parse('0.3') }, requests: { day: 2 } },
      },
      { id: 'personal', label: 'Personal', order: 1, limitGroup: 'team', thresholds: {} },
    ],
    currentAccount: 'work',
    isSwapOn: true,
    isParallelOn: true,
    policy: { ...policy, isStale: false },
    confirmation: null,
    usageUrl: 'https://provider.invalid/usage',
    planWindows: [],
    hasRateHeadroom: false,
    ...overrides,
  }
}
