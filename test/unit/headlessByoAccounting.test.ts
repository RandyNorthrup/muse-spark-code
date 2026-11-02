// RLF-M102BYO: production headless BYO accounting over the real stack —
// the real providers file, catalogue, configured-provider client and
// Responses codec, the real runtime accounting wrapper, run ledger and
// shared daily budget. The only injected piece is the socket outcome,
// which replays recorded provider exchanges (m95-captures, 2026-10-04);
// no request leaves the machine.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import capturedStream from '../../docs/certification/m95-captures/openai/03-tool-result-stream.json'
import capturedError from '../../docs/certification/m95-captures/openai/06-error-invalid-model.json'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import { noRetryBudget } from '../../src/core/backends/modelapi/transport'
import {
  createRuntimeDailyBudget,
  withRuntimeAccounting,
  type RuntimeResponseAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import {
  PAID_DAILY_BUDGET,
  PROVIDER_SECRET_PREFIX,
  PROVIDERS_FILE_VERSION,
  RUNTIME_SETTINGS_FILE,
} from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { makeTurnBody } from './helpers/turnBodies'

const MODEL_REF = 'openai/gpt-5.6-luna'
// Built from parts so no scanner ever sees a whole test key.
const TEST_KEY = ['sk', 'byo', 'accounting', 'replay', 'only'].join('-')

function sseBytes(
  events: readonly { readonly event: string; readonly data: unknown }[],
): Uint8Array {
  return new TextEncoder().encode(
    events
      .map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`)
      .join(''),
  )
}

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'headless-byo-'))
  const configFile = path.join(directory, 'providers.json')
  const catalogFile = path.join(directory, 'providerCatalog.json')
  writeFileSync(
    configFile,
    JSON.stringify({
      v: PROVIDERS_FILE_VERSION,
      providers: [
        {
          id: 'openai',
          preset: 'openai',
          address: 'https://api.openai.com',
          auth: 'apiKey',
          models: ['gpt-5.6-luna'],
        },
      ],
    }),
  )
  const snapshot: unknown = JSON.parse(
    readFileSync(new URL('../../vendor/models-dev/snapshot.json', import.meta.url), 'utf8'),
  )
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    !('providers' in snapshot) ||
    typeof snapshot.providers !== 'object' ||
    snapshot.providers === null ||
    !('openai' in snapshot.providers)
  )
    throw new TypeError('vendored catalogue has no openai provider')
  writeFileSync(
    catalogFile,
    JSON.stringify({ providers: { openai: Reflect.get(snapshot.providers, 'openai') } }),
  )
  const sentPaths: string[] = []
  const services = createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile,
    secrets: {
      get: (key: string) =>
        Promise.resolve(
          key === `${PROVIDER_SECRET_PREFIX}openai`
            ? JSON.stringify({
                v: 1,
                auth: 'apiKey',
                origin: 'https://api.openai.com',
                secret: TEST_KEY,
              })
            : undefined,
        ),
    },
    send: (target) => {
      sentPaths.push(target.url.pathname)
      if (target.url.pathname.includes('input_tokens')) {
        const bytes = new TextEncoder().encode(JSON.stringify(capturedError.response.body))
        return Promise.resolve({
          status: capturedError.response.status,
          headers: { 'content-type': 'application/json' },
          body: {
            async *[Symbol.asyncIterator]() {
              await Promise.resolve()
              yield bytes
            },
          },
          close: () => undefined,
        })
      }
      const bytes = sseBytes(capturedStream.response.events)
      return Promise.resolve({
        status: capturedStream.response.status,
        headers: { 'content-type': 'text/event-stream' },
        body: {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve()
            yield bytes
          },
        },
        close: () => undefined,
      })
    },
  })
  const dataFolder = path.join(directory, 'agent-data')
  return { dataFolder, services, sentPaths }
}

function dailyFor(dataFolder: string, limitUsd: number | undefined) {
  if (limitUsd !== undefined) {
    mkdirSync(dataFolder, { recursive: true })
    writeFileSync(
      path.join(dataFolder, RUNTIME_SETTINGS_FILE),
      JSON.stringify({ paidDailyBudgetUsd: limitUsd }),
    )
  }
  return createRuntimeDailyBudget({
    dataFolder,
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
  })
}

async function runOnce(limitUsd: number | undefined) {
  const { dataFolder, services, sentPaths } = setup()
  const daily = dailyFor(dataFolder, limitUsd)
  const ledger = createRunLedger({ capUsd: Usd.from(1).toAmount(), maxRequests: undefined })
  const refusals: string[] = []
  const accounting: RuntimeResponseAccounting = {
    ledger,
    refuse: (reason) => {
      refusals.push(reason)
    },
    started: () => undefined,
    settled: () => undefined,
  }
  const client = withRuntimeAccounting(services.client, daily, accounting)
  const body = makeTurnBody({
    model: MODEL_REF,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'What time is it?' }] }],
    instructions: 'You are a coding agent.',
    toolName: 'read_file',
    effort: 'medium',
    include: ['reasoning.encrypted_content'],
    maxOutputTokens: 8192,
    promptCacheKey: 'byo-accounting-1',
  })
  const events: string[] = []
  const stream = client.streamResponse(
    body,
    new AbortController().signal,
    undefined,
    noRetryBudget(),
    undefined,
    undefined,
  )
  for await (const event of stream) events.push(event.type)
  return { dataFolder, daily, ledger, refusals, events, sentPaths }
}

describe('headless BYO accounting (RLF-M102BYO)', () => {
  it('settles a priced BYO run exactly in the run ledger and the shared daily total', async () => {
    const run = await runOnce(1)
    expect(run.events.at(-1)).toBe('response.completed')
    expect(run.refusals).toEqual([])
    const totals = run.ledger.totals()
    expect(totals.requests).toBe(1)
    // Captured usage (openai/03, 2026-10-04): input 1497, cached 1444,
    // cache writes 50, output 12. Catalogue card (vendor snapshot):
    // input $0.20, cached $0.02, write $0.25, output $1.20 per million.
    // fresh = 1497 - 1444 - 50 = 3;
    // 3*0.20 + 1444*0.02 + 50*0.25 + 12*1.20 = 56.38 micro-dollars,
    // ceilinged to whole micro-dollars by the ledger: 0.000057.
    expect(totals.settledUsd).toBe('0.000057')
    expect(totals.uncertainUsd).toBe('0')
    const rows = await run.daily.readToday()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.budget.spentUsd).toBe('0.000057')
    expect(rows[0]?.budget.unknownChargeCalls).toBeUndefined()
    expect(run.sentPaths.filter((p) => p === '/v1/responses')).toHaveLength(1)
  })

  it('with no daily limit set, settles the run and writes no daily record (D208)', async () => {
    const run = await runOnce(undefined)
    expect(run.events.at(-1)).toBe('response.completed')
    expect(run.ledger.totals().settledUsd).toBe('0.000057')
    expect(await run.daily.readToday()).toEqual([])
    const dailyFolder = path.join(run.dataFolder, PAID_DAILY_BUDGET.directory)
    expect(() => readdirSync(dailyFolder)).toThrow()
  })
})
