// Real-use workflow logic (lane REALUSECI): the shipped steps file parses,
// malformed steps inputs are refused, the exec shape is fixed, and the keyless
// check exits nonzero on a planted violation, on missing input, and when a
// result path escapes through a symlinked directory. No key, no network: the
// live dispatch is the check's remaining proof.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildExecArgs,
  microUsdToString,
  parseStepsFile,
  REAL_USE_MODEL,
  RealUseInputError,
  resolveStepsFile,
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
    expect(steps[1]).toMatchObject({ mode: 'acceptEdits', expect: 'wrote hello.txt' })
    expect(steps[2]).toMatchObject({
      mode: 'plan',
      maxBudgetUsd: '0.01',
      expectStatus: 'budget_exceeded',
    })
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
  ]
  for (const [index, text] of bad.entries()) {
    it(`refuses malformed steps ${index}`, () => {
      expect(() => parseStepsFile(text)).toThrow(RealUseInputError)
    })
  }

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

function baseArgs(runDir, trapsDir) {
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
    'abc123',
    '--package-sha256',
    'deadbeef',
    '--traps-dir',
    trapsDir,
  ]
}

function baseTranscript() {
  return {
    version: 1,
    ref: 'abc123',
    packageSha256: 'deadbeef',
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
    // The steps file names three steps; this transcript records none.
    writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(baseTranscript()))
    const outcome = spawnSync(process.execPath, baseArgs(runDir, trapsDir), {
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
      baseArgs(path.join(root, 'no-such-dir'), path.join(root, 'no-traps')),
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
    const transcript = baseTranscript()
    transcript.steps = [
      { id: 'one-word', verdict: 'PASS', exitCode: 0, resultFile: 'evil/result.json' },
      { id: 'write-file', verdict: 'PASS', exitCode: 0, resultFile: 'evil/result.json' },
      { id: 'below-minimum', verdict: 'PASS', exitCode: 5, resultFile: 'evil/result.json' },
    ]
    writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(transcript))
    const outcome = spawnSync(process.execPath, baseArgs(runDir, trapsDir), {
      env: { ...process.env, RU_SENTINEL: 'sentinel' },
      encoding: 'utf8',
    })
    expect(outcome.status).toBe(1)
    expect(outcome.stderr).toContain('one-word')
  })
})
