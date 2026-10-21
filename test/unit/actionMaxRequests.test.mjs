import { expect, it } from 'vitest'
import { isExecResult } from '../../action/lib/result.mjs'
import { execArguments } from '../../action/lib/run-exec.mjs'
import { InputError, parseActionInputs } from '../../action/lib/tools.mjs'

// No default request limit (NOLIMITS5B): without a max-requests input the
// Action sets no request limit, like the CLI after NOLIMITS5. A set value is
// any positive safe integer and is the only case forwarded to exec.

const baseEnv = () => ({ MUSE_INPUT_MAX_BUDGET_USD: '2.00' })

const withMaxRequests = (value) => {
  const env = baseEnv()
  if (value !== undefined) env.MUSE_INPUT_MAX_REQUESTS = value
  return env
}

const argvFor = (maxRequestsValue) => {
  const inputs = parseActionInputs(withMaxRequests(maxRequestsValue))
  return execArguments({
    agentJs: '/agent/muse-spark-code-acp.mjs',
    paths: {
      checkout: '/checkout',
      prompt: '/work/prompt.txt',
      diff: '/work/pr.diff',
      meta: '/work/pr.md',
    },
    inputs,
  })
}

it('treats a missing or empty max-requests input as no request limit', () => {
  expect(parseActionInputs(withMaxRequests()).maxRequests).toBe(null)
  expect(parseActionInputs(withMaxRequests('')).maxRequests).toBe(null)
})

it('accepts any positive max-requests input with no maximum', () => {
  expect(parseActionInputs(withMaxRequests('1')).maxRequests).toBe(1)
  expect(parseActionInputs(withMaxRequests('30')).maxRequests).toBe(30)
  expect(parseActionInputs(withMaxRequests('500')).maxRequests).toBe(500)
  expect(parseActionInputs(withMaxRequests('501')).maxRequests).toBe(501)
  expect(parseActionInputs(withMaxRequests('1000000')).maxRequests).toBe(1_000_000)
})

it('refuses a non-count max-requests input without naming a value', () => {
  for (const value of ['0', '-1', 'abc', '30.5']) {
    expect(() => parseActionInputs(withMaxRequests(value))).toThrow(InputError)
  }
})

it('forwards --max-requests to exec only when the person set one', () => {
  const unset = argvFor()
  expect(unset).not.toContain('--max-requests')
  expect(unset.includes('null')).toBe(false)
  const set = argvFor('30')
  const flag = set.indexOf('--max-requests')
  expect(flag).toBeGreaterThan(-1)
  expect(set[flag + 1]).toBe('30')
})

const pricedResponse = {
  n: 1,
  terminal: 'completed',
  incompleteReason: null,
  endedWithoutTerminal: false,
  httpStatus: 200,
  transportError: null,
  usage: 'valid',
  settlement: 'priced',
}

const completedResult = (limits) => ({
  v: 2,
  status: 'completed',
  exitCode: 0,
  signal: null,
  stopReason: 'end_turn',
  terminal: 'completed',
  incompleteReason: null,
  backend: 'modelApi',
  mode: 'plan',
  model: 'muse-spark-1.3',
  sessionId: null,
  ephemeral: true,
  finalMessage: 'done',
  filesChanged: [],
  denials: [],
  questionsDeclined: 0,
  inputs: [],
  usage: {
    requests: 3,
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 10,
    reasoningTokens: 5,
    costUsd: { settled: '0.1', uncertain: '0', reserved: '0', total: '0.1', isUpperBound: false },
    paid: {
      imageAttempts: 0,
      imagesReturned: 0,
      imagesRefunded: 0,
      imagesUncertain: 0,
      settledUsd: '0',
      uncertainUsd: '0',
    },
  },
  ledger: { capUsd: '0.25', breach: false, refusal: null, lastResponse: pricedResponse },
  limits,
  durationMs: 1000,
  error: null,
})

it('accepts a completed Model API run that carries no request cap', () => {
  const limits = { budgetUsd: '0.25', maxRequests: null, timeoutSeconds: 1200 }
  expect(isExecResult(completedResult(limits))).toBe(true)
})

it('still refuses a completed run without its budget accounting', () => {
  const limits = { budgetUsd: null, maxRequests: null, timeoutSeconds: 1200 }
  expect(isExecResult(completedResult(limits))).toBe(false)
})
