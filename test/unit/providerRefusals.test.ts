// Every configured wire family crosses the same production refusal boundary.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import { SessionBudgetExceededError } from '../../src/core/backends/modelapi/sessionBudget'
import { ModelApiError, MissingApiKeyError } from '../../src/core/backends/modelapi/transport'
import { UserRefusalError, isUserRefusal } from '../../src/core/refusal'
import { fill } from '../../src/shared/l10n/text'
import { UI_TEXT } from '../../src/shared/constants'
import { metaGoldenBodies } from './helpers/m95MetaBodies'
import { removeFolder } from './helpers/temporaryFolders'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'

const golden = metaGoldenBodies()[0]?.body
if (golden === undefined) throw new Error('Missing request capture')
const families = ['responses', 'chat', 'anthropic', 'gemini', 'ollama'] as const
const fixture = { root: '' }
beforeAll(async () => {
  fixture.root = await mkdtemp(path.join(tmpdir(), 'exec-refusals-'))
})
afterAll(async () => {
  await removeFolder(fixture.root)
})
class FixtureRefusal extends Error {
  public constructor(name: string) {
    super('local typed refusal')
    this.name = name
  }
}
function refusals() {
  return [
    new SessionBudgetExceededError('local budget refusal'),
    new ModelApiError('local transport refusal', 0, 'refused', 'budget'),
    new MissingApiKeyError(),
    new RangeError('local output minimum refusal'),
    new Error(UI_TEXT.scheduleConfirmationExpired),
    new Error(UI_TEXT.execBudgetRefused),
    new Error(UI_TEXT.execModelUnpriced),
    new Error(UI_TEXT.execUnknownModel),
    new Error(UI_TEXT.sessionBudgetSearchUnavailable),
    new UserRefusalError(fill(UI_TEXT.media.cappedRateUnknown, { model: 'local/native' })),
    ...[
      'ChatCodecError',
      'AnthropicCodecError',
      'ResponsesDecodeError',
      'ResponsesOutputCapError',
      'ChatgptPlanLimitError',
      'AbortedError',
      'ContextOverflowError',
      'HookStoppedError',
      'HookCancelledError',
      'ChildTaskRefusedError',
    ].map((name) => new FixtureRefusal(name)),
  ]
}

describe('shared local refusal predicate', () => {
  it('preserves every local refusal, and rejects unknown diagnostics and substring matches', () => {
    for (const error of refusals()) expect(isUserRefusal(error), error.name).toBe(true)
    expect(isUserRefusal(new Error('unknown diagnostic'))).toBe(false)
    expect(isUserRefusal(new Error(UI_TEXT.execBudgetRefused + ' unexpected suffix'))).toBe(false)
    expect(isUserRefusal({ name: 'SessionBudgetExceededError', message: 'foreign object' })).toBe(
      false,
    )
  })
  it('preserves every refusal through the production Meta client', async () => {
    const api = fakeModelApi()
    const client = fakeModelApiClient(api, new FakeLogOutputChannel())
    for (const error of refusals()) {
      const guard = Object.assign(vi.fn(), { prepare: () => Promise.reject(error) })
      await expect(
        Array.fromAsync(
          client.streamResponse(golden, new AbortController().signal, undefined, undefined, guard),
        ),
      ).rejects.toBe(error)
    }
    expect(api.responseBodies()).toHaveLength(0)
  })
})
it.each(families)(
  'preserves every refusal through the production %s configured client',
  async (format) => {
    const configFile = path.join(fixture.root, format + '.json')
    await writeFile(
      configFile,
      JSON.stringify({
        v: 1,
        defaultModel: 'local/native',
        providers: [
          {
            id: 'local',
            preset: 'custom',
            format,
            auth: 'apiKey',
            address: 'http://127.0.0.1:12345',
            privateNetwork: true,
            models: ['native'],
            numCtx: { native: 8192 },
            modelLimits: { native: { contextTokens: 8192, outputTokens: 64 } },
          },
        ],
      }),
    )
    const send = vi.fn(() => Promise.reject(new Error('should not send')))
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
      secrets: {
        get: () =>
          Promise.resolve(
            JSON.stringify({
              v: 1,
              auth: 'apiKey',
              origin: 'http://127.0.0.1:12345',
              secret: 'synthetic-owned-key',
            }),
          ),
      },
      send,
    })
    const model = await services.registry.resolve('local/native')
    const body = {
      ...golden,
      model: model.ref,
      tools: [],
      reasoning: { effort: 'none' },
      max_output_tokens: 64,
    }
    for (const error of refusals()) {
      const guard = Object.assign(vi.fn(), { prepare: () => Promise.reject(error) })
      await expect(
        Array.fromAsync(
          model.client.streamResponse(
            body,
            new AbortController().signal,
            undefined,
            undefined,
            guard,
          ),
        ),
      ).rejects.toBe(error)
    }
    const guard = Object.assign(vi.fn(), {
      prepare: () => Promise.reject(new Error('unknown diagnostic')),
    })
    await expect(
      Array.fromAsync(
        model.client.streamResponse(
          body,
          new AbortController().signal,
          undefined,
          undefined,
          guard,
        ),
      ),
    ).rejects.toThrow(UI_TEXT.modelsPanelUnavailable)
    expect(send).not.toHaveBeenCalled()
  },
)
