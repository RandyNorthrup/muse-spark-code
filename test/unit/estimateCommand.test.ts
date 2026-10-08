import { beforeAll, describe, expect, it, vi } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'
import {
  collectEstimate,
  estimateDeadline,
  estimateDrift,
  estimateSlashArguments,
  parseEstimateOptions,
  renderEstimate,
  runEstimateCommand,
  type EstimateCommandOptions,
  type EstimateRunPort,
} from '../../src/runtime/estimator/command'
import { EstimateViewSession, openEstimateTui } from '../../src/runtime/estimator/session'
import { estimateSectionSchema, type EstimateRequest } from '../../src/shared/estimate'
import { fakeEstimate } from './helpers/estimator/fixtures'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { wasEstimateComposerHandled } from '../../src/webview/estimator/composer'
import { isEstimateCommandText } from '../../src/webview/estimator/commandPrefix'

const context = { asOf: ESTIMATOR_AS_OF, optimize: 'cost' } as const
const options: EstimateCommandOptions = {
  goal: { kind: 'milestone', milestoneId: 'M117' },
  fleet: 'current',
  format: 'text',
}
const money = { price: vi.fn(() => 'exact-money') }
function result(request: EstimateRequest) {
  const section = fakeEstimate()
  section.asOf = request.asOf
  section.inputs.request = request
  section.inputs.fleet.asOf = request.asOf
  section.disclosures = section.disclosures.map((row) => ({
    ...row,
    uncertainty: { kind: 'unknown' },
  }))
  return section
}
function runner(): EstimateRunPort {
  return { estimate: vi.fn((request: EstimateRequest) => Promise.resolve(result(request))) }
}

interface PendingRun {
  request: EstimateRequest
  signal: AbortSignal
  resolve: (value: unknown) => void
}

/** Resolve the newer of two pending runs after the older was superseded. */
function settleSuperseded(pending: PendingRun[]): { older: PendingRun; newer: PendingRun } {
  const older = pending[0],
    newer = pending[1]
  if (older === undefined || newer === undefined) throw new Error('missing pending runs')
  expect(older.signal.aborted).toBe(true)
  newer.resolve(result(newer.request))
  return { older, newer }
}

describe('M117 estimate command', () => {
  it('renders byte-identical terminal output across process time zones and languages', () => {
    const compiled = buildSync({
      entryPoints: ['src/runtime/estimator/command.ts'],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      minify: true,
    })
    const source = compiled.outputFiles[0]?.text
    if (source === undefined) throw new Error('missing compiled command')
    const script = `${source}\nprocess.stdout.write(module.exports.renderEstimate(${JSON.stringify(fakeEstimate())}, 'text', {price(){return 'exact'}}));`
    const outputs = ['America/Los_Angeles', 'Asia/Tokyo'].map((TZ) => {
      const child = spawnSync(process.execPath, [], {
        input: script,
        encoding: 'utf8',
        env: { TZ, LANG: TZ === 'Asia/Tokyo' ? 'ja_JP.UTF-8' : 'en_US.UTF-8' },
      })
      expect(child.status, child.stderr).toBe(0)
      return child.stdout
    })
    expect(outputs[0]).toBe(outputs[1])
  })
  it('routes composer estimates to the injected local panel and leaves ordinary prompts alone', () => {
    const open = vi.fn()
    const notice = vi.fn()
    const port = { context: () => context, open, notice }
    expect(wasEstimateComposerHandled('ordinary prompt', port)).toBe(false)
    expect(wasEstimateComposerHandled('/estimate M117 --fleet minimum', port)).toBe(true)
    expect(open).toHaveBeenCalledWith({ ...fakeEstimate().inputs.request, fleet: 'minimum' })
    expect(wasEstimateComposerHandled('/estimate bad', port)).toBe(true)
    expect(notice).toHaveBeenCalledWith(UI_TEXT.estimateUsage)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('prefix parity: the eager check agrees with the slash parser on recognition', () => {
    for (const text of [
      '/estimate',
      '/estimate ',
      '/estimate M117',
      '/estimate\tM117',
      '  /estimate M117  ',
      '/estimate "broken',
      '/estimate --help',
    ]) {
      expect(isEstimateCommandText(text.trim())).toBe(true)
      expect(estimateSlashArguments(text.trim())).not.toBeUndefined()
    }
    for (const text of [
      'ordinary prompt',
      '/estimateX',
      '/estimates M117',
      '/ESTIMATE M117',
      '/estimat',
      '',
    ]) {
      expect(isEstimateCommandText(text)).toBe(false)
      expect(estimateSlashArguments(text)).toBeUndefined()
    }
  })
  it('parses every goal, flag, quoted label and explicit UTC deadline', () => {
    for (const goal of [
      'M117',
      '12',
      'm110a0',
      'pr:123',
      'issues:1,2',
      'label:good first issue',
      'release:0.16.0',
      'M117:Q,U',
    ]) {
      expect(parseEstimateOptions([goal])).toMatchObject({
        kind: 'estimate',
        options: { fleet: 'current', format: 'text' },
      })
    }
    expect(
      parseEstimateOptions([
        'M117',
        '--by=2026-10-08',
        '--fleet',
        'optimum',
        '--format',
        'json',
        '--seed',
        'abc',
      ]),
    ).toEqual({
      kind: 'estimate',
      options: {
        ...options,
        deadline: '2026-10-08T00:00:00.000Z',
        fleet: 'optimum',
        format: 'json',
        seed: 'abc',
      },
    })
    expect(estimateSlashArguments('/estimate "label:good first issue" --fleet minimum')).toEqual([
      'label:good first issue',
      '--fleet',
      'minimum',
    ])
    expect(estimateSlashArguments('/estimates M117')).toBeUndefined()
    expect(estimateSlashArguments('/estimate "broken')).toEqual([])
    expect(estimateDeadline('2026-10-08T04:00:00Z')).toBe('2026-10-08T04:00:00.000Z')
  })

  it('refuses malformed options, duplicate flags, rollover and ambiguous dates', () => {
    for (const args of [
      [],
      ['bad'],
      ['M117', '--unknown'],
      ['M117', '--fleet'],
      ['M117', '--fleet', 'bad'],
      ['M117', '--format', 'xml'],
      ['M117', '--seed', ''],
      ['M117', '--fleet', 'current', '--fleet', 'minimum'],
      ['M117', '--by', '2026-02-30'],
      ['M117', '--by', '10/08/2026'],
      ['M117', '--by', '2026-10-08T00:00:00'],
      ['M117', '--fleet', 'current', 'trailing'],
      ['M117', '--seed', '--by'],
    ]) {
      expect(parseEstimateOptions(args), args.join(' ')).toEqual({
        kind: 'invalid',
        reason: UI_TEXT.estimateUsage,
      })
    }
  })

  it('validates the request before dispatch and rejects damaged or mismatched engine replies', async () => {
    const port = runner()
    await expect(
      collectEstimate(options, { ...context, asOf: 'invalid' }, port, new AbortController().signal),
    ).rejects.toThrow()
    expect(port.estimate).not.toHaveBeenCalled()
    for (const value of [
      {},
      { ...fakeEstimate(), disclosures: [] },
      {
        ...fakeEstimate(),
        inputs: {
          ...fakeEstimate().inputs,
          request: { ...fakeEstimate().inputs.request, fleet: 'optimum' },
        },
      },
    ]) {
      await expect(
        collectEstimate(
          options,
          context,
          { estimate: () => Promise.resolve(value) },
          new AbortController().signal,
        ),
      ).rejects.toThrow()
    }
  })

  it('rejects an adapter that mutates the requested goal before returning its reply', async () => {
    await expect(
      collectEstimate(
        options,
        context,
        {
          estimate: (request) => {
            request.goal = { kind: 'milestone', milestoneId: 'M118' }
            return Promise.resolve(result(request))
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('request-mismatch')
  })

  it('aborts before dispatch and discards a result returned after cancellation', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const port = runner()
    await expect(collectEstimate(options, context, port, aborted.signal)).rejects.toThrow()
    expect(port.estimate).not.toHaveBeenCalled()
    const late = new AbortController()
    await expect(
      collectEstimate(
        options,
        context,
        {
          estimate: (request) => {
            late.abort()
            return Promise.resolve(result(request))
          },
        },
        late.signal,
      ),
    ).rejects.toThrow()
  })

  it('runs all CLI formats with full input/calibration evidence and sanitizes engine errors', async () => {
    for (const format of ['md', 'html', 'json', 'text']) {
      const write = vi.fn()
      expect(
        await runEstimateCommand(['M117', '--format', format], {
          context: () => context,
          runner: runner(),
          money,
          write,
          error: vi.fn(),
          signal: new AbortController().signal,
        }),
      ).toBe(0)
      const output: unknown = write.mock.calls[0]?.[0]
      expect(output).toEqual(expect.stringContaining('linux-x64-builder'))
      expect(output).toEqual(expect.stringContaining('disclosures'))
      expect(output).toEqual(expect.stringContaining('uncalibratedPrior'))
      if (format === 'json' && typeof output === 'string')
        expect(estimateSectionSchema.safeParse(JSON.parse(output)).success).toBe(true)
      else expect(output).toEqual(expect.stringContaining(UI_TEXT.estimatePrior))
    }
    const error = vi.fn()
    const write = vi.fn()
    expect(
      await runEstimateCommand(['M117'], {
        context: () => context,
        runner: {
          estimate: () => Promise.reject(new Error('/private/profile/account')),
        },
        money,
        write,
        error,
        signal: new AbortController().signal,
      }),
    ).toBe(1)
    expect(write).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.not.stringContaining('/private'))
  })

  it('escapes hostile HTML and Markdown and uses only the injected price formatter', () => {
    const section = fakeEstimate()
    section.inputs.request.goal = { kind: 'label', label: '<script>hostile</script>' }
    const machine = section.setups[0]?.machines[0]
    if (!machine) throw new Error('fixture machine missing')
    machine.price = {
      providerId: 'fixture',
      sizeId: 'tiny',
      hourlyUsd: 0.1,
      catalogDate: '2026-10-06',
      catalogUrl: 'https://example.invalid/catalog',
      publicCatalog: true,
    }
    for (const row of section.disclosures) row.uncertainty = { kind: 'unknown' }
    // Rebuild the fixture's disclosure index for its added price, without inventing evidence.
    section.disclosures.push({
      path: '/setups/0/machines/0/price/hourlyUsd',
      basis: 'unknown',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    })
    const html = renderEstimate(section, 'html', money)
    expect(html).not.toContain('<script>hostile')
    expect(html).toContain('&lt;script&gt;hostile')
    expect(html).toContain('exact-money')
    expect(html).toContain('not a quote')
    expect(money.price).toHaveBeenCalledWith(machine.price)
    expect(renderEstimate(section, 'md', money)).toContain(' '.repeat(4))
    expect(renderEstimate(section, 'text', money)).toContain(UI_TEXT.estimateCriticalBound)
  })

  it('prints help or usage without reading snapshots or starting the engine', async () => {
    const deps = {
      context: vi.fn(() => context),
      runner: runner(),
      money,
      write: vi.fn(),
      error: vi.fn(),
      signal: new AbortController().signal,
    }
    expect(await runEstimateCommand(['--help'], deps)).toBe(0)
    expect(deps.write).toHaveBeenCalledWith(
      expect.stringContaining('muse-spark-code-acp estimate <goal>'),
    )
    expect(deps.write).toHaveBeenCalledWith(expect.stringContaining('[--format md|html|json|text]'))
    expect(deps.write).toHaveBeenCalledWith(expect.stringContaining('[--seed <seed>]'))
    expect(await runEstimateCommand(['bad'], deps)).toBe(2)
    expect(deps.context).not.toHaveBeenCalled()
    expect(deps.runner.estimate).not.toHaveBeenCalled()
  })
})

describe('M117 re-estimation and TUI', () => {
  it('shows signed finish-date drift with complete new disclosures', () => {
    const previous = fakeEstimate()
    const next = result({ ...previous.inputs.request, asOf: '2026-10-06T12:30:00.000Z' })
    next.p50 = '2026-10-06T12:45:00.000Z'
    next.p90 = '2026-10-06T15:00:00.000Z'
    expect(estimateDrift(next, previous).drift).toEqual({
      previousAsOf: previous.asOf,
      p50Hours: -0.25,
      p90Hours: 1,
    })
    expect(
      estimateDrift(next, previous).disclosures.filter((row) => row.path.startsWith('/drift/')),
    ).toHaveLength(2)
  })

  it('refreshes only relevant newer lane-finished events and unsubscribes on close', async () => {
    let event: (value: unknown) => void = vi.fn()
    const unsubscribe = vi.fn()
    const publish = vi.fn()
    const error = vi.fn()
    const port = runner()
    const view = new EstimateViewSession(
      options,
      context,
      port,
      {
        subscribe: (listener) => {
          event = listener
          return unsubscribe
        },
      },
      publish,
      error,
    )
    await view.refresh()
    event({ laneId: 'unrelated', asOf: '2026-10-06T12:30:00.000Z' })
    event({ laneId: 'A', asOf: context.asOf })
    expect(port.estimate).toHaveBeenCalledTimes(1)
    const laneId = fakeEstimate().inputs.lanes[0]?.id
    event({ laneId, asOf: '2026-10-06T12:30:00.000Z' })
    await vi.waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(2)
    })
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ drift: { previousAsOf: context.asOf } })
    event({ laneId, asOf: 'not-a-time' })
    expect(error).toHaveBeenCalledTimes(1)
    await view.refresh('not-a-time')
    await view.refresh(context.asOf)
    expect(error).toHaveBeenCalledTimes(3)
    expect(error).toHaveBeenNthCalledWith(2, expect.stringContaining('invalid-snapshot'))
    expect(error).toHaveBeenNthCalledWith(3, expect.stringContaining('invalid-snapshot'))
    expect(port.estimate).toHaveBeenCalledTimes(2)
    view.dispose()
    view.dispose()
    event({ laneId, asOf: '2026-10-06T12:40:00.000Z' })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(port.estimate).toHaveBeenCalledTimes(2)
  })

  it('refreshes at a lane completion received during the first estimate', async () => {
    let event: (value: unknown) => void = vi.fn()
    const publish = vi.fn()
    const error = vi.fn()
    const pending: {
      request: EstimateRequest
      signal: AbortSignal
      resolve: (value: unknown) => void
    }[] = []
    const view = new EstimateViewSession(
      options,
      context,
      {
        estimate: (request, signal) =>
          new Promise((resolve) => {
            pending.push({ request, signal, resolve })
          }),
      },
      {
        subscribe: (listener) => {
          event = listener
          return vi.fn()
        },
      },
      publish,
      error,
    )
    const first = view.refresh()
    expect(pending).toHaveLength(1)
    const laneId = fakeEstimate().inputs.lanes[0]?.id
    if (laneId === undefined) throw new Error('missing fixture lane')
    event({ laneId, asOf: '2026-10-06T12:30:00.000Z' })
    expect(pending).toHaveLength(2)
    const { older } = settleSuperseded(pending)
    await vi.waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(1)
    })
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ asOf: '2026-10-06T12:30:00.000Z' })
    older.resolve(result(older.request))
    await first
    expect(publish).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
    view.dispose()
  })

  it('aborts superseded work and never publishes a late or disposed result', async () => {
    const pending: {
      request: EstimateRequest
      signal: AbortSignal
      resolve: (value: unknown) => void
    }[] = []
    const publish = vi.fn()
    const error = vi.fn()
    const view = new EstimateViewSession(
      options,
      context,
      {
        estimate: (request, signal) =>
          new Promise((resolve) => {
            pending.push({ request, signal, resolve })
          }),
      },
      { subscribe: () => vi.fn() },
      publish,
      error,
    )
    const first = view.refresh()
    const second = view.refresh('2026-10-06T12:30:00.000Z')
    const { older } = settleSuperseded(pending)
    await second
    older.resolve(result(older.request))
    await first
    expect(publish).toHaveBeenCalledTimes(1)
    const closing = view.refresh()
    view.dispose()
    const last = pending[2]
    if (!last) throw new Error('missing closing run')
    expect(last.signal.aborted).toBe(true)
    last.resolve(result(last.request))
    await closing
    expect(publish).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('renders the TUI through the injected host and lets that host refresh and close', async () => {
    const show = vi.fn()
    let controls: { refresh(): Promise<void>; close(): void } | undefined
    const session = await openEstimateTui(options, {
      context,
      runner: runner(),
      finished: { subscribe: () => vi.fn() },
      money,
      view: (callbacks) => {
        controls = callbacks
        return { show, error: vi.fn() }
      },
    })
    expect(show).toHaveBeenCalledWith(
      UI_TEXT.estimateTitle,
      expect.stringContaining(UI_TEXT.estimatePrior),
    )
    await controls?.refresh()
    expect(show).toHaveBeenCalledTimes(2)
    controls?.close()
    await session.refresh()
    expect(show).toHaveBeenCalledTimes(2)
  })
})

describe('M117 standalone runtime entry', () => {
  let entry: string
  beforeAll(() => {
    entry = buildSync({
      entryPoints: ['src/runtime/main.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      external: ['@napi-rs/keyring'],
    }).outputFiles[0]!.text
  })
  it('routes estimate arguments before common runtime flags parse them', () => {
    const argv = [
      'M117',
      '--format',
      'json',
      '--seed',
      'repeat',
      '--fleet',
      'minimum',
      '--by',
      '2026-10-09',
    ]
    expect(parseCommandLine(['estimate', ...argv])).toEqual({ command: 'estimate', argv })
  })
  it('dispatches estimate help through the production entry without auth or model startup', () => {
    const result = spawnSync(process.execPath, ['-', 'estimate', '--help'], {
      input: entry,
      cwd: process.cwd(),
      env: { PATH: process.env['PATH'], LANG: 'en_US.UTF-8' },
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('muse-spark-code-acp estimate')
    expect(result.stdout).toContain('--format md|html|json|text')
    expect(result.stderr).not.toContain('Unknown argument')
  })
})
