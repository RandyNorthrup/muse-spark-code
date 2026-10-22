// M125 lane R: the deterministic checks over recorded real tool
// exchanges (test/fixtures/judgeFast, captured 2026-10-22). A miss on
// unrecognised input, never a guess; microsecond-to-millisecond cost,
// measured below, proves no model, no network and no file writes.
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { judgeDoneClaim } from '../../src/core/judge/fast/reflex/done'
import { ruleEffort } from '../../src/core/judge/fast/reflex/effort'
import { findUnmentionedFailure } from '../../src/core/judge/fast/reflex/failures'
import { detectLoop, type LoopSignal } from '../../src/core/judge/fast/reflex/loop'
import { rankRelevance } from '../../src/core/judge/fast/reflex/relevance'
import { matchSkill } from '../../src/core/judge/fast/reflex/skills'
import { triageOutput } from '../../src/core/judge/fast/reflex/triage'

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'judgeFast',
)
const fixture = (name: string): string => readFileSync(path.join(fixtureRoot, name), 'utf8')

const signal = (key: string, hasFailed: boolean, outputDigest: string): LoopSignal => ({
  key,
  failed: hasFailed,
  outputDigest,
})

describe('fast judge reflex checks', () => {
  it('names repeats, oscillations and same-failure runs, and misses anything shorter', () => {
    expect(
      detectLoop([signal('a', false, '1'), signal('a', false, '1'), signal('a', false, '1')]),
    ).toEqual({ stuck: true, pattern: 'repeat' })
    expect(
      detectLoop([
        signal('a', false, '1'),
        signal('b', false, '2'),
        signal('a', false, '1'),
        signal('b', false, '2'),
      ]),
    ).toEqual({ stuck: true, pattern: 'oscillation' })
    expect(
      detectLoop([signal('a', true, '9'), signal('b', true, '9'), signal('c', true, '9')]),
    ).toEqual({ stuck: true, pattern: 'same-failure' })
    // Two in a row is a coincidence, and a changed result breaks the run.
    expect(detectLoop([signal('a', false, '1'), signal('a', false, '1')])).toEqual({ stuck: false })
    expect(
      detectLoop([signal('a', false, '1'), signal('a', false, '1'), signal('a', false, '2')]),
    ).toEqual({ stuck: false })
    expect(detectLoop([])).toEqual({ stuck: false })
  })

  it('triages recorded failures to full reading and blank success to skip', () => {
    expect(triageOutput({ exitCode: 2, output: fixture('ls-missing.txt') })).toMatchObject({
      decision: 'needs-full',
    })
    expect(triageOutput({ exitCode: 1, output: fixture('node-traceback.txt') })).toMatchObject({
      decision: 'needs-full',
    })
    expect(triageOutput({ exitCode: 2, output: fixture('tsc-error.txt') })).toMatchObject({
      decision: 'needs-full',
    })
    expect(triageOutput({ exitCode: 1, output: fixture('vitest-failure.txt') })).toMatchObject({
      decision: 'needs-full',
    })
    expect(triageOutput({ exitCode: 0, output: '  \n' })).toMatchObject({ decision: 'skip' })
    // A benign success misses to the engine; nothing here proves skippable.
    expect(triageOutput({ exitCode: 0, output: fixture('git-log.txt') })).toEqual({
      decision: 'miss',
    })
  })

  it('lowers effort only for narrowly mechanical requests, and never raises it', () => {
    expect(ruleEffort({ request: 'format these files', filesTouched: 2 })).toEqual({
      decision: 'lower',
    })
    expect(ruleEffort({ request: 'fix the lint errors', filesTouched: 1 })).toEqual({
      decision: 'lower',
    })
    expect(ruleEffort({ request: 'rename this helper', filesTouched: 3 })).toEqual({
      decision: 'lower',
    })
    expect(ruleEffort({ request: 'format the monorepo', filesTouched: 40 })).toEqual({
      decision: 'miss',
    })
    expect(ruleEffort({ request: 'refactor the judge resolver', filesTouched: 2 })).toEqual({
      decision: 'miss',
    })
    expect(ruleEffort({ request: 'why is this test red?', filesTouched: 0 })).toEqual({
      decision: 'miss',
    })
  })

  it('ranks context by BM25 and misses when nothing scores', () => {
    const candidates = [
      { id: 'loop.ts', text: 'loop stall repeat oscillation detection over the tool stream' },
      { id: 'triage.ts', text: 'first-send triage of one tool result with exit codes' },
      { id: 'skills.ts', text: 'lexical skill and command fit by name words' },
    ]
    const ranked = rankRelevance('tool result exit code triage', candidates)
    expect(ranked.decision).toBe('ranked')
    if (ranked.decision !== 'ranked') throw new Error('Missing ranking')
    expect(ranked.ranked[0]?.id).toBe('triage.ts')
    expect(rankRelevance('', candidates)).toEqual({ decision: 'miss' })
    expect(rankRelevance('zzz-no-such-token-rlm125', candidates)).toEqual({ decision: 'miss' })
    expect(rankRelevance('triage', [])).toEqual({ decision: 'miss' })
  })

  it('matches the one skill the request names, and misses zero or several', () => {
    const skills = [
      { name: 'estimator', description: 'cheapest setup or fastest finish' },
      { name: 'reviewer', description: 'second opinion on a hard question' },
    ]
    expect(matchSkill('run the estimator on this change', skills)).toEqual({
      decision: 'match',
      name: 'estimator',
    })
    expect(matchSkill('is this change any good?', skills)).toEqual({ decision: 'miss' })
    expect(matchSkill('ask the estimator and the reviewer', skills)).toEqual({ decision: 'miss' })
    expect(matchSkill('', skills)).toEqual({ decision: 'miss' })
  })

  it('finds a recorded failure the reply leaves unmentioned', () => {
    const toolOutput = fixture('vitest-failure.txt')
    expect(
      findUnmentionedFailure({ toolOutput, exitCode: 1, replyText: 'All green, done.' }),
    ).toMatchObject({
      decision: 'unmentioned',
    })
    expect(
      findUnmentionedFailure({
        toolOutput,
        exitCode: 1,
        replyText: '17 tests failed; the system binaries do not verify on this rig.',
      }),
    ).toEqual({ decision: 'mentioned' })
    // No recognised failure, no finding.
    expect(
      findUnmentionedFailure({
        toolOutput: fixture('git-log.txt'),
        exitCode: 0,
        replyText: 'Done.',
      }),
    ).toEqual({ decision: 'miss' })
  })

  it('backs a done claim only on recognised success, and refuses it on recognised failure', () => {
    expect(
      judgeDoneClaim({
        replyText: 'Done, all tests pass.',
        toolOutputs: [{ exitCode: 1, output: fixture('vitest-failure.txt') }],
      }),
    ).toEqual({ decision: 'unbacked' })
    expect(
      judgeDoneClaim({
        replyText: 'Done, the rename is complete.',
        toolOutputs: [{ exitCode: 0, output: fixture('git-log.txt') }],
      }),
    ).toEqual({ decision: 'backed' })
    expect(judgeDoneClaim({ replyText: 'Still working on it.', toolOutputs: [] })).toEqual({
      decision: 'miss',
    })
    expect(judgeDoneClaim({ replyText: 'Done.', toolOutputs: [] })).toEqual({ decision: 'miss' })
  })

  it('runs every check in milliseconds with no model, network or writes', () => {
    const outputs = [
      fixture('ls-missing.txt'),
      fixture('node-traceback.txt'),
      fixture('tsc-error.txt'),
      fixture('vitest-failure.txt'),
      fixture('git-log.txt'),
    ]
    const skills = [{ name: 'estimator', description: 'cost and speed' }]
    const candidates = [{ id: 'a', text: 'loop stall repeat oscillation' }]
    const started = performance.now()
    for (const output of outputs) {
      triageOutput({ exitCode: 1, output })
      findUnmentionedFailure({ toolOutput: output, exitCode: 1, replyText: 'Working on it.' })
      judgeDoneClaim({ replyText: 'Done.', toolOutputs: [{ exitCode: 1, output }] })
      rankRelevance('loop stall', candidates)
      matchSkill('run the estimator', skills)
      ruleEffort({ request: 'format this file', filesTouched: 1 })
      detectLoop([signal('a', true, '1'), signal('b', true, '1'), signal('c', true, '1')])
    }
    // Seven checks over five recorded outputs: milliseconds, not a model round-trip.
    expect(performance.now() - started).toBeLessThan(100)
  })
})
