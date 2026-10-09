// The one production side-factory port (RVM98P2BF finding 2): the CLI/ACP/MCP
// production builder (`cliJudgeBinding` over the built `dist/judgeP2.js` and
// its sources child) dispatches an explicit `separate` run to a configured
// SystemOne route, and names the exact gap for every id it cannot build.
// The key is a fixture string; the transport is a fake fetch answering the
// recorded OpenRouter shape. No live, paid or local-model call.
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Phase2EvidenceStore } from '../../src/core/judge/evidencePaths'
import { createLogger } from '../../src/host/logger'
import { cliJudgeBinding } from '../../src/runtime/judge/cliBinding'
import { judgeFeaturesLoader } from '../../src/runtime/judge/judgeBundle'
import { PROVIDER_SECRET_PREFIX } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtJudgeFactories } from './helpers/judgeFactoryBundles'
import captures from './fixtures/judgeSystemOneCaptures.json'
import { command, io } from './judgeCliFixtures'

const built = builtJudgeFactories()
const ROUTE = 'openrouter-jev:typesafe/jev-1.13'
const ENDPOINT = 'https://openrouter.ai/api/v1/systemone'

function features() {
  return judgeFeaturesLoader({
    bundlePath: path.join(built.folder, 'judgeP2.js'),
    log: createLogger(new FakeLogOutputChannel()),
  })()
}

async function cliRun(input: { readonly args: readonly string[]; readonly hasKey?: boolean }) {
  const factory = features()
  const parsed = command('ask', input.args)
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(captures.openrouterRecordedNoul.response, { status: 200 })),
  )
  // B fits logprob and stated profiles only, so no SystemOne profile can be
  // recorded: the store holds nothing, and only the cascade would need one.
  const store: Phase2EvidenceStore = {
    readProfile: () => undefined,
    readAdoptionRecord: () => undefined,
    readEmbeddingHead: () => undefined,
    readEmbeddingManifest: () => undefined,
  }
  const readSecret = vi.fn((name: string) =>
    Promise.resolve(
      input.hasKey !== false && name === `${PROVIDER_SECRET_PREFIX}openrouter`
        ? JSON.stringify({
            v: 1,
            auth: 'apiKey',
            origin: 'https://openrouter.ai',
            secret: 'fixture-not-a-key',
          })
        : undefined,
    ),
  )
  const binding = cliJudgeBinding({
    features: factory,
    options: parsed.options,
    store,
    readSecret,
    fetch: fetcher,
  })
  const deps = await factory.createCommandDeps({ binding, billing: 'free', worstCaseUsd: () => 0 })
  const streams = io(JSON.stringify(captures.openrouterRecordedNoul.request))
  const code = await factory.runJudgeCommand(parsed, streams, deps)
  return { code, output: streams.output(), fetcher, binding }
}

describe('the CLI production builder reaches a configured SystemOne side', () => {
  it('sends an explicit separate run to the configured route with the stored key', async () => {
    // No fitted profile: explicit `separate` needs verification and consent,
    // not calibration; its answer keeps its own uncalibrated label.
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', ROUTE, '--budget-usd', '0.01'],
    })
    expect(run.code).toBe(0)
    expect(run.fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = run.fetcher.mock.calls[0] ?? []
    expect(url).toEqual(new URL(ENDPOINT))
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { authorization: 'Bearer fixture-not-a-key' },
    })
    const body = typeof init?.body === 'string' ? init.body : ''
    expect(JSON.parse(body)).toMatchObject({ model: 'typesafe/jev-1.13' })
    expect(run.output).toContain('typesafe/jev-1.13-20260917')
    expect(run.output).toContain('"source":"separate"')
  })

  it('never lets auto select the untested opt-in route', async () => {
    const run = await cliRun({
      args: ['--engine', 'auto', '--separate', ROUTE, '--model', 'chosen', '--budget-usd', '0.01'],
    })
    expect(run.binding()).toMatchObject({ separateVerified: false })
    expect(run.code).toBe(4)
    expect(run.fetcher).not.toHaveBeenCalled()
  })

  it('refuses before any send when the hard budget cannot cover the route', async () => {
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', ROUTE, '--budget-usd', '0.001'],
    })
    expect(run.code).toBe(4)
    expect(run.output).toContain('over-budget')
    expect(run.fetcher).not.toHaveBeenCalled()
  })

  it('refuses at dispatch without a stored key and sends nothing', async () => {
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', ROUTE, '--budget-usd', '0.01'],
      hasKey: false,
    })
    expect(run.code).toBe(4)
    expect(run.output).toContain('source-unavailable')
    expect(run.fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['fixture-source', 'unknown-source'],
    ['acme-provider:some-model', 'needs-capability-capture'],
    ['local:tev1:4b', 'needs-local-install'],
  ])('names the exact gap for %s and sends nothing', async (separateId, gap) => {
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', separateId, '--budget-usd', '0.01'],
    })
    expect(run.binding()).toMatchObject({ separateGap: gap })
    expect(run.code).toBe(4)
    expect(run.fetcher).not.toHaveBeenCalled()
  })
})
