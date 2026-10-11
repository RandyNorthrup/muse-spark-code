import { describe, expect, it } from 'vitest'
import { poolRig, poolRequest } from './helpers/accounts/pool'
import { AccountPool } from '../../src/core/accounts/pool'

describe('installed account boundary controls', () => {
  it('queues manual choice while admitted A keeps its payer through final send and settlement', async () => {
    const t = poolRig()
    const a = await t.pool.acquire(poolRequest())
    t.pool.useNext('conversation', 'main', 'b', () => true)
    expect(t.pool.current('conversation', 'main')).toBe('b')
    a.beforeSend()
    await a.settle(0n)
    const b = await t.pool.acquire(poolRequest())
    expect(a.account).toBe('a')
    expect(b.account).toBe('b')
    await b.settle(0n)
  })
  it('holds admission and final dispatch, refunds nonsends, and rejects stale queued selection', async () => {
    const t = poolRig()
    let isHeld = true
    const pool = new AccountPool({ ...t.pool.deps, isHeld: () => isHeld })
    await expect(pool.acquire(poolRequest())).rejects.toThrow()
    expect(t.claims).toHaveLength(0)
    isHeld = false
    const lease = await pool.acquire(poolRequest())
    expect(() => {
      pool.useNext('conversation', 'main', 'b', () => false)
    }).toThrow()
    isHeld = true
    expect(() => {
      lease.beforeSend()
    }).toThrow()
    await lease.settle(null)
    expect(t.claims[0]?.actual).toBe(0n)
  })
})
