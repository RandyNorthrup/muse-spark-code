// The Action sets no request limit unless the person sets max-requests, and
// honors any positive budget, count or deadline: the 30 default, the 500 and
// 360 maxima and the $20 ceiling were ours, not a provider's. Real Action
// modules only: no stand-ins.
import { describe, expect, it } from 'vitest'
import { InputError, parseActionInputs } from '../../action/lib/tools.mjs'
import { execArguments } from '../../action/lib/run-exec.mjs'

const baseEnv = () => ({ MUSE_INPUT_MAX_BUDGET_USD: '2.00' })
const withMaxRequests = (value) => ({ ...baseEnv(), MUSE_INPUT_MAX_REQUESTS: value })

describe('action exec bounds', () => {
  it('treats a missing or empty max-requests input as no request limit', () => {
    expect(parseActionInputs(baseEnv()).maxRequests).toBe(null)
    expect(parseActionInputs(withMaxRequests('')).maxRequests).toBe(null)
  })

  it('accepts any positive max-requests input with no maximum', () => {
    for (const value of ['1', '30', '500', '501', '1000000'])
      expect(parseActionInputs(withMaxRequests(value)).maxRequests).toBe(Number(value))
  })

  it('refuses a non-count max-requests input', () => {
    for (const value of ['0', '-1', 'abc', '30.5'])
      expect(() => parseActionInputs(withMaxRequests(value))).toThrow(InputError)
  })

  it('accepts a budget past 20 USD and refuses a non-positive one', () => {
    for (const value of ['20.01', '250.5'])
      expect(parseActionInputs({ MUSE_INPUT_MAX_BUDGET_USD: value }).maxBudgetUsd).toBe(value)
    for (const value of ['0', '-1', 'abc'])
      expect(() => parseActionInputs({ MUSE_INPUT_MAX_BUDGET_USD: value })).toThrow(InputError)
  })

  it('keeps the 20-minute deadline default and accepts any positive minutes', () => {
    expect(parseActionInputs(baseEnv()).timeoutMinutes).toBe(20)
    expect(
      parseActionInputs({ ...baseEnv(), MUSE_INPUT_TIMEOUT_MINUTES: '1000' }).timeoutMinutes,
    ).toBe(1000)
    for (const value of ['0', '-1', 'abc'])
      expect(() => parseActionInputs({ ...baseEnv(), MUSE_INPUT_TIMEOUT_MINUTES: value })).toThrow(
        InputError,
      )
  })

  it('forwards --max-requests only when the person set one', () => {
    const paths = {
      checkout: '/work',
      prompt: '/out/prompt.txt',
      diff: '/out/diff.patch',
      meta: '/out/meta.json',
    }
    const unset = execArguments({
      agentJs: '/agent/dist/acp.js',
      paths,
      inputs: parseActionInputs(baseEnv()),
    })
    expect(unset).not.toContain('--max-requests')
    const set = execArguments({
      agentJs: '/agent/dist/acp.js',
      paths,
      inputs: parseActionInputs(withMaxRequests('1000000')),
    })
    const at = set.indexOf('--max-requests')
    expect(at).toBeGreaterThan(-1)
    expect(set.slice(at, at + 2)).toEqual(['--max-requests', '1000000'])
  })
})
