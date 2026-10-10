// Lane CM80CI: structural validators for the four non-GitHub CI templates.
// Each template must stay equivalent to the GitHub Action's documented
// inputs (action/action.yml), pass the key only to the run step over private
// stdin, and refuse forks/untrusted runs through that system's mechanism.
// The runner module is the single source of defaults; templates carry them.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CI_DEFAULTS,
  InputError,
  MODEL_API_KEY_PATTERN,
  execArguments,
  parseRunnerInputs,
  statusForExitCode,
  takeModelApiKey,
  toExecPair,
  toPosix,
} from '../../ci-templates/muse-spark-run.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const template = (name: string) => readFileSync(path.join(ROOT, 'ci-templates', name), 'utf8')

const TEMPLATES = [
  'gitlab-ci.yml',
  'azure-pipelines.yml',
  'Jenkinsfile',
  'bitbucket-pipelines.yml',
] as const

function baseEnv() {
  return {
    MUSE_UNTRUSTED: 'false',
    MUSE_MODE: 'review',
    MUSE_MAX_BUDGET_USD: '2.00',
    MUSE_PROMPT: 'Review this workspace.',
  } as Record<string, string>
}

describe('ci template files', () => {
  it.each([...TEMPLATES])(
    'shares one runner: %s installs before running, with no secret at install',
    (name) => {
      const text = template(name)
      expect(text).toContain('ci-templates/muse-spark-run.mjs')
      expect(text).toContain('--install-only')
      expect(text.indexOf('--install-only')).toBeLessThan(
        text.lastIndexOf('ci-templates/muse-spark-run.mjs'),
      )
      const installLine = text.split('\n').find((line) => line.includes('--install-only'))
      expect(installLine).toBeDefined()
      expect(installLine).not.toContain('MODEL_API_KEY')
    },
  )

  it.each([...TEMPLATES])('never echoes the key: %s', (name) => {
    const text = template(name)
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
      if (line.includes('KEY') && /(^|\s)(echo|print|Write-Host|Write-Output)\b/.test(line)) {
        throw new Error(`key printed in ${name}: ${line}`)
      }
    }
    expect(text).toContain('Never echo it')
  })

  it.each([...TEMPLATES])('carries the Action-parity defaults: %s', (name) => {
    const text = template(name)
    expect(text).toContain(CI_DEFAULTS.mode)
    expect(text).toContain(CI_DEFAULTS.maxRequests)
    expect(text).toContain(CI_DEFAULTS.timeoutMinutes)
    expect(text).toContain(CI_DEFAULTS.maxDiffBytes)
    expect(text).toContain(CI_DEFAULTS.agentVersion)
    expect(text).toContain('MUSE_MAX_BUDGET_USD')
    expect(text).toContain('MUSE_IMAGE_GENERATION')
    expect(text).toContain('MUSE_ALLOW_CONTRIBUTOR_MODELS')
  })

  it('gitlab refuses fork merge requests through project-path rules', () => {
    const text = template('gitlab-ci.yml')
    expect(text).toContain('MUSE_UNTRUSTED')
    expect(text).toContain('CI_MERGE_REQUEST_SOURCE_PROJECT_PATH')
    expect(text).toContain('Masked')
    expect(text).toContain('Protected')
  })

  it('azure refuses fork pull requests through IsFork', () => {
    const text = template('azure-pipelines.yml')
    expect(text).toContain('MUSE_UNTRUSTED')
    expect(text).toContain('System.PullRequest.IsFork')
    expect(text).toMatch(/secret/i)
  })

  it('jenkins binds the key only around the run stage and checks CHANGE_FORK', () => {
    const text = template('Jenkinsfile')
    expect(text).toContain('MUSE_UNTRUSTED')
    expect(text).toContain('CHANGE_FORK')
    expect(text).toContain("withCredentials([string(credentialsId: 'muse-model-api-key'")
    // The binding must wrap only the run stage, after the install stage.
    expect(text.indexOf("stage('Install the agent')")).toBeLessThan(
      text.indexOf("stage('Run Muse Spark')"),
    )
    expect(text.indexOf("stage('Run Muse Spark')")).toBeLessThan(
      text.indexOf('withCredentials([string'),
    )
  })

  it('bitbucket marks pull-request builds untrusted via BITBUCKET_PR_ID', () => {
    const text = template('bitbucket-pipelines.yml')
    expect(text).toContain('MUSE_UNTRUSTED')
    expect(text).toContain('BITBUCKET_PR_ID')
    expect(text).toContain('Secured')
  })
})

describe('runner input parity with the Action', () => {
  it('accepts the documented budget grammar and range', () => {
    for (const budget of ['2.00', '0.000001', '20', '20.000000']) {
      expect(parseRunnerInputs({ ...baseEnv(), MUSE_MAX_BUDGET_USD: budget }).maxBudgetUsd).toBe(
        budget,
      )
    }
    for (const budget of [
      '',
      '0',
      '0.00',
      '20.000001',
      '21',
      '-1',
      '2.0000000',
      ' 2',
      '2 ',
      '1e3',
      '$2',
    ]) {
      expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_MAX_BUDGET_USD: budget })).toThrow(
        InputError,
      )
    }
  })

  it('parses mode, requests, timeout, diff bytes, effort and model like the Action', () => {
    expect(parseRunnerInputs(baseEnv()).mode).toBe('review')
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_MODE: 'auto' })).toThrow(InputError)
    expect(parseRunnerInputs({ ...baseEnv(), MUSE_MAX_REQUESTS: '500' }).maxRequests).toBe(500)
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_MAX_REQUESTS: '501' })).toThrow(InputError)
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_TIMEOUT_MINUTES: '0' })).toThrow(InputError)
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_MAX_DIFF_BYTES: '1048577' })).toThrow(
      InputError,
    )
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_EFFORT: 'ultra' })).toThrow(InputError)
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_MODEL: 'not a model!' })).toThrow(
      InputError,
    )
  })

  it('refuses image generation in review mode, as the Action does', () => {
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_IMAGE_GENERATION: 'true' })).toThrow(
      InputError,
    )
    expect(
      parseRunnerInputs({ ...baseEnv(), MUSE_MODE: 'fix', MUSE_IMAGE_GENERATION: 'true' })
        .imageGeneration,
    ).toBe(true)
  })

  it('requires exactly one prompt source', () => {
    expect(() => parseRunnerInputs({ ...baseEnv(), MUSE_PROMPT: '' })).toThrow(InputError)
    const both = { ...baseEnv(), MUSE_PROMPT_FILE: 'ci-templates/gitlab-ci.yml' }
    expect(() => parseRunnerInputs(both)).toThrow(InputError)
    expect(() =>
      parseRunnerInputs({
        ...baseEnv(),
        MUSE_PROMPT: '',
        MUSE_PROMPT_FILE: 'ci-templates/no-such-file.yml',
      }),
    ).toThrow(InputError)
  })

  it('reads the prompt from a file when asked', () => {
    const inputs = parseRunnerInputs({
      ...baseEnv(),
      MUSE_PROMPT: '',
      MUSE_PROMPT_FILE: path.join(ROOT, 'ci-templates', 'gitlab-ci.yml'),
    })
    expect(inputs.promptText.length).toBeGreaterThan(0)
  })
})

describe('runner key handling', () => {
  it('accepts the Action key shape, strips one LF, and deletes the variable', () => {
    const env = { MUSE_SPARK_MODEL_API_KEY: 'LLM_abcdefghijklmnop\n' } as Record<string, string>
    expect(takeModelApiKey(env)).toBe('LLM_abcdefghijklmnop')
    expect(env).not.toContain('MUSE_SPARK_MODEL_API_KEY')
    expect(MODEL_API_KEY_PATTERN.test('LLM_abcdefghijklmnop')).toBe(true)
  })

  it('refuses empty, multi-line, oversize or malformed keys without echoing', () => {
    for (const key of [
      '',
      'LLM_short',
      'not-a-key',
      'LLM_abcdefghijklmnop\nsecond',
      'LLM_abc\rdef',
    ]) {
      const env = { MUSE_SPARK_MODEL_API_KEY: key }
      expect(takeModelApiKey(env)).toBeUndefined()
      expect(env).not.toContain('MUSE_SPARK_MODEL_API_KEY')
    }
    const big = { MUSE_SPARK_MODEL_API_KEY: `LLM_${'x'.repeat(4096)}` }
    expect(takeModelApiKey(big)).toBeUndefined()
  })
})

describe('runner exec argv and exit codes', () => {
  it('builds the Action-equivalent argv with the prompt last', () => {
    const args = execArguments(parseRunnerInputs(baseEnv()))
    expect(args.slice(0, 4)).toEqual(['exec', '--key-stdin', '--backend', 'modelApi'])
    expect(args).toContain('--ephemeral')
    expect(args).toContain('json')
    expect(args).toContain('2.00')
    expect(args).not.toContain('--model')
    expect(args.at(-1)).toBe('Review this workspace.')
    const fix = execArguments(
      parseRunnerInputs({
        ...baseEnv(),
        MUSE_MODE: 'fix',
        MUSE_MODEL: 'muse-spark-1',
        MUSE_EFFORT: 'low',
      }),
    )
    expect(fix).toContain('acceptEdits')
    expect(fix).toContain('muse-spark-1')
    expect(fix).toContain('low')
  })

  it('maps every documented exit code to the docs/ci.md status word', () => {
    expect([
      statusForExitCode(0),
      statusForExitCode(2),
      statusForExitCode(3),
      statusForExitCode(4),
      statusForExitCode(5),
      statusForExitCode(6),
      statusForExitCode(7),
      statusForExitCode(8),
      statusForExitCode(9),
      statusForExitCode(130),
      statusForExitCode(143),
      statusForExitCode(1),
    ]).toEqual([
      'completed',
      'no_result',
      'auth_required',
      'failed',
      'budget_exceeded',
      'timeout',
      'denied',
      'incomplete',
      'accounting_unverified',
      'cancelled',
      'cancelled',
      'internal',
    ])
  })

  it('runs .js entries under this Node and bins directly', () => {
    const [node, prefix] = toExecPair('/tmp/fake-agent.mjs')
    expect(node).toBe(process.execPath)
    expect(prefix).toEqual(['/tmp/fake-agent.mjs'])
    expect(toExecPair('muse-spark-code-acp')).toEqual(['muse-spark-code-acp', []])
  })

  it('normalises Windows separators before comparing paths', () => {
    expect(toPosix(String.raw`muse-spark-out\run-summary.json`)).toBe(
      'muse-spark-out/run-summary.json',
    )
    expect(toPosix(String.raw`C:\Users\ci\out`)).toBe('C:/Users/ci/out')
  })
})
