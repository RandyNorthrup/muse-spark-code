// A host without the Copilot dispatch adapter names where the grant lives.
// The adapter is VS Code's Language Model API
// (src/host/providers/copilotClient.ts), injected only by editor hosts, so
// the terminal and headless hosts never have one. Real registry, real file,
// real refusal text; the Meta client is never reached on this path.
import { describe, expect, it } from 'vitest'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import { providersFileSchema } from '../../src/core/providers/providersFile'
import type { ProviderClient } from '../../src/core/backends/modelapi/client'
import { UI_TEXT } from '../../src/shared/constants'

const MODEL = 'copilot/gpt-4o'

function unreachable(seam: string): never {
  throw new Error(`must not touch ${seam} on the Copilot path`)
}

function client(): ProviderClient {
  // The shape subscriptionFeatures.save writes for a Copilot entry.
  const file = providersFileSchema.parse({
    v: 1,
    providers: [
      {
        id: 'copilot',
        preset: 'copilot',
        address: 'https://github.com/copilot',
        format: 'chat',
        auth: 'subscription',
        models: ['gpt-4o'],
      },
    ],
  })
  // Structural only: the Copilot branch throws before any Meta member runs,
  // so an invoked member fails this test instead of answering.
  const meta = {} as ProviderClient
  return createSubscriptionClient(meta, {
    fetch: globalThis.fetch,
    providers: () => Promise.resolve(file),
    chatgpt: () => unreachable('the ChatGPT grant'),
    accountId: () => unreachable('the account'),
  })
}

describe('Copilot without its dispatch adapter', () => {
  it('refuses a Copilot token count with the VS Code grant sentence', async () => {
    await expect(
      client().countInputTokens({
        model: MODEL,
        input: [],
        instructions: '',
        tools: [],
        tool_choice: 'auto',
        reasoning: { effort: 'low' },
        store: false,
        include: [],
        max_output_tokens: 16,
        prompt_cache_key: 'test',
        prompt_cache_retention: 'in_memory',
      }),
    ).rejects.toThrow(UI_TEXT.planUi.copilotHostGrant)
  })

  it('reports a Copilot stream with the VS Code grant sentence', async () => {
    // The stream path yields the refusal as an error event; the token-count
    // path throws it. Both carry the same grant sentence.
    const stream = client().streamResponse(
      {
        model: MODEL,
        input: [],
        instructions: '',
        tools: [],
        tool_choice: 'auto',
        reasoning: { effort: 'low' },
        stream: true,
        store: false,
        include: [],
        max_output_tokens: 16,
        prompt_cache_key: 'test',
        prompt_cache_retention: 'in_memory',
      },
      new AbortController().signal,
    )
    await expect(Array.fromAsync(stream)).resolves.toEqual([
      { type: 'error', message: UI_TEXT.planUi.copilotHostGrant },
    ])
  })
})
