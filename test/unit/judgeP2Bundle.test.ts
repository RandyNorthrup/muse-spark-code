import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { judgeFeaturesLoader, isJudgeBundle } from '../../src/runtime/judge/judgeBundle'
import { requireFile } from '../../src/host/lazyBundle'
import { createLogger } from '../../src/host/logger'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import type { CalibrationLimits } from '../../src/core/judge/calibration/schema'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import { removeFolder } from './helpers/temporaryFolders'
import { samplingRequest, techniqueFixture } from './judgeSamplingFixtures'
import { answered, command, io, REQUEST, source } from './judgeCliFixtures'

const built = builtForTests('src/runtime/judge/judgeEntry.ts', 'judge.js')
const temporary = mkdtempSync(path.join(tmpdir(), 'muse-judge-assembly-'))
const unavailable = () => fill(UI_TEXT.judgeNoAnswer, { reason: 'source-unavailable' })
const limits: CalibrationLimits = {
  maxSamples: 1000,
  maxIdentifierLength: 128,
  maxBins: 10,
  isotonicMinimumLabels: 200,
  probabilityEpsilon: 1e-5,
  maxIterations: 200,
  convergenceTolerance: 1e-7,
  regularization: 1e-4,
  weightFloor: 1e-5,
}

function loader() {
  return judgeFeaturesLoader({
    bundlePath: built.file,
    log: createLogger(new FakeLogOutputChannel()),
  })
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})
afterAll(() => removeFolder(temporary))

describe('the B/D/CS/G lazy factory', () => {
  lazyLoaderCases(judgeFeaturesLoader, built, unavailable)

  it('does not accept a module without its callable factory', () => {
    for (const value of [undefined, null, {}, { createJudgeFeatures: true }]) {
      expect(isJudgeBundle(value)).toBe(false)
    }
    expect(isJudgeBundle(requireFile(built.file))).toBe(true)
  })

  it('fits and reports offline through the built factory without enabling synthetic profiles', () => {
    const features = loader()()
    const dataset: unknown = JSON.parse(
      readFileSync(
        new URL('../fixtures/judge/calibration/grouped-risk.json', import.meta.url),
        'utf8',
      ),
    )
    const parsed = features.parseCalibrationDataset(dataset, limits)
    if (parsed.status !== 'valid') throw new Error(parsed.reason)
    const fitted = features.fitCalibration(parsed.dataset, 'platt', limits)
    if (fitted.status !== 'fitted') throw new Error(fitted.reason)
    const reported = features.reportCalibration(fitted.profile, parsed.dataset, 5, limits)
    if (reported.status !== 'reported') throw new Error(reported.reason)
    expect(reported.report.activationEligible).toBe(false)
    expect(reported.report.evaluation.calibrated.sampleCount).toBeGreaterThan(0)
    expect(features.parseCalibrationProfile(reported.profile, limits)).toEqual(reported.profile)
    expect(
      features.applyCalibration(reported.profile, parsed.dataset.identity, 0.5, false, limits),
    ).toEqual({ status: 'uncalibrated', reason: 'independent-evaluation-required' })
  })

  it('preserves sampling opt-in and requires one fake admission per sample through the bundle', async () => {
    const sample = loader()().sampleJudge
    const fixture = techniqueFixture()
    const options = {
      optedIn: false,
      sampleCount: 4,
      maxAttemptsPerSample: 1,
      cold: true,
      highStakes: false,
    }
    const signal = new AbortController().signal
    expect(await sample(samplingRequest, options, fixture.deps, signal)).toEqual({
      outcome: 'no-answer',
      reason: 'explicit-off',
    })
    expect(fixture.claims).toHaveLength(0)
    const result = await sample(
      samplingRequest,
      { ...options, optedIn: true },
      fixture.deps,
      signal,
    )
    expect(result).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'sampling', label: 'uncalibrated' } } },
    })
    expect(fixture.deps.admission.run).toHaveBeenCalledTimes(4)
    expect(fixture.claims).toHaveLength(4)
  })

  it('dispatches both contrastive framings through one admitted call in the built bundle', async () => {
    const fixture = techniqueFixture('contrastive')
    fixture.state.answers = [0.8, 0.3]
    const result = await loader()().contrastiveJudge(
      samplingRequest,
      {
        inverses: { risk: { type: 'noul', instructions: 'Is the data preserved?' } },
        maxOutputTokens: 2,
      },
      fixture.deps,
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      outcome: 'answered',
      result: {
        answers: { risk: { noul: 0.75 } },
        muse: { risk: { technique: 'contrastive', label: 'uncalibrated' } },
      },
    })
    expect(fixture.deps.admission.run).toHaveBeenCalledTimes(1)
    expect(fixture.claims).toHaveLength(1)
  })

  it('installs the current caller language before a serve refusal, including after a language change', async () => {
    const load = vi.fn(requireFile)
    const features = judgeFeaturesLoader({
      bundlePath: built.file,
      log: createLogger(new FakeLogOutputChannel()),
      loadBundle: load,
    })
    const judge = vi.fn(() =>
      Promise.resolve({ outcome: 'no-answer', reason: 'explicit-off' } as const),
    )
    for (const label of ['First boundary: {reason}', 'Second boundary: {reason}']) {
      setUiText({ ...EN, judgeNoAnswer: label }, 'fr')
      await expect(
        features().startJudgeServer({
          runtime: { judge },
          tokenDirectory: temporary,
          windowsAcl: { secure: () => Promise.resolve({}) },
        }),
      ).rejects.toThrow(label.replace('{reason}', 'EJUDGE_TOKEN_ACL'))
    }
    expect(load).toHaveBeenCalledTimes(1)
    expect(judge).not.toHaveBeenCalled()
  })

  it('retries the same repaired bundle path without constructing a backend or empty success', () => {
    const file = path.join(temporary, 'repaired.js')
    writeFileSync(file, 'module.exports = {}')
    const features = judgeFeaturesLoader({
      bundlePath: file,
      log: createLogger(new FakeLogOutputChannel()),
    })
    expect(() => features()).toThrow(unavailable())
    copyFileSync(built.file, file)
    copyFileSync(path.join(built.folder, 'uiText.js'), path.join(temporary, 'uiText.js'))
    expect(features().fitCalibration({}, 'platt', limits)).toEqual({
      status: 'uncalibrated',
      reason: 'invalid-dataset',
    })
  })

  it('keeps missing CLI sources explicit through the built factory', async () => {
    const streams = io()
    expect(await loader()().runJudgeCommand(command(), streams, {})).toBe(4)
    expect(JSON.parse(streams.output())).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    expect(streams.error()).toBe('')
  })

  it('requires the paid admission adapter through the built CLI factory', async () => {
    const fake = source('paid', 1)
    const features = loader()()
    const refused = io()
    const options = command('ask', ['--model', 'chosen', '--budget-usd', '1'])
    const resolveSource = () => Promise.resolve(fake.value)
    expect(await features.runJudgeCommand(options, refused, { resolveSource })).toBe(4)
    expect(refused.output()).toContain('consent-needed')
    const admitted = io()
    const admitPaid = vi.fn(() => Promise.resolve(answered()))
    expect(await features.runJudgeCommand(options, admitted, { resolveSource, admitPaid })).toBe(0)
    expect(admitPaid).toHaveBeenCalledExactlyOnceWith(
      fake.value,
      REQUEST,
      1,
      expect.any(AbortSignal),
    )
    expect(fake.judge).not.toHaveBeenCalled()
  })

  it('installs changed caller language for MCP tool refusals through the built factory', async () => {
    const features = loader()
    const judge = vi.fn(() =>
      Promise.resolve({ outcome: 'no-answer', reason: 'source-unavailable' } as const),
    )
    for (const label of ['First MCP: {reason}', 'Second MCP: {reason}']) {
      setUiText({ ...EN, judgeNoAnswer: label }, 'fr')
      const streams = io(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'judge', arguments: samplingRequest },
        })}\n`,
      )
      expect(await features().runJudgeMcp(streams, judge, new AbortController().signal)).toBe(4)
      expect(streams.output()).toContain(label.replace('{reason}', 'source-unavailable'))
      expect(streams.error()).toBe('')
    }
    expect(judge).toHaveBeenCalledTimes(2)
  })
})
