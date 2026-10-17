// The subscription stream's failure boundary (D119): the estimator's own
// refusal and the typed plan failures stay their words for the agent, a
// Copilot failure stays its message, and anything else keeps its kind past
// the boundary instead of reading as the fixed retry sentence.
import { describe, expect, it } from 'vitest'
import type { ProviderClient } from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { emptyProvidersFile } from '../../src/core/providers/providersFile'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import { ChatGptSignInError } from '../../src/core/providers/subscriptions/chatgpt'
import { CopilotFailureError } from '../../src/core/providers/subscriptions/copilotFailure'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'

function body(model: string): CreateResponseBody {
  return {
    model,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    instructions: '',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'low' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 64,
    prompt_cache_key: 'pr161-subscription',
    prompt_cache_retention: 'in_memory',
  }
}

// The plan dispatch only reads the Meta client's catalogue members; the
// two-member double stands in for the rest (PLAN.md §8, PR161FIN).
const meta = { hasPaidDailyBudget: false, isPlanModel: () => false } as unknown as ProviderClient

function entry(id: string, modelId: string) {
  return {
    id,
    preset: id,
    address: id === 'chatgpt' ? 'https://api.openai.com' : 'https://github.com/copilot',
    format: id === 'chatgpt' ? 'responses' : 'chat',
    auth: 'subscription' as const,
    models: [modelId],
  }
}

function providersOf(id: string, modelId: string) {
  return () => Promise.resolve({ ...emptyProvidersFile(), providers: [entry(id, modelId)] })
}

function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  return Array.fromAsync(stream)
}

describe('subscription stream failures', () => {
  it('keeps an unknown failure’s kind past the boundary', async () => {
    const client = createSubscriptionClient(meta, {
      // No route leaves the process: the platform refuses the scheme, and
      // that real refusal must surface unchanged.
      fetch: () => fetch('about:blank'),
      providers: providersOf('chatgpt', 'gpt-5'),
      chatgpt: () => Promise.resolve({ accessToken: () => Promise.resolve('test-token') }),
      accountId: () => Promise.resolve('test-account'),
    })
    const stream = client.streamResponse(body('chatgpt/gpt-5'), new AbortController().signal)
    const events: StreamEvent[] = []
    const failure = await (async () => {
      try {
        for await (const event of stream) events.push(event)
      } catch (error: unknown) {
        return error
      }
      throw new Error('an unknown stream failure must not read as words')
    })()
    expect(failure).toBeInstanceOf(TypeError)
    expect(events).toEqual([])
  })

  it('keeps a foreign failure past the boundary', async () => {
    const client = createSubscriptionClient(meta, {
      // The foreign probe deliberately rejects with a non-Error: the
      // boundary must preserve it with its kind (PLAN.md §8, PR161FIN).
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate foreign rejection; the probe asserts it by identity.
      fetch: () => Promise.reject('plan-stream-broken'),
      providers: providersOf('chatgpt', 'gpt-5'),
      chatgpt: () => Promise.resolve({ accessToken: () => Promise.resolve('test-token') }),
      accountId: () => Promise.resolve('test-account'),
    })
    await expect(
      collect(client.streamResponse(body('chatgpt/gpt-5'), new AbortController().signal)),
    ).rejects.toBe('plan-stream-broken')
  })

  it('still yields a lapsed sign-in as its words', async () => {
    setUiText(EN, BASE_LOCALE)
    const client = createSubscriptionClient(meta, {
      fetch: () => Promise.reject(new Error('the network must not run past a lapsed sign-in')),
      providers: providersOf('chatgpt', 'gpt-5'),
      chatgpt: () =>
        Promise.resolve({ accessToken: () => Promise.reject(new ChatGptSignInError('expired')) }),
      accountId: () => Promise.resolve('test-account'),
    })
    const events = await collect(
      client.streamResponse(body('chatgpt/gpt-5'), new AbortController().signal),
    )
    expect(events).toEqual([{ type: 'error', code: 'expired', message: UI_TEXT.planUi.expired }])
  })

  it('still yields a Copilot failure as its message', async () => {
    const failure = new CopilotFailureError('copilot unavailable')
    const adapter = {
      // The adapter's stream fails with the failure before its first event.
      streamResponse: () => {
        throw failure
      },
      countInputTokens: () => Promise.resolve(0),
    }
    const client = createSubscriptionClient(meta, {
      fetch: () => Promise.reject(new Error('the adapter path must not reach the network')),
      providers: providersOf('copilot', 'gpt-4o'),
      chatgpt: () => Promise.resolve({ accessToken: () => Promise.resolve('test-token') }),
      accountId: () => Promise.resolve('test-account'),
      copilot: () => new Map([['gpt-4o', adapter]]),
    })
    const events = await collect(
      client.streamResponse(body('copilot/gpt-4o'), new AbortController().signal),
    )
    expect(events).toEqual([{ type: 'error', message: 'copilot unavailable' }])
  })
})
