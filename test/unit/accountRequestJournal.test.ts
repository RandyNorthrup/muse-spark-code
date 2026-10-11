import { removeTestFolders } from './helpers/tempFolders'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRequestJournal } from '../../src/runtime/providers/accountRequestJournal'
import { Usd } from '../../src/shared/usd'
import { parseUsd } from '../../src/shared/accountUsd'
import { poolAccount, poolRequest, POOL_NOW } from './helpers/accounts/pool'
import { UI_TEXT } from '../../src/shared/constants'

const folders: string[] = []
afterEach(() => {
  removeTestFolders(folders)
})
function rig() {
  const folder = mkdtempSync(path.join(tmpdir(), 'cm1082-journal-'))
  folders.push(folder)
  let now = POOL_NOW
  const journal = new AccountRequestJournal(folder, () => now)
  const request = poolRequest({ checkSharedCaps: () => undefined })
  const query = {
    provider: 'meta',
    account: 'a',
    start: '2026-10-06T00:00:00Z',
    end: '2026-10-07T00:00:00Z',
  }
  return {
    folder,
    journal,
    request,
    query,
    advance: () => {
      now += 86_400_000
    },
  }
}

describe('durable account request journal', () => {
  it('recovers an exact durable receipt before claim closure without reserving or charging twice', async () => {
    const t = rig()
    const claim = t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    claim.started?.()
    t.journal.receipt(t.request, { inputTokens: 2, outputTokens: 1 }, Usd.from('0.03').toAmount())
    const recovered = new AccountRequestJournal(t.folder, () => POOL_NOW)
    expect(recovered.read(t.query)).toMatchObject({
      settledUsd: '0.03',
      reservedUsd: '0',
      uncertainUsd: '0',
      requests: 1,
    })
    await claim.settle(null, true)
    expect(recovered.read(t.query).settledUsd).toBe('0.03')
    expect(
      recovered.read({ ...t.query, start: '2026-10-07T00:00:00Z', end: '2026-10-08T00:00:00Z' })
        .settledUsd,
    ).toBe('0')
  })
  it('keeps pending counters across midnight and attributes the send to its actual day', async () => {
    const t = rig()
    const claim = t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    t.advance()
    const today = { ...t.query, start: '2026-10-07T00:00:00Z', end: '2026-10-08T00:00:00Z' }
    expect(t.journal.read(today).requests).toBe(1)
    claim.started?.()
    await claim.settle(parseUsd('0.1'), true)
    expect(t.journal.read(today)).toMatchObject({ requests: 1, settledUsd: '0.1' })
    expect(t.journal.read(t.query).requests).toBe(0)
  })

  it('retains deleted-account group limits and concurrent reset records through restart', () => {
    const t = rig()
    const reset = '2026-10-06T13:00:00Z'
    t.journal.block('meta', 'deleted', reset, {
      account: 'deleted',
      limitGroup: 'team',
      scope: 'group',
      expiresAt: Date.parse(reset),
    })
    const other = new AccountRequestJournal(t.folder, () => POOL_NOW)
    other.block('meta', 'deleted', '2026-10-06T12:30:00Z')
    expect(other.limits('meta', 'b', { id: 'b', limitGroup: 'team' })).toMatchObject({
      blocked: { resetAt: reset },
    })
    expect(other.limits('meta', 'c', { id: 'c', limitGroup: 'other' })).toEqual({})
  })

  it('refuses linked or damaged rows with fixed error text, without reading linked content', () => {
    const t = rig()
    const source = path.join(t.folder, 'private-test-text')
    writeFileSync(
      source,
      JSON.stringify({
        provider: 'meta',
        account: 'a',
        time: new Date(POOL_NOW).toISOString(),
        reservedUsd: '0',
        settledUsd: '0',
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
        hasSent: false,
        isClosed: true,
      }),
    )
    linkSync(source, path.join(t.folder, 'claim-linked.json'))
    expect(() => t.journal.read(t.query)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })
  it('retains outstanding liability across day reset and restart without double counting its own projection', async () => {
    const t = rig()
    const claim = t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    expect(t.journal.read(t.query).reservedUsd).toBe('0.1')
    expect(claim.journal.read(t.query).reservedUsd).toBe('0')
    const restarted = new AccountRequestJournal(t.folder, () => POOL_NOW)
    expect(
      restarted.read({ ...t.query, start: '2026-10-07T00:00:00Z', end: '2026-10-08T00:00:00Z' })
        .reservedUsd,
    ).toBe('0.1')
    await claim.settle(null, true)
    expect(restarted.read(t.query)).toMatchObject({
      reservedUsd: '0',
      uncertainUsd: '0.1',
      requests: 1,
    })
  })
  it('settles exact receipt money and counters while refunded nonsends charge nothing', async () => {
    const t = rig()
    const first = t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    const exact = Usd.from('0.000000000000000001').toAmount()
    t.journal.receipt(t.request, { inputTokens: 2, outputTokens: 1 }, exact)
    await first.settle(parseUsd(exact), true)
    const second = t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    await second.settle(0n, false)
    expect(t.journal.read(t.query)).toMatchObject({
      settledUsd: exact,
      reservedUsd: '0',
      uncertainUsd: '0',
      inputTokens: 2,
      outputTokens: 1,
      requests: 1,
    })
  })
  it('refuses corrupt projections and preserves latest Retry-After across readers', () => {
    const t = rig()
    t.journal.block('meta', 'a', '2026-10-06T13:00:00Z')
    t.journal.block('meta', 'a', '2026-10-06T12:30:00Z')
    expect(new AccountRequestJournal(t.folder, () => POOL_NOW).limits('meta', 'a')).toMatchObject({
      blocked: { resetAt: '2026-10-06T13:00:00Z' },
    })
    t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    const claim = readdirSync(t.folder).find((file) => file.startsWith('claim-'))
    if (claim === undefined) throw new Error('missing claim')
    writeFileSync(path.join(t.folder, claim), '{broken')
    expect(() => t.journal.read(t.query)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })
  it('ranks configured request headroom and outstanding work, keeping original shared cap callback', () => {
    const t = rig()
    const a = poolAccount('a', 0),
      b = poolAccount('b', 1)
    a.thresholds = { requests: { day: 2 } }
    b.thresholds = { requests: { day: 10 } }
    t.journal.reserve('meta', 'a', t.request.estimate, t.request)
    expect(t.journal.headroom(a, 'meta')).toBeLessThan(t.journal.headroom(b, 'meta'))
    expect(() => t.journal.reserve('meta', 'b', t.request.estimate, poolRequest())).toThrow()
  })
})
