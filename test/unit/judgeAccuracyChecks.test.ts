// M125 lane K: the accuracy checks over a valid independent profile
// (gate math only — no fitted claim exists yet, per §7.0), one real
// synthetic fit (the 2b evidence rule, end to end through the gate),
// and the recorded judgeFast exchanges (captured 2026-10-22) for the
// failure-count parser. Below the bar or without a profile the verdict
// is a log record with no judged content, never a shown hint or note.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fitCalibration } from '../../src/core/judge/calibration/fit'
import type { CommittedCalibrationProfile } from '../../src/core/judge/calibration/profiles'
import { reportCalibration } from '../../src/core/judge/calibration/report'
import {
  CALIBRATION_FAMILIES,
  parseCalibrationDataset,
  parseCalibrationProfile,
  type CalibrationIdentity,
  type CalibrationLimits,
  type CalibrationProfile,
} from '../../src/core/judge/calibration/schema'
import { consistencyState, decideConsistency } from '../../src/core/judge/fast/checks/consistency'
import { decideDestructive, destructiveState } from '../../src/core/judge/fast/checks/destructive'
import {
  decideDone,
  doneState,
  doneUnbackedProbability,
} from '../../src/core/judge/fast/checks/done'
import { decideEdit, editState } from '../../src/core/judge/fast/checks/edit'
import {
  boundEvidence,
  headTailEvidence,
  joinEvidence,
} from '../../src/core/judge/fast/checks/evidence'
import {
  decideFailures,
  failuresState,
  parseFailureCount,
} from '../../src/core/judge/fast/checks/failures'
import {
  ACCURACY_CHANNELS,
  CHECK_PRECISION_BAR,
  runAccuracyCheck,
} from '../../src/core/judge/fast/checks/gate'
import { decideScope, scopeState } from '../../src/core/judge/fast/checks/scope'
import {
  ACCURACY_CHECKS,
  type AccuracyCheckId,
  type AccuracyEngine,
  type AccuracyOutput,
} from '../../src/core/judge/fast/checks/types'
import { FAST_DECISIONS } from '../../src/core/judge/fast/classes'
import {
  JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS,
  JUDGE_FAST_DESTRUCTIVE_MIN_PRECISION,
  JUDGE_FAST_HINT_MIN_PRECISION,
} from '../../src/shared/constants'

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'judgeFast',
)
const fixture = (name: string): string => readFileSync(path.join(fixtureRoot, name), 'utf8')

const limits: CalibrationLimits = {
  maxSamples: 2000,
  maxIdentifierLength: 256,
  maxBins: 20,
  isotonicMinimumLabels: 200,
  probabilityEpsilon: 1e-6,
  maxIterations: 100,
  convergenceTolerance: 1e-8,
  regularization: 1e-6,
  weightFloor: 1e-6,
}

const engine: AccuracyEngine = {
  providerId: 'test-provider',
  model: 'test-model',
  endpoint: 'test-endpoint',
  technique: 'stated',
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
A valid independent profile with the identity platt mapping (slope 1,
intercept 0), so the gate's bar comparison is exact. Gate math only:
it fits nothing and claims no calibration standing.
*/
function testProfile(
  family: string,
  profileEngine: AccuracyEngine = engine,
): CommittedCalibrationProfile {
  const technique = profileEngine.technique
  const profile: CalibrationProfile = {
    version: 1,
    identity: {
      providerId: profileEngine.providerId,
      model: profileEngine.model,
      modelVersion: 'test-version',
      endpoint: profileEngine.endpoint,
      source: 'same',
      technique,
      family,
      promptVersion: 'test-prompt',
      criteriaVersion: 'test-criteria',
      fitVersion: 'test-fit',
    },
    evidence: 'independent',
    epsilon: 1e-6,
    fit: { method: 'platt', slope: 1, intercept: 0 },
    combinationWeight: 1,
    partitions: {
      fit: {
        ids: ['fit-id'],
        labels: ['fit-label'],
        tasks: ['fit-task'],
        repositories: ['fit-repo'],
      },
      tuning: {
        ids: ['tun-id'],
        labels: ['tun-label'],
        tasks: ['tun-task'],
        repositories: ['tun-repo'],
      },
      evaluation: {
        ids: ['eval-id'],
        labels: ['eval-label'],
        tasks: ['eval-task'],
        repositories: ['eval-repo'],
      },
    },
    evaluation: {
      evidence: 'independent',
      bins: 5,
      uncalibrated: { sampleCount: 1, brier: 0, ece: 0 },
      calibrated: { sampleCount: 1, brier: 0, ece: 0 },
    },
  }
  // A test profile 2b rejects breaks every gate test below: fail here.
  expect(parseCalibrationProfile(profile, limits)).toBeDefined()
  return {
    technique,
    family,
    file: `test-profiles/${technique}/${family}/test.json`,
    committedAt: '2026-10-22',
    labelSet: 'test-labels',
    profile,
  }
}

/** The real synthetic fit Lane L's suite reports: the gate must refuse it. */
function syntheticFitted(): { profile: CalibrationProfile; identity: CalibrationIdentity } {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../fixtures/judge/calibration/grouped-risk.json', import.meta.url),
      'utf8',
    ),
  )
  const parsed = parseCalibrationDataset(raw, limits)
  if (parsed.status !== 'valid') throw new Error(parsed.reason)
  const fitted = fitCalibration(parsed.dataset, 'platt', limits)
  if (fitted.status !== 'fitted') throw new Error(fitted.reason)
  const reported = reportCalibration(fitted.profile, parsed.dataset, 5, limits)
  if (reported.status !== 'reported') throw new Error(reported.reason)
  return { profile: reported.profile, identity: parsed.dataset.identity }
}

interface CheckCase {
  readonly check: AccuracyCheckId
  readonly decide: (rawProbability: number) => AccuracyOutput<unknown>
  readonly content: readonly string[]
}

const DISTINCTIVE = 'rlm125-nothing-judged-may-log'

function checkCases(): CheckCase[] {
  const profiles = ACCURACY_CHECKS.map((check) => testProfile(check))
  const base = { engine, profiles, limits }
  return [
    {
      check: 'risk.destructive',
      decide: (rawProbability) =>
        decideDestructive({
          ...base,
          rawProbability,
          inputs: { command: `${DISTINCTIVE}-wipe-disks-now` },
        }),
      content: [`${DISTINCTIVE}-wipe-disks-now`],
    },
    {
      check: 'edit.misfit',
      decide: (rawProbability) =>
        decideEdit({
          ...base,
          rawProbability,
          inputs: {
            request: `${DISTINCTIVE}-request-names-y`,
            paths: [`${DISTINCTIVE}-changed-path`],
            diff: `${DISTINCTIVE}-diff-excerpt`,
          },
        }),
      content: [
        `${DISTINCTIVE}-request-names-y`,
        `${DISTINCTIVE}-changed-path`,
        `${DISTINCTIVE}-diff-excerpt`,
      ],
    },
    {
      check: 'failure.unmentioned',
      decide: (rawProbability) =>
        decideFailures({
          ...base,
          rawProbability,
          inputs: {
            output: `${DISTINCTIVE}-tool-output`,
            reply: `${DISTINCTIVE}-reply-text`,
            marker: `${DISTINCTIVE}-lane-r-marker`,
          },
        }),
      content: [
        `${DISTINCTIVE}-tool-output`,
        `${DISTINCTIVE}-reply-text`,
        `${DISTINCTIVE}-lane-r-marker`,
      ],
    },
    {
      check: 'done.unbacked',
      decide: (rawProbability) =>
        decideDone({
          ...base,
          rawProbability,
          inputs: {
            reply: `${DISTINCTIVE}-done-reply`,
            tools: [`${DISTINCTIVE}-tool-kind`],
          },
        }),
      content: [`${DISTINCTIVE}-done-reply`, `${DISTINCTIVE}-tool-kind`],
    },
    {
      check: 'scope.outside',
      decide: (rawProbability) =>
        decideScope({
          ...base,
          rawProbability,
          inputs: {
            request: `${DISTINCTIVE}-scope-request`,
            path: `${DISTINCTIVE}-scope-path`,
            hunk: `${DISTINCTIVE}-hunk`,
          },
        }),
      content: [`${DISTINCTIVE}-scope-request`, `${DISTINCTIVE}-scope-path`, `${DISTINCTIVE}-hunk`],
    },
    {
      check: 'claim.inconsistent',
      decide: (rawProbability) =>
        decideConsistency({
          ...base,
          rawProbability,
          inputs: {
            claim: `${DISTINCTIVE}-claim`,
            excerpts: [`${DISTINCTIVE}-file-excerpt`],
          },
        }),
      content: [`${DISTINCTIVE}-claim`, `${DISTINCTIVE}-file-excerpt`],
    },
  ]
}

describe('fast judge accuracy checks', () => {
  it('mirrors the six check ids against the fast contract and the fitted families', () => {
    expect([...ACCURACY_CHECKS].toSorted(compareStrings)).toEqual([
      'claim.inconsistent',
      'done.unbacked',
      'edit.misfit',
      'failure.unmentioned',
      'risk.destructive',
      'scope.outside',
    ])
    for (const check of ACCURACY_CHECKS) {
      expect(FAST_DECISIONS).toContain(check)
      expect(CALIBRATION_FAMILIES).toContain(check)
    }
  })

  it('bars destructive at 0.8 and every other check at 0.9', () => {
    expect(CHECK_PRECISION_BAR).toEqual({
      'risk.destructive': JUDGE_FAST_DESTRUCTIVE_MIN_PRECISION,
      'edit.misfit': JUDGE_FAST_HINT_MIN_PRECISION,
      'failure.unmentioned': JUDGE_FAST_HINT_MIN_PRECISION,
      'done.unbacked': JUDGE_FAST_HINT_MIN_PRECISION,
      'scope.outside': JUDGE_FAST_HINT_MIN_PRECISION,
      'claim.inconsistent': JUDGE_FAST_HINT_MIN_PRECISION,
    })
    expect(JUDGE_FAST_DESTRUCTIVE_MIN_PRECISION).toBe(0.8)
    expect(JUDGE_FAST_HINT_MIN_PRECISION).toBe(0.9)
  })

  it('routes each check through its §7 channels, and caution is a latch bit only', () => {
    expect(ACCURACY_CHANNELS).toEqual({
      'risk.destructive': { hint: false, note: true, caution: true },
      'edit.misfit': { hint: true, note: false, caution: false },
      'failure.unmentioned': { hint: true, note: true, caution: false },
      'done.unbacked': { hint: false, note: true, caution: false },
      'scope.outside': { hint: true, note: true, caution: false },
      'claim.inconsistent': { hint: false, note: true, caution: false },
    })
    for (const channels of Object.values(ACCURACY_CHANNELS)) {
      // No allow, no hold text, no prose: the latch output is three bits.
      expect(Object.keys(channels).toSorted(compareStrings)).toEqual(['caution', 'hint', 'note'])
    }
  })

  it('shows every check at 0.99 with its channels, and logs its bar at 0.01', () => {
    for (const { check, decide } of checkCases()) {
      const shown = decide(0.99)
      expect(shown.kind).toBe('shown')
      if (shown.kind !== 'shown') continue
      expect(shown.check).toBe(check)
      expect(shown.probability).toBeCloseTo(0.99, 12)
      expect(shown.tier).toBe('exact')
      expect(shown.channels).toEqual(ACCURACY_CHANNELS[check])
      const logged = decide(0.01)
      expect(logged.kind).toBe('log-only')
      if (logged.kind !== 'log-only') continue
      expect(logged.record.check).toBe(check)
      expect(logged.record.engine).toEqual(engine)
      expect(logged.record.tier).toBe('exact')
      expect(logged.record.probability).toBeCloseTo(0.01, 12)
      expect(logged.record.bar).toBe(CHECK_PRECISION_BAR[check])
      expect(logged.record.reason).toBe('below-bar')
      // Exactly these fields: nowhere for judged content to hide.
      expect(Object.keys(logged.record).toSorted(compareStrings)).toEqual([
        'bar',
        'check',
        'engine',
        'probability',
        'reason',
        'tier',
      ])
    }
  })

  it('answers destructive at 0.85 while the 0.9 checks stay log-only', () => {
    for (const { check, decide } of checkCases()) {
      const output = decide(0.85)
      if (check === 'risk.destructive') {
        expect(output.kind).toBe('shown')
        if (output.kind !== 'shown') continue
        expect(output.channels.caution).toBe(true)
      } else {
        expect(output).toMatchObject({ kind: 'log-only', record: { reason: 'below-bar' } })
      }
    }
  })

  it('keeps a family off with its own profile-missing when nothing matches', () => {
    const output = runAccuracyCheck({
      check: 'edit.misfit',
      rawProbability: 0.99,
      engine,
      profiles: [],
      limits,
      slots: {},
    })
    expect(output).toEqual({
      kind: 'log-only',
      record: {
        check: 'edit.misfit',
        engine,
        bar: JUDGE_FAST_HINT_MIN_PRECISION,
        reason: 'profile-missing',
      },
    })
  })

  it("refuses a real synthetic fit with 2b's independent-evaluation rule", () => {
    const { profile, identity } = syntheticFitted()
    const output = runAccuracyCheck({
      check: 'risk.destructive',
      rawProbability: 0.99,
      engine: {
        providerId: identity.providerId,
        model: identity.model,
        endpoint: identity.endpoint,
        technique: identity.technique,
      },
      profiles: [
        {
          technique: identity.technique,
          family: identity.family,
          file: 'grouped-risk.json',
          committedAt: '2026-10-22',
          labelSet: 'synthetic-labels',
          profile,
        },
      ],
      limits,
      slots: {},
    })
    expect(output).toMatchObject({
      kind: 'log-only',
      record: { reason: 'independent-evaluation-required', tier: 'exact' },
    })
  })

  it('logs an invalid probability instead of judging it', () => {
    for (const rawProbability of [NaN, -0.5, 2]) {
      const output = runAccuracyCheck({
        check: 'scope.outside',
        rawProbability,
        engine,
        profiles: [testProfile('scope.outside')],
        limits,
        slots: {},
      })
      expect(output).toMatchObject({
        kind: 'log-only',
        record: { reason: 'invalid-probability' },
      })
    }
  })

  it('serves a borrowed family curve and says so in the tier', () => {
    const otherEngine: AccuracyEngine = {
      providerId: 'other-provider',
      model: 'other-model',
      endpoint: 'other-endpoint',
      technique: 'stated',
    }
    const output = runAccuracyCheck({
      check: 'edit.misfit',
      rawProbability: 0.99,
      engine,
      profiles: [testProfile('edit.misfit', otherEngine)],
      limits,
      slots: {},
    })
    expect(output.kind).toBe('shown')
    if (output.kind !== 'shown') return
    expect(output.tier).toBe('family')
    expect(output.engine).toEqual(engine)
  })

  it('logs no judged content from any check', () => {
    for (const { check, decide, content } of checkCases()) {
      const output = decide(0.01)
      expect(output.kind).toBe('log-only')
      if (output.kind !== 'log-only') continue
      const record = JSON.stringify(output.record)
      for (const judged of content) {
        expect(record.includes(judged)).toBe(false)
      }
      // The record still names the check, the engine, the bar and why.
      expect(output.record.check).toBe(check)
      expect(output.record.engine).toEqual(engine)
      expect(output.record.bar).toBe(CHECK_PRECISION_BAR[check])
      expect(output.record.reason).toBe('below-bar')
    }
  })

  it('maps the §6.4 choice to its unbacked event, and a malformed one to log-only', () => {
    expect(doneUnbackedProbability([0.1, 0.2, 0.7])).toBeCloseTo(0.9, 12)
    expect(doneUnbackedProbability([1, 0, 0])).toBe(0)
    const malformed = decideDone({
      inputs: { reply: 'done', tools: [] },
      rawProbability: doneUnbackedProbability([0.5, NaN, 0.5]),
      engine,
      profiles: [testProfile('done.unbacked')],
      limits,
    })
    expect(malformed).toMatchObject({
      kind: 'log-only',
      record: { reason: 'invalid-probability' },
    })
  })

  it('parses failure counts from the recorded exchanges, never from codes', () => {
    // The vitest header names 17 failed tests (vitest-failure.txt line 1).
    expect(parseFailureCount(fixture('vitest-failure.txt'))).toBe(17)
    // The summary names 17 failed tests, not the 1 failed file.
    expect(parseFailureCount(fixture('vitest-summary.txt'))).toBe(17)
    // An error code is not a count.
    expect(parseFailureCount(fixture('tsc-error.txt'))).toBeUndefined()
    expect(parseFailureCount(fixture('node-traceback.txt'))).toBeUndefined()
    expect(parseFailureCount(fixture('ls-missing.txt'))).toBeUndefined()
    expect(parseFailureCount(fixture('grep-nomatch.txt'))).toBeUndefined()
  })

  it("assembles each check's question state from its inputs, bounded", () => {
    const cap = JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS
    const long = (head: string): string => `${head}-${'x'.repeat(cap)}`
    const cases: {
      readonly state: string
      readonly heads: readonly string[]
      readonly maxLength: number
    }[] = [
      { state: destructiveState({ command: long('CMD') }), heads: ['CMD-'], maxLength: cap },
      {
        state: editState({ request: long('REQ'), paths: [long('PATH')], diff: long('DIFF') }),
        heads: ['REQ-', 'PATH-', 'DIFF-'],
        maxLength: 3 * cap + 2,
      },
      {
        state: failuresState({
          output: `OUTHEAD-${'x'.repeat(cap)}-OUTTAIL`,
          reply: long('REPLY'),
          marker: 'm',
        }),
        heads: ['OUTHEAD-', '-OUTTAIL', 'REPLY-'],
        maxLength: 2 * cap + 1,
      },
      {
        state: doneState({ reply: long('DONE'), tools: [long('TOOL')] }),
        heads: ['DONE-', 'TOOL-'],
        maxLength: 2 * cap + 1,
      },
      {
        state: scopeState({ request: long('SREQ'), path: long('SPATH'), hunk: long('HUNK') }),
        heads: ['SREQ-', 'SPATH-', 'HUNK-'],
        maxLength: 3 * cap + 2,
      },
      {
        state: scopeState({ request: 'r', path: 'p' }),
        heads: ['r', 'p'],
        maxLength: 3,
      },
      {
        state: consistencyState({ claim: long('CLAIM'), excerpts: [long('EXC')] }),
        heads: ['CLAIM-', 'EXC-'],
        maxLength: 2 * cap + 1,
      },
    ]
    for (const { state, heads, maxLength } of cases) {
      for (const head of heads) {
        expect(state.includes(head)).toBe(true)
      }
      expect(state.length).toBeLessThanOrEqual(maxLength)
    }
  })

  it('bounds every evidence field and keeps both ends of a long output', () => {
    const cap = JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS
    expect(boundEvidence('short')).toBe('short')
    const cut = boundEvidence('x'.repeat(cap + 100))
    expect(cut.length).toBe(cap)
    expect(cut.endsWith('...')).toBe(true)
    expect(joinEvidence(['a', 'b'])).toBe('a\nb')
    expect(joinEvidence(['x'.repeat(cap), 'y'.repeat(cap)]).length).toBe(cap)
    const long = `HEAD-${'x'.repeat(cap)}-TAIL`
    const kept = headTailEvidence(long)
    expect(kept.length).toBeLessThanOrEqual(cap)
    expect(kept.startsWith('HEAD-')).toBe(true)
    expect(kept.endsWith('-TAIL')).toBe(true)
    expect(kept.includes('...')).toBe(true)
    expect(kept.includes('x'.repeat(cap))).toBe(false)
    expect(headTailEvidence('short')).toBe('short')
  })
})
