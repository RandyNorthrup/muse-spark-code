// A ChatGPT grant record for tests that drive the real sign-in and command
// layers: every field is a placeholder shaped like the product's own write
// (`ChatGptSignIn.signIn` in `src/core/providers/subscriptions/chatgpt.ts`),
// unexpired so `accessToken` returns without refresh, and carrying the
// verified account hash the `add-new-account` verifier compares.
import { setTimeout as delay } from 'node:timers/promises'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'
import type { ChatGptRecord } from '../../../src/core/providers/subscriptions/chatgpt'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import { stderrLogger } from '../../../src/runtime/stderrLog'
import {
  CREDENTIAL_RECORD_VERSION,
  MODEL_API_BASE_URL,
  SECRET_KEYS,
} from '../../../src/shared/constants'

/** A writable in-memory `SecretStore`, the shape `credentialStore.ts` names for tests. */
export function testSecretStore(): SecretStore {
  const held = new Map<string, string>()
  return {
    get: (key: string) => Promise.resolve(held.get(key)),
    store: (key: string, value: string) => {
      held.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      held.delete(key)
      return Promise.resolve()
    },
  }
}

/**
 * A real plan-route request body in the captured shape the Responses codec
 * test pins (`test/unit/chatgptResponsesCodec.test.ts`, owner capture
 * 2026-10-05): the same values, with only the model swapped, so a request
 * the plan endpoint would take is built without restating it per test.
 */
export function testPlanStreamBody(model: string): CreateResponseBody {
  return {
    model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'What time is it?' }],
      },
    ],
    instructions: 'Use the time tool.',
    tools: [
      {
        type: 'function',
        name: 'get_time',
        description: 'Get the time in a timezone.',
        parameters: {
          type: 'object',
          properties: { timezone: { type: 'string' } },
          required: ['timezone'],
          additionalProperties: false,
        },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 512,
    prompt_cache_key: 'm95b-capture',
    prompt_cache_retention: 'in_memory',
  }
}

/** The real Meta client beside the plan path, as the account-check tests build it. */
export function testPlanMetaClient(secrets: SecretStore): ModelApiClient {
  return new ModelApiClient({
    fetch: globalThis.fetch,
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(secrets.get(SECRET_KEYS.modelApiKey)),
    sleep: (ms) => delay(ms),
    now: Date.now,
    random: Math.random,
    log: stderrLogger((line) => process.stderr.write(`${line}\n`), 'warn'),
  })
}

/** An unexpired grant for one account hash (64 hex characters). */
export function testGrantRecord(accountIdHash: string): ChatGptRecord {
  return {
    v: CREDENTIAL_RECORD_VERSION,
    auth: 'subscription',
    origin: 'https://api.openai.com',
    issuer: 'https://auth.openai.com',
    clientId: 'oaiapp_test',
    hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    accountIdHash,
    accessToken: 'at_test',
    refreshToken: 'rt_test',
    expiresAt: Date.now() + 3_600_000,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    nonce: 'nonce_test',
  }
}
