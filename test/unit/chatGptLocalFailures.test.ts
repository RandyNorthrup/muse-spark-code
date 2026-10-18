// R7 (RVHOSTID): a local cause is never shown as "ChatGPT is temporarily
// unavailable". The real command layer, the real providers file in a real
// temp folder, the real grant lock and the real failure-text function; the
// cases below use codes and malformed wire bytes as data, never a store,
// provider or browser stand-in.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInvalidProvidersFileError } from '../../src/acp/accountText'
import { type ChatGptSignInError } from '../../src/core/providers/subscriptions/chatgpt'
import {
  createResponsesCodec,
  ResponsesDecodeError,
} from '../../src/core/backends/modelapi/codecs/responses'
import { chatGptFailureText } from '../../src/core/providers/subscriptions/registry'
import {
  chatGptCommandText,
  runtimeSubscriptionClient,
} from '../../src/runtime/chatGptProviderCommands'
import { memorySecretStoreFor } from '../../src/runtime/exec/keyInput'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { testPlanMetaClient } from './helpers/chatGptGrant'

/** What a person reads when a command ends in this failure. */
function sentence(code: ChatGptSignInError['code'], reason?: string): string {
  return chatGptFailureText(code, reason)
}

const retry = UI_TEXT.planUi.retry

describe('local causes get their own sentence', () => {
  it.each([
    ['lock-busy', undefined],
    ['cancelled', undefined],
    ['browser-unavailable', undefined],
    ['local-failed', 'EACCES'],
    ['providers-file-unreadable', 'unparseable'],
    ['providers-file-unwritable', 'io-error'],
    ['already-added', undefined],
    ['store-unavailable', undefined],
    ['lock-unavailable', 'EACCES'],
    ['grant-unreadable', undefined],
    ['registration-unreadable', undefined],
    ['host-id-unreadable', 'museSpark.provider.chatgpt.host-id'],
    ['callback-timeout', undefined],
    ['not-signed-in', undefined],
    ['model-not-added', 'chatgpt/gpt-6.1-sol'],
    ['request-failed', 'TypeError: ENOTFOUND'],
  ] as const)('%s is not the temporary-outage sentence', (code, reason) => {
    const text = sentence(code, reason)
    expect(text).not.toBe(retry)
    expect(text).not.toContain('temporarily unavailable')
    // The terminal, the ACP verify path and the plan stream read the same function.
    expect(chatGptCommandText().failure(code, reason)).toBe(text)
    if (reason !== undefined) expect(text).toContain(reason)
  })

  it('keeps the temporary-outage sentence for what is really OpenAI or the network', () => {
    expect(sentence('request-failed')).toBe(retry)
  })

  it.each([
    ['{not json', 'unparseable'],
    ['{"v":0,"providers":[]}', 'invalid'],
  ] as const)(
    'the account check and a session name an unreadable providers file (%s reads as %s) as the file’s refusal',
    async (contents, reason) => {
      const temp = path.resolve('temp')
      await mkdir(temp, { recursive: true })
      const folder = await mkdtemp(path.join(temp, 'm95b-x-providers-'))
      try {
        const configFile = path.join(folder, 'providers.json')
        await writeFile(configFile, contents, 'utf8')
        // The real product memory store, empty, as on a computer with no
        // stored grant or key: the file is the only thing left to read.
        const secrets = memorySecretStoreFor({})
        const factory = runtimeSubscriptionClient({
          secrets,
          fetch: globalThis.fetch,
          configFile,
          openBrowser: () => Promise.reject(new Error('no browser opens on this path')),
          callbackText: () => '',
        })
        const said = fill(UI_TEXT.acpChatGpt.providersFileUnreadable, { reason })
        // The account check (the ACP readiness) reads the file through the
        // configured providers; the refusal every surface checks for, with
        // its own sentence, never a store outage, a generic failure or
        // zod's words (finding 1, PR #180).
        const checked = await failureOf(factory.accountId())
        expect(isInvalidProvidersFileError(checked)).toBe(true)
        expect(checked instanceof Error ? checked.message : '').toBe(said)
        // A session reads it on its own path, beside the real Meta client.
        const meta = testPlanMetaClient(secrets)
        const session = await failureOf(factory.createClient(meta))
        expect(isInvalidProvidersFileError(session)).toBe(true)
        expect(session instanceof Error ? session.message : '').toBe(said)
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },
  )

  it('tells this app’s own refusal to build the request from what the provider streamed', async () => {
    const codec = createResponsesCodec({
      profile: 'chatgpt',
      toolNamespace: 'functions',
      toolNamespaceDescription: 'tools',
    })
    // A hosted tool the plan route cannot take: refused here, before anything is sent.
    const body: Parameters<typeof codec.encodeRequest>[0] = {
      model: 'gpt',
      input: [],
      instructions: '',
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      reasoning: { effort: 'low' },
      stream: true,
      store: false,
      include: [],
      max_output_tokens: 10,
      prompt_cache_key: 'k',
      prompt_cache_retention: 'in_memory',
    }
    const refusal = failureOfSync(() => codec.encodeRequest(body))
    expect(refusal).toBeInstanceOf(ResponsesDecodeError)
    expect(refusal instanceof ResponsesDecodeError && refusal.isLocal).toBe(true)
    // A frame the provider sent that is not JSON is the provider's, and is not local.
    const frame = new TextEncoder().encode('data: {not json\n\n')
    const garbled = await failureOf(codec.decodeStream(framesOf([frame])).next())
    expect(garbled).toBeInstanceOf(ResponsesDecodeError)
    expect(garbled instanceof ResponsesDecodeError && garbled.isLocal).toBe(false)
  })
})

/** The bytes a provider would stream, as the codec reads them. */
async function* framesOf(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  await Promise.resolve()
  for (const chunk of chunks) yield chunk
}

function failureOfSync(work: () => unknown): unknown {
  try {
    work()
  } catch (error) {
    return error
  }
  return undefined
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  return undefined
}
