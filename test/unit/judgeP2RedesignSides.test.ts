// The one production side-factory port (RVM98P2BF finding 2, RVM98P2R round):
// the CLI/ACP/MCP production builder (`cliJudgeBinding` over the built
// `dist/judgeP2.js` and its sources child) dispatches an explicit `separate`
// run to a configured SystemOne route over the M95 providers' pinned
// transport, settles it into the daily ledger, checks the key before any
// claim, and names the exact gap for every id it cannot build. The key is a
// fixture string; the transport seams answer the recorded OpenRouter shape.
// No live, paid or local-model call.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Phase2EvidenceStore } from '../../src/core/judge/evidencePaths'
import { createLogger } from '../../src/host/logger'
import { cliJudgeBinding } from '../../src/runtime/judge/cliBinding'
import { judgeFeaturesLoader } from '../../src/runtime/judge/judgeBundle'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtJudgeFactories } from './helpers/judgeFactoryBundles'
import {
  SYSTEMONE_ADDRESS,
  SYSTEMONE_ROUTE,
  recordingDailyLedger,
  storedSecretByName,
  systemOneAnswer,
  systemOneTransport,
} from './helpers/judgeSystemOneRig'
import captures from './fixtures/judgeSystemOneCaptures.json'
import { command, io } from './judgeCliFixtures'

const built = builtJudgeFactories()

function features() {
  return judgeFeaturesLoader({
    bundlePath: path.join(built.folder, 'judgeP2.js'),
    log: createLogger(new FakeLogOutputChannel()),
  })()
}

/** B fits logprob and stated profiles only: no SystemOne profile can be recorded. */
const EMPTY_STORE: Phase2EvidenceStore = {
  readProfile: () => undefined,
  readAdoptionRecord: () => undefined,
  readEmbeddingHead: () => undefined,
  readEmbeddingManifest: () => undefined,
}

async function cliRun(input: {
  readonly args: readonly string[]
  readonly hasKey?: boolean
  readonly address?: string
  readonly answer?: unknown
  readonly action?: 'ask' | 'mcp'
}) {
  const factory = features()
  const action = input.action ?? 'ask'
  const parsed = command(action, input.args)
  const transport = systemOneTransport({
    ...(input.address !== undefined && { address: input.address }),
    ...(input.answer !== undefined && { answer: input.answer }),
  })
  const daily = recordingDailyLedger()
  const binding = await cliJudgeBinding({
    features: factory,
    options: parsed.options,
    store: EMPTY_STORE,
    readSecret: storedSecretByName(input.hasKey ?? true),
    daily: () => Promise.resolve(daily),
    transport: { resolve: transport.resolve, send: transport.send },
  })
  const deps = await factory.createCommandDeps({ binding, billing: 'free', worstCaseUsd: () => 0 })
  const request = captures.openrouterRecordedNoul.request
  const streams = io(
    action === 'ask'
      ? JSON.stringify(request)
      : `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'judge', arguments: request } })}
`,
  )
  const code = await factory.runJudgeCommand(parsed, streams, deps)
  return { code, output: streams.output(), transport, daily, binding }
}

const SEPARATE = ['--engine', 'separate', '--separate', SYSTEMONE_ROUTE, '--budget-usd', '0.01']

describe('the CLI production builder reaches a configured SystemOne side', () => {
  it('sends an explicit separate run pinned over the M95 transport with the stored key', async () => {
    // No fitted profile: explicit `separate` needs verification and consent,
    // not calibration; its answer keeps its own uncalibrated label.
    const run = await cliRun({ args: SEPARATE })
    expect(run.code).toBe(0)
    expect(run.transport.resolve).toHaveBeenCalledWith('openrouter.ai')
    expect(run.transport.sent).toHaveLength(1)
    const [sent] = run.transport.sent
    expect(sent?.target).toMatchObject({
      host: 'openrouter.ai',
      address: SYSTEMONE_ADDRESS,
      url: new URL('https://openrouter.ai/api/v1/systemone'),
    })
    expect(sent?.headers).toMatchObject({ authorization: 'Bearer fixture-not-a-key' })
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({ model: 'typesafe/jev-1.13' })
    expect(run.output).toContain('typesafe/jev-1.13-20260917')
    expect(run.output).toContain('"source":"separate"')
  })

  it('settles the charge into the daily ledger on top of the hard budget', async () => {
    const run = await cliRun({ args: SEPARATE })
    expect(run.code).toBe(0)
    // The route's captured ceiling is reserved; the reported 491 input
    // tokens at $0.042/M settle.
    expect(run.daily.reserved).toEqual([0.002688])
    expect(run.daily.settled).toHaveLength(1)
    expect(run.daily.settled[0]).toBeCloseTo((491 * 0.042) / 1_000_000, 12)
  })

  it('refuses a missing key before any claim, with the window gap code', async () => {
    const run = await cliRun({ args: SEPARATE, hasKey: false })
    expect(run.code).toBe(4)
    expect(JSON.parse(run.output)).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
      gap: 'key',
    })
    expect(run.daily.reserve).not.toHaveBeenCalled()
    expect(run.transport.send).not.toHaveBeenCalled()
  })

  it('never connects to an address the M95 endpoint policy refuses', async () => {
    const run = await cliRun({ args: SEPARATE, address: '10.0.0.7' })
    expect(run.code).toBe(4)
    expect(run.transport.send).not.toHaveBeenCalled()
    // Not a send: the reservation is refunded, never kept as liability.
    expect(run.daily.settled).toEqual([0])
  })

  it('never lets auto select the untested opt-in route', async () => {
    const run = await cliRun({
      args: [
        '--engine',
        'auto',
        '--separate',
        SYSTEMONE_ROUTE,
        '--model',
        'chosen',
        '--budget-usd',
        '0.01',
      ],
    })
    expect(run.binding()).toMatchObject({ separateVerified: false })
    expect(run.code).toBe(4)
    expect(run.transport.send).not.toHaveBeenCalled()
  })

  it('refuses before any send when the hard budget cannot cover the route', async () => {
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', SYSTEMONE_ROUTE, '--budget-usd', '0.001'],
    })
    expect(run.code).toBe(4)
    expect(run.output).toContain('over-budget')
    expect(run.daily.reserve).not.toHaveBeenCalled()
    expect(run.transport.send).not.toHaveBeenCalled()
  })

  it.each(['ask', 'mcp'] as const)(
    'never lets a reflected credential reach %s stdout',
    async (action) => {
      // The reviewer's echo control: a valid captured answer plus additions
      // reflecting the request's bearer credential.
      const answer = {
        ...(systemOneAnswer(0.95, ['healthy']) as Record<string, unknown>),
        diagnostics: { authorization: 'Bearer fixture-not-a-key', echo: 'saw fixture-not-a-key' },
        request_echo: 'fixture-not-a-key',
        api_key: 'fixture-not-a-key',
      }
      const run = await cliRun({ args: SEPARATE, answer, action })
      expect(run.code).toBe(0)
      expect(run.output).toContain('typesafe/jev-1.13-20260917')
      expect(run.output).not.toContain('fixture-not-a-key')
      expect(run.output).not.toContain('authorization')
    },
  )

  it.each([
    ['fixture-source', 'unknown'],
    ['acme-provider:some-model', 'capture'],
    ['local:tev1:4b', 'install'],
  ])('names the exact gap for %s and sends nothing', async (separateId, gap) => {
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', separateId, '--budget-usd', '0.01'],
    })
    expect(run.binding()).toMatchObject({ separateGap: gap })
    expect(run.code).toBe(4)
    expect(JSON.parse(run.output)).toMatchObject({ gap })
    expect(run.transport.send).not.toHaveBeenCalled()
  })
})
