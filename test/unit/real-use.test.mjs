// Real-use workflow logic (lane REALUSECI): the shipped steps file parses,
// malformed steps inputs are refused, the exec shape is fixed, the verdict
// holds file and no-request expectations, the leak scan catches embedded
// keys, and the keyless check exits nonzero on a planted violation, on
// missing input, and when a result path escapes through a symlinked
// directory. No key, no network: the live dispatch is the check's remaining
// proof.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EXEC_TIMEOUT_MAX_SECONDS } from '../../action/lib/result.mjs'
import {
  buildExecArgs,
  checkNoLeak,
  checkRealUseRun,
  microUsdToString,
  parseBudgetUsd,
  parseStepsFile,
  REAL_USE_MODEL,
  REAL_USE_STEP_TIMEOUT_SECONDS,
  RealUseInputError,
  resolveStepsFile,
  verdictForStep,
} from '../../scripts/lib/real-use.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const checkScript = path.join(repoRoot, 'scripts', 'real-use-check.mjs')
const shippedSteps = path.join('docs', 'real-use', 'rc-2026-10-17.json')

const scratchRoots = []
afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), 'real-use-'))
  scratchRoots.push(root)
  return root
}

describe('tonight steps file', () => {
  it('names the CLI-runnable steps', () => {
    const steps = parseStepsFile(readFileSync(path.join(repoRoot, shippedSteps), 'utf8'))
    expect(steps.map((step) => step.id)).toEqual(['one-word', 'write-file', 'below-minimum'])
    expect(steps[0]).toMatchObject({ mode: 'plan', expect: 'quince' })
    expect(steps[1]).toMatchObject({
      mode: 'acceptEdits',
      expect: 'wrote hello.txt',
      expectFiles: ['hello.txt'],
    })
    expect(steps[2]).toMatchObject({
      mode: 'plan',
      maxBudgetUsd: '0.01',
      expectStatus: 'budget_exceeded',
      expectNoRequests: true,
    })
  })

  it('runs a step under the product CLI ceiling, never a repo time box', () => {
    expect(REAL_USE_STEP_TIMEOUT_SECONDS).toBe(EXEC_TIMEOUT_MAX_SECONDS)
  })
})

describe('steps validation', () => {
  const bad = [
    'not json',
    '{"version":2,"steps":[]}',
    '{"version":1,"steps":[]}',
    `{"version":1,"steps":[${'{"id":"a","mode":"plan","prompt":"x"},'.repeat(9).slice(0, -1)}]}`,
    '{"version":1,"steps":[{"id":"a","mode":"auto","prompt":"x"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x"},{"id":"a","mode":"plan","prompt":"y"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":""}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","maxBudgetUsd":"abc"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","maxBudgetUsd":"0"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","maxBudgetUsd":"21"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectStatus":"completedd"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectStatus":""}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectFiles":"hello.txt"}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectFiles":[]}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectFiles":["/etc/hostname"]}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectFiles":["../outside.txt"]}]}',
    '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectNoRequests":"yes"}]}',
  ]
  for (const [index, text] of bad.entries()) {
    it(`refuses malformed steps ${index}`, () => {
      expect(() => parseStepsFile(text)).toThrow(RealUseInputError)
    })
  }

  it('reads backslashes in expectFiles as forward slashes', () => {
    const steps = parseStepsFile(
      String.raw`{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","expectFiles":["sub\\hello.txt"]}]}`,
    )
    expect(steps[0].expectFiles).toEqual(['sub/hello.txt'])
  })

  it('confines the steps file under docs/real-use', () => {
    expect(resolveStepsFile(repoRoot, shippedSteps)).toBe(path.join(repoRoot, shippedSteps))
    for (const outside of [
      '../package.json',
      '/etc/hostname',
      'docs/other/steps.json',
      'docs/real-use/steps.txt',
    ]) {
      expect(() => resolveStepsFile(repoRoot, outside)).toThrow(RealUseInputError)
    }
  })
})

describe('budget grammar', () => {
  it('reads the CLI form, trailing zeros included', () => {
    expect(parseBudgetUsd('1.00')).toBe(1_000_000n)
    expect(parseBudgetUsd('0.01')).toBe(10_000n)
    expect(parseBudgetUsd('20')).toBe(20_000_000n)
    expect(parseBudgetUsd('abc')).toBeUndefined()
    expect(parseBudgetUsd('1.0000001')).toBeUndefined()
    expect(parseBudgetUsd('')).toBeUndefined()
  })

  it('accepts a trailing-zero step budget', () => {
    const steps = parseStepsFile(
      '{"version":1,"steps":[{"id":"a","mode":"plan","prompt":"x","maxBudgetUsd":"1.00"}]}',
    )
    expect(steps[0].maxBudgetUsd).toBe('1.00')
  })
})

describe('exec shape', () => {
  it('is fixed except mode, prompt file, remaining calls and dollars', () => {
    const args = buildExecArgs({
      agentJs: '/agent/dist/acp.js',
      workspace: '/work/workspace',
      mode: 'plan',
      promptFile: '/out/one-word/prompt.txt',
      budgetUsd: '1.00',
      maxRequests: 3,
      timeoutSeconds: 600,
    })
    expect(args).toEqual([
      '/agent/dist/acp.js',
      'exec',
      '--key-stdin',
      '--backend',
      'modelApi',
      '--cwd',
      '/work/workspace',
      '--permission-mode',
      'plan',
      '--output',
      'json',
      '--ephemeral',
      '--max-budget-usd',
      '1.00',
      '--max-requests',
      '3',
      '--timeout',
      '600',
      '--model',
      REAL_USE_MODEL,
      '--allow-contributor-models',
      '--prompt-file',
      '/out/one-word/prompt.txt',
    ])
    // The prompt text itself never reaches argv: stdin carries the key, so the
    // prompt travels by file.
    expect(args.some((arg) => arg.includes('quince'))).toBe(false)
  })

  it('formats micro-USD back to the budget grammar', () => {
    expect(microUsdToString(0n)).toBe('0')
    expect(microUsdToString(1_000_000n)).toBe('1')
    expect(microUsdToString(100n)).toBe('0.0001')
    expect(microUsdToString(108_135n)).toBe('0.108135')
    expect(microUsdToString(1_500_000n)).toBe('1.5')
  })
})

/**
 * Schematic exec results: validator inputs for `verdictForStep`, shaped to
 * the result schema's invariants (never presented as recorded product
 * output). Each override re-derives a failing or passing verdict.
 */
function schematicResult(overrides = {}) {
  const usage = {
    requests: 1,
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsd: {
      total: '0.01',
      settled: '0.01',
      uncertain: '0',
      reserved: '0',
      isUpperBound: false,
    },
    paid: {
      imageAttempts: 0,
      imagesReturned: 0,
      imagesRefunded: 0,
      imagesUncertain: 0,
      settledUsd: '0',
      uncertainUsd: '0',
    },
    ...overrides.usage,
  }
  const ledger = {
    capUsd: '1',
    breach: false,
    refusal: null,
    lastResponse: {
      n: 1,
      terminal: 'completed',
      incompleteReason: null,
      endedWithoutTerminal: false,
      httpStatus: null,
      transportError: null,
      usage: 'valid',
      settlement: 'priced',
    },
  }
  return {
    v: 2,
    status: 'completed',
    exitCode: 0,
    signal: null,
    stopReason: 'end_turn',
    terminal: 'completed',
    incompleteReason: null,
    backend: 'modelApi',
    mode: 'plan',
    model: REAL_USE_MODEL,
    sessionId: null,
    ephemeral: true,
    finalMessage: 'quince',
    filesChanged: ['hello.txt'],
    denials: [],
    questionsDeclined: 0,
    inputs: [],
    limits: { budgetUsd: '1', maxRequests: 3, timeoutSeconds: 600 },
    durationMs: 0,
    error: null,
    ...overrides,
    usage,
    ledger: overrides.ledger === undefined ? ledger : overrides.ledger,
  }
}

/** A schematic pre-dispatch refusal: valid, billed nothing, no accounting. */
function schematicRefusal(usageOverrides = {}) {
  return schematicResult({
    status: 'budget_exceeded',
    exitCode: 5,
    stopReason: 'budget',
    terminal: null,
    finalMessage: '',
    filesChanged: [],
    usage: {
      requests: 0,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      costUsd: null,
      paid: {
        imageAttempts: 0,
        imagesReturned: 0,
        imagesRefunded: 0,
        imagesUncertain: 0,
        settledUsd: '0',
        uncertainUsd: '0',
      },
      ...usageOverrides,
    },
    ledger: null,
    error: { kind: 'budget', message: 'refused before dispatch' },
  })
}

describe('verdict', () => {
  it('passes a completed step whose file the result lists', () => {
    const step = { expectStatus: 'completed', expect: 'quince', expectFiles: ['hello.txt'] }
    expect(verdictForStep(step, schematicResult(), 0)).toEqual({ verdict: 'PASS', reason: '' })
  })

  it('fails when an expected file is absent from the result', () => {
    const step = { expectStatus: 'completed', expect: 'quince', expectFiles: ['hello.txt'] }
    const result = schematicResult({ filesChanged: [] })
    expect(verdictForStep(step, result, 0)).toEqual({
      verdict: 'FAIL',
      reason: 'expected file absent',
    })
  })

  it('passes a refusal probe that sent nothing billable', () => {
    const step = { expectStatus: 'budget_exceeded', expectNoRequests: true }
    expect(verdictForStep(step, schematicRefusal(), 5)).toEqual({
      verdict: 'PASS',
      reason: '',
    })
  })

  it('fails a refusal probe that billed a request first', () => {
    const step = { expectStatus: 'budget_exceeded', expectNoRequests: true }
    const billed = schematicRefusal({ requests: 1 })
    expect(verdictForStep(step, billed, 5)).toEqual({
      verdict: 'FAIL',
      reason: 'expected no requests',
    })
  })
})

describe('whole-run check', () => {
  it('passes the shipped steps against schematic product results', () => {
    // Schematic validator inputs (never recorded product output): one valid
    // result per shipped step, sums matching the transcript. This is the
    // gate-can-go-green path, including the null-ledger refusal probe.
    const root = scratch()
    const runDir = path.join(root, 'out')
    const steps = parseStepsFile(readFileSync(path.join(repoRoot, shippedSteps), 'utf8'))
    const results = [
      schematicResult({ mode: 'plan', filesChanged: [] }),
      schematicResult({ mode: 'acceptEdits', finalMessage: 'wrote hello.txt' }),
      schematicRefusal(),
    ]
    const exitCodes = [0, 0, 5]
    const provenance = measuredProvenance()
    const transcript = {
      version: 1,
      ref: provenance.ref,
      packageSha256: provenance.sha,
      model: REAL_USE_MODEL,
      stated: { calls: 3, budgetUsd: '1.00' },
      actual: { calls: 2, costUsd: '0.02' },
      steps: steps.map((step, index) => ({
        id: step.id,
        verdict: 'PASS',
        exitCode: exitCodes[index],
        resultFile: `${step.id}/result.json`,
      })),
    }
    for (const [index, step] of steps.entries()) {
      mkdirSync(path.join(runDir, step.id), { recursive: true })
      writeFileSync(path.join(runDir, step.id, 'result.json'), JSON.stringify(results[index]))
    }
    const { failures } = checkRealUseRun({
      runDir,
      transcript,
      steps,
      stated: { calls: 3, budgetUsd: '1.00', refCommit: provenance.ref },
    })
    expect(failures).toEqual([])
  })
})

describe('leak scan', () => {
  it('catches a key inside JSON, not only a whole file', () => {
    const root = scratch()
    const embedded = path.join(root, 'result.json')
    writeFileSync(
      embedded,
      `${JSON.stringify({ finalMessage: `echo ${`LLM_${'x'.repeat(20)}`} done` })}\n`,
    )
    const whole = path.join(root, 'whole.txt')
    writeFileSync(whole, `${`LLM_${'x'.repeat(20)}`}\n`)
    const clean = path.join(root, 'clean.txt')
    writeFileSync(clean, 'nothing shaped like a credential here\n')
    expect(checkNoLeak([embedded], root, 'out', '')).toHaveLength(1)
    expect(checkNoLeak([whole], root, 'out', '')).toHaveLength(1)
    expect(checkNoLeak([clean], root, 'out', '')).toEqual([])
  })
})

// Provenance is measured from the test checkout at run time, never
// placeholders: no recorded transcript exists in the repository yet.
function measuredProvenance() {
  const ref = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
  if (ref.status !== 0) throw new Error('git rev-parse HEAD failed')
  const sha = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, shippedSteps)))
    .digest('hex')
  return { ref: ref.stdout.trim(), sha }
}

function baseArgs(runDir, trapsDir, provenance) {
  return [
    checkScript,
    '--run-dir',
    runDir,
    '--ref-root',
    repoRoot,
    '--steps-file',
    shippedSteps,
    '--expected-calls',
    '3',
    '--max-budget-usd',
    '1.00',
    '--ref-commit',
    provenance.ref,
    '--package-sha256',
    provenance.sha,
    '--traps-dir',
    trapsDir,
  ]
}

function baseTranscript(provenance) {
  return {
    version: 1,
    ref: provenance.ref,
    packageSha256: provenance.sha,
    model: REAL_USE_MODEL,
    stated: { calls: 3, budgetUsd: '1.00' },
    actual: { calls: 0, costUsd: '0' },
    steps: [],
  }
}

describe('keyless check as a child process', () => {
  it('fails a planted violation', () => {
    const root = scratch()
    const runDir = path.join(root, 'out')
    const trapsDir = path.join(root, 'traps')
    mkdirSync(runDir, { recursive: true })
    mkdirSync(trapsDir, { recursive: true })
    const provenance = measuredProvenance()
    // The steps file names three steps; this transcript records none.
    writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(baseTranscript(provenance)))
    const outcome = spawnSync(process.execPath, baseArgs(runDir, trapsDir, provenance), {
      env: { ...process.env, RU_SENTINEL: 'sentinel' },
      encoding: 'utf8',
    })
    expect(outcome.status).toBe(1)
    expect(outcome.stderr).toContain('do not match')
  })

  it('fails missing input', () => {
    const root = scratch()
    const outcome = spawnSync(
      process.execPath,
      baseArgs(path.join(root, 'no-such-dir'), path.join(root, 'no-traps'), measuredProvenance()),
      { env: { ...process.env, RU_SENTINEL: 'sentinel' }, encoding: 'utf8' },
    )
    expect(outcome.status).not.toBe(0)
  })

  it('refuses a result path through a symlinked directory', () => {
    const root = scratch()
    const runDir = path.join(root, 'out')
    const trapsDir = path.join(root, 'traps')
    const outside = path.join(root, 'outside')
    mkdirSync(runDir, { recursive: true })
    mkdirSync(trapsDir, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(outside, 'result.json'), '{"version":1}')
    // A symlink inside the run folder pointing outside: the transcript's
    // result path must not resolve through it.
    symlinkSync(outside, path.join(runDir, 'evil'), 'dir')
    const provenance = measuredProvenance()
    const transcript = baseTranscript(provenance)
    transcript.steps = [
      { id: 'one-word', verdict: 'PASS', exitCode: 0, resultFile: 'evil/result.json' },
      { id: 'write-file', verdict: 'PASS', exitCode: 0, resultFile: 'evil/result.json' },
      { id: 'below-minimum', verdict: 'PASS', exitCode: 5, resultFile: 'evil/result.json' },
    ]
    writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(transcript))
    const outcome = spawnSync(process.execPath, baseArgs(runDir, trapsDir, provenance), {
      env: { ...process.env, RU_SENTINEL: 'sentinel' },
      encoding: 'utf8',
    })
    expect(outcome.status).toBe(1)
    expect(outcome.stderr).toContain('one-word')
  })
})
