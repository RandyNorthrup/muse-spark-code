// The one production side-factory port (RVM98P2BF finding 2, RVM98P2R round):
// the CLI/ACP/MCP production builder (`cliJudgeBinding` over the shipped
// `dist/judgeP2.js` and its sources child) dispatches an explicit `separate`
// run to a configured SystemOne route over the M95 providers' pinned
// transport, settles it into the daily ledger, checks the key before any
// claim, and names the exact gap for every id it cannot build. The key is a
// fixture string; the transport seams answer the recorded OpenRouter shape.
// No live, paid or local-model call.
import { describe, expect, inject, it } from 'vitest'
import { assertCurrentProductionBuild } from './productionBuild'
import type { Phase2EvidenceStore } from '../../src/core/judge/evidencePaths'
import { cliJudgeBinding } from '../../src/runtime/judge/cliBinding'
import { Usd } from '../../src/shared/usd'
import { shippedJudgeP2Features } from './helpers/judgeP2Features'
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

// The shipped lazy assembly, not a per-test build: this suite runs against
// the production dist/ the delivery gate proved current.
assertCurrentProductionBuild(inject('productionBuildGeneration'), process.cwd())

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
  /** The daily claim's live check starts refusing after this many checks. */
  readonly stopAfterChecks?: number
}) {
  const factory = shippedJudgeP2Features()
  const action = input.action ?? 'ask'
  const parsed = command(action, input.args)
  const transport = systemOneTransport({
    ...(input.address !== undefined && { address: input.address }),
    ...(input.answer !== undefined && { answer: input.answer }),
  })
  const daily = recordingDailyLedger(undefined, input.stopAfterChecks)
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

/**
A valid captured answer with provider additions that reflect the fixture
key: the run answers, and its stdout never carries the key.
*/
async function reflectedRun(action: 'ask' | 'mcp', additions: Record<string, unknown>) {
  const answer = {
    ...(systemOneAnswer(0.95, ['healthy']) as Record<string, unknown>),
    ...additions,
  }
  const run = await cliRun({ args: SEPARATE, answer, action })
  expect(run.code).toBe(0)
  expect(run.output).toContain('typesafe/jev-1.13-20260917')
  expect(run.output).not.toContain('fixture-not-a-key')
  return run
}

describe('the CLI production builder reaches a configured SystemOne side', () => {
  it('sends an explicit separate run pinned over the M95 transport with the stored key', async () => {
    // No fitted profile: explicit `separate` needs verification and consent,
    // not calibration; its answer keeps its own uncalibrated label.
    const run = await cliRun({ args: SEPARATE })
    expect(run.code).toBe(0)
    expect(run.transport.resolves).toEqual([[SYSTEMONE_ADDRESS]])
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
    // tokens at $0.042/M settle, both in exact amounts.
    expect(run.daily.reserved).toEqual([Usd.from(0.002688).toAmount()])
    expect(run.daily.settled).toEqual([Usd.from((491 * 0.042) / 1_000_000).toAmount()])
  })

  it('a daily Stop after reservation sends nothing and refunds (RVM98P2R2 3)', async () => {
    // The claim's first check (at reservation) passes; Stop lands before the
    // key read finishes, so the check right before dispatch refuses.
    const run = await cliRun({ args: SEPARATE, stopAfterChecks: 1 })
    expect(run.code).toBe(4)
    expect(run.output).toContain('over-budget')
    expect(run.daily.reserved).toEqual([Usd.from(0.002688).toAmount()])
    expect(run.daily.settled).toEqual([Usd.from(0).toAmount()])
    expect(run.transport.sent).toHaveLength(0)
  })

  it('refuses a missing key before any claim, with the window gap code', async () => {
    const run = await cliRun({ args: SEPARATE, hasKey: false })
    expect(run.code).toBe(4)
    expect(JSON.parse(run.output)).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
      gap: 'key',
    })
    expect(run.daily.reserveCalls).toHaveLength(0)
    expect(run.transport.sent).toHaveLength(0)
  })

  it('never connects to an address the M95 endpoint policy refuses', async () => {
    const run = await cliRun({ args: SEPARATE, address: '10.0.0.7' })
    expect(run.code).toBe(4)
    expect(run.transport.sent).toHaveLength(0)
    // Not a send: the reservation is refunded, never kept as liability.
    expect(run.daily.settled).toEqual([Usd.from(0).toAmount()])
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
    expect(run.transport.sent).toHaveLength(0)
  })

  it('refuses before any send when the hard budget cannot cover the route', async () => {
    const run = await cliRun({
      args: ['--engine', 'separate', '--separate', SYSTEMONE_ROUTE, '--budget-usd', '0.001'],
    })
    expect(run.code).toBe(4)
    expect(run.output).toContain('over-budget')
    expect(run.daily.reserveCalls).toHaveLength(0)
    expect(run.transport.sent).toHaveLength(0)
  })

  it.each(['ask', 'mcp'] as const)(
    'never lets a reflected credential reach %s stdout',
    async (action) => {
      // The reviewer's echo control: a valid captured answer plus additions
      // reflecting the request's bearer credential.
      const run = await reflectedRun(action, {
        diagnostics: { authorization: 'Bearer fixture-not-a-key', echo: 'saw fixture-not-a-key' },
        request_echo: 'fixture-not-a-key',
        api_key: 'fixture-not-a-key',
      })
      expect(run.output).not.toContain('authorization')
    },
  )

  it.each(['ask', 'mcp'] as const)(
    'never lets a credential-bearing property name reach %s stdout (RVM98P2R2 4)',
    async (action) => {
      // The key reflected as unknown property names, at two depths; values
      // are opaque, so only the names carry it.
      const run = await reflectedRun(action, {
        diagnostics: {
          'fixture-not-a-key': 'opaque diagnostic',
          nested: { 'seen:fixture-not-a-key': 1, kept: 'plain' },
        },
      })
      expect(run.output).toContain('plain')
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
    expect(run.transport.sent).toHaveLength(0)
  })
})
