import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { execAccountRequest, execAccountSelection } from '../../src/runtime/exec/execAccounts'
import { AccountPoolStoppedError } from '../../src/core/accounts/pool'
import { parseUsd } from '../../src/shared/usd'
import { poolRig, poolRequest, POOL_NOW } from './helpers/accounts/pool'

const flags = ['exec', '--backend', 'modelApi', '--max-budget-usd', '1']
const options = (isPoolOn: boolean, account = 'a') => ({
  account,
  accountPool: isPoolOn,
  keyFromStdin: false,
})
const blocked = {
  blocked: { reason: 'rateLimited', resetAt: new Date(POOL_NOW + 60_000).toISOString() },
} as const

describe('M108 headless account admission', () => {
  it('parses --account and --account-pool without changing default single-account options', () => {
    expect(
      parseCommandLine([...flags, '--account', 'work', '--account-pool', 'task']),
    ).toMatchObject({
      command: 'exec',
      options: { account: 'work', accountPool: true, budgetMicroUsd: 1_000_000 },
    })
    const defaultRun = parseCommandLine([...flags, 'task'])
    expect(defaultRun.command).toBe('exec')
    if (defaultRun.command !== 'exec') throw new Error('invalid fixture')
    expect(defaultRun.options).not.toHaveProperty('account')
    expect(defaultRun.options).not.toHaveProperty('accountPool')
    expect(execAccountSelection(defaultRun.options)).toEqual({
      account: 'default',
      hasPoolFlag: false,
      isInteractive: false,
    })
  })

  it.each(['work', '../key', 'WORK', 'account-secret-canary', ''])(
    'CI stdin credentials cannot select or pool account %j',
    (account) => {
      const parsed = parseCommandLine([...flags, '--key-stdin', '--account', account, 'task'])
      expect(parsed).toMatchObject({ command: 'invalid', exitCode: 2 })
      expect(JSON.stringify(parsed)).not.toContain('account-secret-canary')
    },
  )

  it('rejects invalid account identifiers in interactive-free CLI and programmatic requests', () => {
    for (const account of ['WORK', '../bad', '']) {
      expect(parseCommandLine([...flags, '--account', account, 'task'])).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
      expect(() => execAccountSelection({ account, keyFromStdin: false })).toThrow()
    }
  })

  it('rejects stdin pooling at parser and programmatic boundaries, before any provider request', () => {
    expect(parseCommandLine([...flags, '--key-stdin', '--account-pool', 'task'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    for (const config of [
      { keyFromStdin: true, accountPool: true },
      { keyFromStdin: true, account: 'work' },
    ]) {
      expect(() => execAccountSelection(config)).toThrow()
      expect(() => execAccountRequest(config, poolRequest())).toThrow()
    }
    expect(execAccountSelection({ keyFromStdin: true, account: 'default' })).toEqual({
      account: 'default',
      hasPoolFlag: false,
      isInteractive: false,
    })
    expect(parseCommandLine(['exec', '--account-pool', 'task'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    expect(parseCommandLine(['exec', '--account', 'work', 'task'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
  })

  it('requires the pool flag to swap at a user cap and keeps the selected account sticky', async () => {
    for (const isEnabled of [false, true]) {
      const h = poolRig()
      h.rows[0]!.thresholds = { requests: { day: 1 } }
      h.counts.set('a', 1)
      const request = execAccountRequest(options(isEnabled), poolRequest())
      expect(request.isInteractive).toBe(false)
      if (isEnabled) {
        expect(await h.pool.run(request, h.dispatch)).toBe('b')
        expect(await h.pool.run(request, h.dispatch)).toBe('b')
        expect(h.events).toMatchObject([{ type: 'swap', account: 'b', previousAccount: 'a' }])
      } else {
        await expect(h.pool.run(request, h.dispatch)).rejects.toBeInstanceOf(
          AccountPoolStoppedError,
        )
        expect(h.dispatch).not.toHaveBeenCalled()
      }
      expect(h.ask).not.toHaveBeenCalled()
    }
  })

  it('pools vendor limits only for on rows or an existing local full confirmation; never prompts headless', async () => {
    const allowed = poolRig()
    allowed.blocks.set('a', blocked)
    expect(
      await allowed.pool.run(execAccountRequest(options(true), poolRequest()), allowed.dispatch),
    ).toBe('b')
    for (const choice of ['absent', 'ownCapsOnly', 'confirm']) {
      const h = poolRig('meta', 'model-api')
      h.blocks.set('a', blocked)
      if (choice !== 'absent') {
        h.ask.mockResolvedValue(choice)
        await h.confirmations.obtain(h.policy(), true)
      }
      h.ask.mockClear()
      const request = execAccountRequest(options(true), poolRequest({ isInteractive: true }))
      if (choice === 'confirm') expect(await h.pool.run(request, h.dispatch)).toBe('b')
      else {
        await expect(h.pool.run(request, h.dispatch)).rejects.toMatchObject({
          decision: {
            kind: 'stop',
            reason: choice === 'absent' ? 'confirmation' : 'ownCapsOnly',
          },
        })
        expect(h.dispatch).not.toHaveBeenCalled()
      }
      expect(h.ask).not.toHaveBeenCalled()
    }
  })

  it('skips shared limit-group capacity and stops when every account is full', async () => {
    const h = poolRig()
    h.rows[0]!.limitGroup = 'team'
    h.rows[1]!.limitGroup = 'team'
    h.blocks.set('a', blocked)
    const request = execAccountRequest(options(true), poolRequest())
    expect(await h.pool.run(request, h.dispatch)).toBe('c')
    expect(h.dispatch.mock.calls[0]?.[0].account).toBe('c')
    h.blocks.set('c', blocked)
    await expect(h.pool.run(request, h.dispatch)).rejects.toMatchObject({
      resetAt: blocked.blocked.resetAt,
    })
    expect(h.dispatch).toHaveBeenCalledOnce()
  })

  it('retains exact estimates, shared parent budgets and uncertain liability across swaps', async () => {
    const h = poolRig()
    h.cap.value = parseUsd('0.15')
    h.rows[0]!.thresholds = { requests: { day: 1 } }
    const original = poolRequest({
      owner: 'run',
      budgetOwner: 'parent',
      estimate: { costUsd: parseUsd('0.1'), inputTokens: 1, outputTokens: 1, requests: 1 },
    })
    const request = execAccountRequest(options(true), original)
    expect(request.budgetOwner).toBe('parent')
    expect(request.estimate).toBe(original.estimate)
    expect(await h.pool.run(request, h.dispatch)).toBe('a')
    await expect(h.pool.run(request, h.dispatch)).rejects.toThrow('shared budget exceeded')
    expect(h.dispatch).toHaveBeenCalledOnce()
    expect(h.settled.get('a')).toBe(parseUsd('0.1'))
    const uncertain = poolRig()
    uncertain.rows[0]!.thresholds = { requests: { day: 1 } }
    await uncertain.pool.run(request, (admission) => {
      admission.beforeSend()
      return Promise.resolve({ value: 'sent', actualUsd: null })
    })
    expect(await uncertain.pool.run(request, uncertain.dispatch)).toBe('b')
    expect(uncertain.claims[0]).toMatchObject({ account: 'a', actual: null })
  })
})
