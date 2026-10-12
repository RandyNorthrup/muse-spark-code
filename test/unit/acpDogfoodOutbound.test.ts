import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { RequestError } from '@agentclientprotocol/sdk'
import { MspError } from '@muse-code/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { DeadlineError } from '../../src/core/timeouts'
import { MissingApiKeyError, ModelApiError } from '../../src/core/backends/modelapi/transport'
import { ResourceReadingError } from '../../src/runtime/resources/text'
import { StoreUnavailableError } from '../../src/runtime/keyStore'
import { ACP_ERROR_CODES, UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { dogfoodAgentDeps, dogfoodSession, dogfoodPrompt } from './helpers/acpDogfood'

// R1: one outbound error shape, built from an allow-list. Every error class
// in the failure-boundary inventory is planted with a prompt text, an image
// blob and a synthetic key in its message, data, kind, code and cause: none
// of the three may appear in the serialised reply or in any log line.
const SENTINEL_TEXT = 'sentinel prompt text 7f3a'
const SENTINEL_BLOB =
  'iVBORw0KGgo7f3aQUFBQU5TVWhFVWdBQUFCRUFBQVlBQUFBQm1sU0k2QUFBQURNb0xQSXl3QUFBQUFBRWxCU1U1RXdBQUFBQm1sU0k2UVFBQUFBRWxCU1U1RXdBQUFBQm1sU0k2'
const SENTINEL_KEY = 'synthetic-key-7f3a-9d2c-not-a-credential'

const cwd = path.resolve('/work/app')

function scene() {
  const host = new FakeAgentHost()
  const session = new FakeAgentSession('session', host.models[0]?.modelId ?? '')
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  host.startSession.mockResolvedValue(session)
  const deps: AcpAgentDeps = {
    ...dogfoodAgentDeps(host, log),
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    defaultCwd: cwd,
    questions: 'decline',
  }
  const agent = createAcpAgent(deps)
  const client = acp.client({ name: 'outbound' })
  return {
    host,
    session,
    log,
    run: <T>(work: (client: acp.ClientContext) => Promise<T>) => client.connectWith(agent, work),
  }
}

function expectClean(failure: unknown, logs: ReturnType<typeof scene>['log']) {
  // `JSON.stringify` skips `Error.message` (non-enumerable), but the wire
  // reply carries it: read the rehydrated message and data directly, plus
  // every log line.
  const message = failure instanceof Error ? failure.message : String(failure)
  const data = failure instanceof RequestError ? failure.data : undefined
  const haystacks = [
    message,
    JSON.stringify(data ?? null),
    JSON.stringify(logs.error.mock.calls),
    JSON.stringify(logs.warn.mock.calls),
  ]
  for (const sentinel of [SENTINEL_TEXT, SENTINEL_BLOB, SENTINEL_KEY]) {
    for (const haystack of haystacks) expect(haystack).not.toContain(sentinel)
  }
}

/** The client's rejection for work that must fail, thrown when it succeeds. */
async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error: unknown) {
    return error
  }
  throw new Error('the prompt should have failed')
}

async function promptFailure(error: unknown) {
  const h = scene()
  h.session.sendTurn.mockRejectedValueOnce(error)
  const failure = await h.run(async (client) => {
    const { sessionId } = await dogfoodSession(client, cwd)
    return await rejectionOf(
      client.request('session/prompt', {
        sessionId,
        // The prompt itself carries the text sentinel; the blob and the key
        // travel only inside the planted failure below.
        prompt: [{ type: 'text', text: SENTINEL_TEXT }],
      }),
    )
  })
  return { h, failure }
}

describe('ACPDOG one outbound error shape (R1)', () => {
  it('withholds sentinels planted in a typed RequestError message and data', async () => {
    const planted = new RequestError(
      ACP_ERROR_CODES.turnFailed,
      `turn failed: ${SENTINEL_TEXT} ${SENTINEL_BLOB}`,
      { kind: SENTINEL_TEXT, blob: SENTINEL_BLOB, key: SENTINEL_KEY },
    )
    const { h, failure } = await promptFailure(planted)
    expect(failure).toMatchObject({ code: ACP_ERROR_CODES.turnFailed })
    expectClean(failure, h.log)
    // The rebuilt data keeps only vocabulary values.
    expect(failure).toMatchObject({ data: { kind: 'turn_failed' } })
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('maps an unknown RequestError code to the generic member', async () => {
    const planted = new RequestError(99_999, `foreign ${SENTINEL_TEXT}`, { kind: SENTINEL_TEXT })
    const { h, failure } = await promptFailure(planted)
    expect(failure).toMatchObject({
      code: ACP_ERROR_CODES.internal,
      message: UI_TEXT.actionFailed,
      data: { kind: 'internal' },
    })
    expectClean(failure, h.log)
  })

  it('withholds sentinels planted in a DeadlineError message', async () => {
    const { h, failure } = await promptFailure(
      new DeadlineError(`no answer for ${SENTINEL_TEXT} ${SENTINEL_BLOB} ${SENTINEL_KEY}`),
    )
    expect(failure).toMatchObject({
      code: ACP_ERROR_CODES.unavailable,
      message: UI_TEXT.actionFailed,
      data: { kind: 'deadline' },
    })
    expectClean(failure, h.log)
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('withholds sentinels planted in ModelApiError message, kind and code', async () => {
    const { h, failure } = await promptFailure(
      new ModelApiError(
        `provider said ${SENTINEL_TEXT} ${SENTINEL_BLOB}`,
        429,
        SENTINEL_TEXT,
        SENTINEL_KEY,
      ),
    )
    expect(failure).toMatchObject({
      code: ACP_ERROR_CODES.turnFailed,
      message: UI_TEXT.actionFailed,
      data: { kind: 'model_api_error' },
    })
    expectClean(failure, h.log)
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('withholds sentinels planted in an MSP failure kind and message', async () => {
    const msp = new MspError({
      code: 3,
      message: `cli failed ${SENTINEL_BLOB} ${SENTINEL_KEY}`,
      data: { kind: SENTINEL_TEXT },
    })
    const { h, failure } = await promptFailure(msp)
    expect(failure).toMatchObject({
      code: ACP_ERROR_CODES.turnFailed,
      message: UI_TEXT.actionFailed,
      data: { kind: 'turn_failed' },
    })
    expectClean(failure, h.log)
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('withholds sentinels planted in RangeError, AbortError and unexpected failures', async () => {
    for (const error of [
      new RangeError(`out of range ${SENTINEL_TEXT} ${SENTINEL_KEY}`),
      new DOMException(SENTINEL_TEXT, 'AbortError'),
      new Error(`boom ${SENTINEL_TEXT} ${SENTINEL_BLOB}`, { cause: { key: SENTINEL_KEY } }),
    ]) {
      const { h, failure } = await promptFailure(error)
      expectClean(failure, h.log)
    }
    // The unexpected failure is the only one logged, from the built shape.
    const { h, failure } = await promptFailure(
      new Error(`boom ${SENTINEL_TEXT}`, { cause: SENTINEL_KEY }),
    )
    expect(failure).toMatchObject({
      code: ACP_ERROR_CODES.internal,
      message: UI_TEXT.actionFailed,
      data: { kind: 'internal' },
    })
    expect(h.log.error).toHaveBeenCalledOnce()
    expectClean(failure, h.log)
  })

  it('withholds a failed turn whose kind and reason echo the request', async () => {
    const h = scene()
    const failure = h.run(async (client) => {
      const { sessionId } = await dogfoodSession(client, cwd)
      const running = dogfoodPrompt(client, sessionId, SENTINEL_TEXT)
      await vi.waitFor(() => {
        expect(h.session.sendTurn).toHaveBeenCalledOnce()
      })
      h.session.emit({
        type: 'turnCompleted',
        turnId: 'turn-1',
        terminal: 'failed',
        errorKind: SENTINEL_TEXT,
        reason: `gave up while reading ${SENTINEL_TEXT} ${SENTINEL_BLOB} ${SENTINEL_KEY}`,
      })
      return await rejectionOf(running)
    })
    const rejection = await failure
    expect(rejection).toMatchObject({
      code: ACP_ERROR_CODES.turnFailed,
      message: UI_TEXT.actionFailed,
      data: { kind: 'turn_failed' },
    })
    expectClean(JSON.stringify(rejection), h.log)
  })

  it('keeps fixed sentences and vocabulary data for the remaining classes', async () => {
    for (const [error, expected] of [
      [new ResourceReadingError('resources.settings'), { code: ACP_ERROR_CODES.unavailable }],
      [new StoreUnavailableError(), { code: ACP_ERROR_CODES.credentialStore }],
      [new MissingApiKeyError(), { code: -32_000 }],
    ] as const) {
      const { h, failure } = await promptFailure(error)
      expect(failure).toMatchObject(expected)
      expectClean(failure, h.log)
    }
  })

  it('drops a forged reading that is not in the vocabulary', async () => {
    const forged = {
      name: 'ResourceReadingError',
      code: 'resource_reading',
      reading: SENTINEL_TEXT,
      message: SENTINEL_BLOB,
    }
    const { h, failure } = await promptFailure(forged)
    expect(failure).toMatchObject({
      code: ACP_ERROR_CODES.internal,
      data: { kind: 'internal' },
    })
    expectClean(failure, h.log)
  })
})
