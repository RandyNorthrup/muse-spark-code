// D88's bundled policy data, loaded with M95's providers bundle. Exact short
// excerpts, dates and source checks are certified in m108-policy.md. `on` is
// the owner's policy decision, not a vendor promise of unlimited capacity.
import * as z from 'zod/mini'
import { accountIdSchema } from '../../shared/accounts'
import {
  ACCOUNT_DAY_MS,
  ACCOUNT_POLICY_RECHECK_DAYS,
  ACCOUNT_POLICY_VERSION,
} from '../../shared/constants'

const sourceSchema = z.strictObject({
  quote: z.string().check(z.minLength(1)),
  url: z.url().check(z.refine((url) => new URL(url).protocol === 'https:')),
  pageDate: z.nullable(z.string().check(z.minLength(1))),
})
const rowSchema = z.strictObject({
  provider: accountIdSchema,
  product: accountIdSchema,
  multipleAccounts: z.enum(['yes', 'conditions', 'onePerPerson', 'unclear']),
  limitScopes: z
    .array(
      z.enum([
        'team',
        'organisation',
        'project',
        'account',
        'tenant',
        'global',
        'subscription',
        'unclear',
      ]),
    )
    .check(z.minLength(1)),
  pooling: z.enum(['on', 'confirm', 'notOffered']),
  // Copilot's account is selected by the editor, not held by this harness.
  isCredentialHeld: z.boolean(),
  recovery: z.enum(['none', 'chatgptPlan', 'museCodeSubscription']),
  recordVersion: z.string().check(z.minLength(1)),
  checkedAt: z.iso.date(),
  sources: z.array(sourceSchema).check(z.minLength(1)),
})
export type AccountPolicy = z.infer<typeof rowSchema>

// Every source in this record was re-read on this date. A null pageDate means
// no date was displayed; a document footer is preserved verbatim when present.
const checkedAt = '2026-10-05'
const metaTerms = 'https://dev.meta.ai/legal/terms-of-service'
const azureTerms = 'https://www.microsoft.com/licensing/terms/product/ForOnlineServices/all'
const rows = [
  {
    provider: 'meta',
    product: 'model-api',
    multipleAccounts: 'conditions',
    limitScopes: ['team'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'circumvent, violate, hack, disable, or evade rate limits',
        url: metaTerms,
        pageDate: '2026-10-02',
      },
    ],
  },
  {
    provider: 'meta',
    product: 'muse-code',
    multipleAccounts: 'unclear',
    limitScopes: ['account', 'subscription'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'museCodeSubscription',
    sources: [
      {
        quote: "circumvent your subscription's usage limits or billing",
        url: metaTerms,
        pageDate: '2026-10-02',
      },
    ],
  },
  {
    provider: 'openai',
    product: 'api',
    multipleAccounts: 'conditions',
    limitScopes: ['organisation', 'project'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'circumvent any rate limits or restrictions',
        url: 'https://cdn.openai.com/osa/openai-services-agreement.pdf',
        pageDate: 'ONLINE v.010126',
      },
    ],
  },
  {
    provider: 'openai',
    product: 'chatgpt-plan',
    multipleAccounts: 'yes',
    limitScopes: ['account'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'chatgptPlan',
    sources: [
      {
        quote: 'circumvent any rate limits or restrictions',
        url: 'https://openai.com/policies/row-terms-of-use/',
        pageDate: '2026-01-01',
      },
    ],
  },
  {
    provider: 'anthropic',
    product: 'api',
    multipleAccounts: 'unclear',
    limitScopes: ['organisation'],
    pooling: 'on',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'resell the Services except as expressly approved by Anthropic',
        url: 'https://www.anthropic.com/legal/commercial-terms',
        pageDate: '2025-06-17',
      },
    ],
  },
  {
    provider: 'anthropic',
    product: 'claude-plan',
    multipleAccounts: 'unclear',
    limitScopes: ['account'],
    pooling: 'notOffered',
    isCredentialHeld: false,
    recovery: 'none',
    sources: [
      {
        quote:
          'Anthropic does not permit third-party developers to offer Claude.ai login into their own applications',
        url: 'https://code.claude.com/docs/en/legal-and-compliance',
        pageDate: null,
      },
    ],
  },
  {
    provider: 'google',
    product: 'gemini-api',
    multipleAccounts: 'conditions',
    limitScopes: ['project'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'You agree to, and will not attempt to circumvent, such limitations documented with each API.',
        url: 'https://developers.google.com/terms',
        pageDate: '2021-11-09',
      },
    ],
  },
  {
    provider: 'google',
    product: 'vertex',
    multipleAccounts: 'conditions',
    limitScopes: ['project'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'circumvent Service-specific usage limits or quotas',
        url: 'https://cloud.google.com/terms',
        pageDate: null,
      },
    ],
  },
  {
    provider: 'google',
    product: 'consumer',
    multipleAccounts: 'unclear',
    limitScopes: ['account'],
    pooling: 'notOffered',
    isCredentialHeld: false,
    recovery: 'none',
    sources: [
      {
        quote: 'is a violation of applicable terms and policies.',
        url: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md',
        pageDate: null,
      },
    ],
  },
  {
    provider: 'github',
    product: 'copilot',
    multipleAccounts: 'conditions',
    limitScopes: ['account'],
    pooling: 'confirm',
    isCredentialHeld: false,
    recovery: 'none',
    sources: [
      {
        quote: "You may not share API tokens to exceed GitHub's rate limitations.",
        url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
        pageDate: '2026-04-27',
      },
    ],
  },
  {
    provider: 'github',
    product: 'free',
    multipleAccounts: 'onePerPerson',
    limitScopes: ['account'],
    pooling: 'confirm',
    isCredentialHeld: false,
    recovery: 'none',
    sources: [
      {
        quote: 'no more than one free Account',
        url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
        pageDate: '2026-04-27',
      },
    ],
  },
  {
    provider: 'xai',
    product: 'api',
    multipleAccounts: 'yes',
    limitScopes: ['team'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'circumventing any rate limits or restrictions',
        url: 'https://x.ai/legal/acceptable-use-policy',
        pageDate: '2026-08-14',
      },
    ],
  },
  {
    provider: 'groq',
    product: 'api',
    multipleAccounts: 'conditions',
    limitScopes: ['organisation'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'beyond published parameters, rate limits, or use limitations, including by registering multiple accounts or orchestrating usage between multiple organizations',
        url: 'https://console.groq.com/docs/legal/ai-policy',
        pageDate: '2025-10-15',
      },
    ],
  },
  {
    provider: 'mistral',
    product: 'api',
    multipleAccounts: 'conditions',
    limitScopes: ['unclear'],
    pooling: 'on',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'such Customer Affiliate must separately accept these Terms or enter into a separate Order Form with Mistral AI.',
        url: 'https://legal.mistral.ai/terms/commercial-terms-of-service',
        pageDate: '2026-09-25',
      },
    ],
  },
  {
    provider: 'mistral',
    product: 'consumer-plan',
    multipleAccounts: 'onePerPerson',
    limitScopes: ['account'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'The creation or use of multiple Mistral AI accounts by a single individual is strictly prohibited',
        url: 'https://legal.mistral.ai/terms/row-consumer-terms',
        pageDate: '2026-09-25',
      },
    ],
  },
  {
    provider: 'openrouter',
    product: 'api',
    multipleAccounts: 'onePerPerson',
    limitScopes: ['global'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'create multiple accounts as a single user, for purposes of bypassing or circumventing use limits',
        url: 'https://openrouter.ai/terms',
        pageDate: '2026-08-31',
      },
    ],
  },
  {
    provider: 'deepseek',
    product: 'api',
    multipleAccounts: 'conditions',
    limitScopes: ['account'],
    pooling: 'on',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'Do not maliciously register accounts, including but not limited to frequent or bulk registration.',
        url: 'https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html',
        pageDate: '2026-03-27',
      },
    ],
  },
  {
    provider: 'together',
    product: 'api',
    multipleAccounts: 'unclear',
    limitScopes: ['unclear'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'make calls through the API that exceed limits on the number and frequency of such calls',
        url: 'https://www.together.ai/terms-of-service',
        pageDate: '2026-05-19',
      },
    ],
  },
  {
    provider: 'fireworks',
    product: 'api',
    multipleAccounts: 'unclear',
    limitScopes: ['unclear'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'bypass any measures we may use to prevent or restrict access to the Service',
        url: 'https://cdn.sanity.io/files/pv37i0yn/production/60909f1a2f0cae74deb6ba7fc0f6eda8ab3bac4b.pdf',
        pageDate: '2026-07-10',
      },
    ],
  },
  {
    provider: 'huggingface',
    product: 'api',
    multipleAccounts: 'yes',
    limitScopes: ['unclear'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote:
          'Using tools like Cloudflare Tunnel, TOR, proxies, VNC, Chrome Remote Server, etc., to bypass restrictions.',
        url: 'https://huggingface.co/content-policy',
        pageDate: '2025-04-10',
      },
    ],
  },
  {
    provider: 'zai',
    product: 'api',
    multipleAccounts: 'unclear',
    limitScopes: ['unclear'],
    pooling: 'on',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'the platform operated by JINGSHENG HENGXING TECHNOLOGY PTE.LTD',
        url: 'https://docs.z.ai/legal-agreement/terms-of-use',
        pageDate: '2026-04-14',
      },
    ],
  },
  {
    provider: 'zai',
    product: 'coding-plan',
    multipleAccounts: 'unclear',
    limitScopes: ['account'],
    pooling: 'notOffered',
    isCredentialHeld: false,
    recovery: 'none',
    sources: [
      {
        quote: 'GLM Coding Plan may only be used within',
        url: 'https://docs.z.ai/devpack/usage-policy',
        pageDate: null,
      },
    ],
  },
  {
    provider: 'azure',
    product: 'same-tenant',
    multipleAccounts: 'yes',
    limitScopes: ['tenant', 'subscription'],
    pooling: 'on',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'With Azure OpenAI backends, implement circuit breaker rules',
        url: 'https://learn.microsoft.com/en-us/azure/api-management/backends',
        pageDate: '2026-05-20',
      },
    ],
  },
  {
    provider: 'azure',
    product: 'cross-tenant',
    multipleAccounts: 'yes',
    limitScopes: ['tenant', 'subscription'],
    pooling: 'confirm',
    isCredentialHeld: true,
    recovery: 'none',
    sources: [
      {
        quote: 'may not work around, any technical limitations in an Online Service',
        url: azureTerms,
        pageDate: null,
      },
    ],
  },
]

export const ACCOUNT_POLICIES: readonly AccountPolicy[] = rows.map((row) =>
  rowSchema.parse({ ...row, checkedAt, recordVersion: ACCOUNT_POLICY_VERSION }),
)

/** Unknown providers/products have no implicit permission to pool. */
export function accountPolicyFor(provider: string, product: string): AccountPolicy | undefined {
  return ACCOUNT_POLICIES.find((row) => row.provider === provider && row.product === product)
}

/** Invalid clocks or future check dates also fail the release review. */
export function shouldRecheckAccountPolicy(row: AccountPolicy, now: Date): boolean {
  const age = now.getTime() - Date.parse(row.checkedAt)
  return !Number.isFinite(age) || age < 0 || age > ACCOUNT_POLICY_RECHECK_DAYS * ACCOUNT_DAY_MS
}
