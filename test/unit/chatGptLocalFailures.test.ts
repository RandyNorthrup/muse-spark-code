// R7 (RVHOSTID): a local cause is never shown as "ChatGPT is temporarily
// unavailable". The real command layer, the real providers file in a real
// temp folder, the real grant lock and the real failure-text function; the
// only thing supplied is the OS credential store's absence (a refusing
// SecretStore is the outside world, which the OS owns) and a browser opener
// that cannot open. Every case fails when a person would be told the wrong
// thing: a retry sentence for a problem that retrying cannot fix.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ChatGptSignInError } from '../../src/core/providers/subscriptions/chatgpt'
import {
  createResponsesCodec,
  ResponsesDecodeError,
} from '../../src/core/backends/modelapi/codecs/responses'
import { chatGptFailureText } from '../../src/core/providers/subscriptions/registry'
import { createRuntimeChatGptHost } from '../../src/runtime/chatGptHost'
import {
  chatGptCommandText,
  runChatGptProviderCommand,
  runtimeChatGptCommandDeps,
} from '../../src/runtime/chatGptProviderCommands'
import { StoreUnavailableError } from '../../src/runtime/keyStore'
import { UI_TEXT } from '../../src/shared/constants'

const scratch = { folder: '' }

beforeAll(async () => {
  await mkdir(path.resolve('temp'), { recursive: true })
  scratch.folder = await mkdtemp(path.join(path.resolve('temp'), 'chatgpt-local-'))
})
afterAll(async () => {
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
})

/** A lock of this test's own, so nothing here shares a name with a real sign-in. */
function ownLock(suffix: string) {
  return { directory: scratch.folder, pipeName: `muse-spark-test-${String(process.pid)}-${suffix}` }
}

/** Runs the real `remove` command on a providers file and returns what it printed as errors; it must fail. */
async function removeWith(configFile: string, lockSuffix: string): Promise<string[]> {
  const errors: string[] = []
  const deps = runtimeChatGptCommandDeps({
    uiText: UI_TEXT,
    locale: 'en',
    secrets: signedOutStore(),
    fetch: globalThis.fetch,
    openBrowser: () => Promise.resolve(),
    callbackText: () => UI_TEXT.acpChatGpt.callback,
    configFile,
    lock: ownLock(lockSuffix),
    print: () => undefined,
    printError: (line) => {
      errors.push(line)
    },
  })
  expect(await runChatGptProviderCommand('remove', deps)).toBe(1)
  return errors
}

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
    // An output cap this app was not given is also its own: nothing the provider sent.
    const noCap = await failureOf(codec.decodeStream(framesOf([])).next())
    expect(noCap).toBeInstanceOf(ResponsesDecodeError)
    expect(noCap instanceof ResponsesDecodeError && noCap.isLocal).toBe(true)
    // A frame the provider sent that is not JSON is the provider's, and is not local.
    const frame = new TextEncoder().encode('data: {not json\n\n')
    const sent = codec.decodeStream(framesOf([frame]), {
      outputCap: { maxOutputTokens: 10, countOutputTokens: () => 0, abort: () => undefined },
    })
    const garbled = await failureOf(sent.next())
    expect(garbled).toBeInstanceOf(ResponsesDecodeError)
    expect(garbled instanceof ResponsesDecodeError && garbled.isLocal).toBe(false)
  })

  it('says a refused providers file with the reason, from a real broken file', async () => {
    const configFile = path.join(scratch.folder, 'broken', 'providers.json')
    await mkdir(path.dirname(configFile), { recursive: true })
    await writeFile(configFile, '{ this is not json')
    // `remove` reads the providers file first: the broken one is the failure.
    const errors = await removeWith(configFile, 'r')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('unparseable')
    expect(errors[0]).toContain('providers file could not be read')
    expect(errors[0]).not.toContain('temporarily unavailable')
  })

  it('says a providers file that cannot be saved, from a real unwritable path', async () => {
    // The file's "folder" is an existing regular file, so no folder can be made there.
    const blocker = path.join(scratch.folder, 'blocker')
    await writeFile(blocker, 'a regular file, not a folder')
    const errors = await removeWith(path.join(blocker, 'providers.json'), 'w')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('could not be saved')
    expect(errors[0]).toContain('io-error')
    expect(errors[0]).not.toContain('temporarily unavailable')
  })

  it('says a browser that cannot open, from the real host', async () => {
    const host = await createRuntimeChatGptHost({
      secrets: signedOutStore(),
      fetch: globalThis.fetch,
      openBrowser: () => Promise.reject(new Error('no display')),
      callbackText: () => UI_TEXT.acpChatGpt.callback,
      lock: ownLock('b'),
    })
    const failure = await failureOf(host.openBrowser('https://auth.openai.com/x'))
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect(failure instanceof ChatGptSignInError ? failure.code : '').toBe('browser-unavailable')
    // The editor's own message is never carried.
    expect(failure instanceof Error ? failure.message : '').not.toContain('no display')
  })

  it('says a credential store that refuses, from the real host', async () => {
    const refusing = {
      get: () => Promise.reject(new StoreUnavailableError()),
      store: () => Promise.reject(new StoreUnavailableError()),
      delete: () => Promise.reject(new StoreUnavailableError()),
    }
    const failure = await failureOf(
      createRuntimeChatGptHost({
        secrets: refusing,
        fetch: globalThis.fetch,
        openBrowser: () => Promise.resolve(),
        callbackText: () => UI_TEXT.acpChatGpt.callback,
        lock: ownLock('s'),
      }),
    )
    expect(failure instanceof ChatGptSignInError ? failure.code : '').toBe('store-unavailable')
  })
})

/** The OS credential store with nothing stored: the outside world, here an empty one. */
function signedOutStore() {
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
