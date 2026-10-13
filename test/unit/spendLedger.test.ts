import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { createSpendLedger, type LedgerScope } from '../../src/core/paid/spendLedger'
import { currentProcessOwner } from '../../src/core/locks/processOwner'
import { Usd } from '../../src/shared/usd'
const roots: string[] = []
const usd = (value: string | number) => Usd.from(value).toAmount()
function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'ledger-v3-'))
  roots.push(directory)
  const scope: LedgerScope = { directory, id: 'day' }
  const ledger = createSpendLedger({
    sleep: delay,
    initial: () => Promise.resolve({ settled: usd(0), unknownHistory: false }),
  })
  return { scope, ledger }
}
afterAll(() => {
  for (const directory of roots) rmSync(directory, { recursive: true, force: true })
})
describe('one spend ledger', () => {
  it('refuses without creating a claim or changing the generation', async () => {
    const { scope, ledger } = setup()
    await ledger.admit(scope, usd(1), usd(1))
    const before = readFileSync(path.join(scope.directory, 'state.json'), 'utf8')
    await expect(ledger.admit(scope, usd(1), usd(1))).rejects.toMatchObject({
      kind: 'budget',
      facts: { bound: '1', total: '1', cap: '1' },
    })
    expect(readFileSync(path.join(scope.directory, 'state.json'), 'utf8')).toBe(before)
    expect(readdirSync(path.join(scope.directory, 'audit'))).toHaveLength(1)
  })
  it('admits every fitting request and no extra request', async () => {
    for (const k of [1, 2, 3]) {
      const { scope, ledger } = setup()
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => ledger.admit(scope, usd(1), usd(k))),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(k)
      const readTotal1 = await ledger.read(scope)
      expect(readTotal1.spentUsd).toBe(usd(k))
    }
  })
  it('each state counts its sole amount, and settlement cannot erase another attempt', async () => {
    const { scope, ledger } = setup()
    const first = await ledger.admit(scope, usd(2), usd(10))
    first.markSent()
    await first.settle('uncertain', usd('0.1'))
    const retry = await ledger.admit(scope, usd(2), usd(10))
    retry.markSent()
    await retry.settle('settled', usd('0.3'))
    const unsent = await ledger.admit(scope, usd(1), usd(10))
    await unsent.settle('released', usd(0))
    expect(await ledger.read(scope)).toMatchObject({
      spentUsd: '2.3',
      uncertainUsd: '2',
      heldUsd: '0',
      openClaims: 0,
    })
  })
  it('settles overage immediately and keeps exact decimal totals', async () => {
    const { scope, ledger } = setup()
    const claim = await ledger.admit(scope, usd('0.1'), usd(1))
    await claim.settle('settled', usd('1.01'))
    const readTotal2 = await ledger.read(scope)
    expect(readTotal2.spentUsd).toBe('1.01')
    await expect(ledger.admit(scope, usd('0.01'), usd(1))).rejects.toMatchObject({ kind: 'budget' })
  })
  it('idempotently settles the same amount but rejects contradictory settlement', async () => {
    const { scope, ledger } = setup()
    const claim = await ledger.admit(scope, usd(1), usd(2))
    await claim.settle('settled', usd('0.4'))
    await claim.settle('settled', usd('0.4'))
    await expect(claim.settle('settled', usd('0.5'))).rejects.toMatchObject({ kind: 'integrity' })
    expect(ledger.readExisting(scope)?.spentUsd).toBe('0.4')
  })
  it('never reads a staged snapshot as published data', async () => {
    const { scope, ledger } = setup()
    await ledger.read(scope)
    writeFileSync(path.join(scope.directory, 'state.json.unpublished.tmp'), '{')
    expect(ledger.readExisting(scope)?.spentUsd).toBe('0')
  })
  it('reports actual corruption with the file kind', async () => {
    const { scope, ledger } = setup()
    await ledger.read(scope)
    writeFileSync(path.join(scope.directory, 'state.json'), '{')
    expect(() => ledger.readExisting(scope)).toThrow(
      expect.objectContaining({ kind: 'damaged', facts: { scope: 'day', file: 'state.json' } }),
    )
  })
  it('recovers a complete transaction before the next admission exactly once', async () => {
    const { scope, ledger } = setup()
    await ledger.read(scope)
    const before = z
      .looseObject({ generation: z.number() })
      .parse(JSON.parse(readFileSync(path.join(scope.directory, 'state.json'), 'utf8')))
    const next = { ...before, generation: 1, settled: '0.7' }
    writeFileSync(
      path.join(scope.directory, 'transaction.json'),
      JSON.stringify({ ...next, change: { before: 0 } }),
    )
    const readTotal3 = await ledger.read(scope)
    expect(readTotal3.spentUsd).toBe('0.7')
    const readTotal4 = await ledger.read(scope)
    expect(readTotal4.spentUsd).toBe('0.7')
  })
  it('dead owners release only unsent claims and preserve sent reservations', async () => {
    const { scope, ledger } = setup()
    const unsent = await ledger.admit(scope, usd(1), usd(10))
    const sent = await ledger.admit(scope, usd(2), usd(10))
    sent.markSent()
    const stateFile = path.join(scope.directory, 'state.json')
    const snapshot = z
      .looseObject({
        open: z.array(z.looseObject({ owner: z.looseObject({ pid: z.number() }) })),
      })
      .parse(JSON.parse(readFileSync(stateFile, 'utf8')))
    for (const entry of snapshot.open) entry.owner.pid = 2_147_483_647
    writeFileSync(stateFile, JSON.stringify(snapshot))
    const recovering = createSpendLedger({
      sleep: delay,
      initial: () => Promise.resolve({ settled: usd(0), unknownHistory: false }),
    })
    expect(await recovering.read(scope)).toMatchObject({
      spentUsd: '2',
      uncertainUsd: '2',
      openClaims: 0,
    })
    expect(recovering.lookup(scope, unsent.id).state).toBe('released')
    expect(recovering.lookup(scope, sent.id).state).toBe('uncertain')
  })
  it('keeps unverifiable owners reserved without an age heuristic', async () => {
    const { scope, ledger } = setup()
    await ledger.admit(scope, usd(1), usd(2))
    const recovering = createSpendLedger({
      sleep: delay,
      initial: () => Promise.resolve({ settled: usd(0), unknownHistory: false }),
    })
    expect(await recovering.read(scope)).toMatchObject({
      spentUsd: '1',
      heldUsd: '1',
      openClaims: 1,
    })
  })
  it('queues a known charge durably while a live owner holds the lock', async () => {
    const { scope, ledger } = setup()
    const claim = await ledger.admit(scope, usd(1), usd(2))
    claim.markSent()
    const blocked = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    let shouldBlock = true
    const holder = createSpendLedger({
      sleep: delay,
      initial: () => Promise.resolve({ settled: usd(0), unknownHistory: false }),
      step: async (step) => {
        if (!(step === 'lock' && shouldBlock)) {
          return
        }

        shouldBlock = false
        entered.resolve(undefined)
        await blocked.promise
      },
    })
    const holding = holder.read(scope)
    await entered.promise
    const settled = await claim.settle('settled', usd('0.4'))
    expect(settled.spentUsd).toBe('0.4')
    expect(
      readdirSync(path.join(scope.directory, 'inbox')).filter((name) => name.endsWith('.json')),
    ).toHaveLength(1)
    expect(ledger.readExisting(scope)?.spentUsd).toBe('0.4')
    blocked.resolve(undefined)
    await holding
    expect(await ledger.read(scope)).toMatchObject({ spentUsd: '0.4', openClaims: 0 })
    expect(readdirSync(path.join(scope.directory, 'inbox'))).toHaveLength(0)
  })
  it('retains the full updated reservation when an outcome becomes uncertain', async () => {
    const { scope, ledger } = setup()
    const claim = await ledger.admit(scope, usd(1), usd(10))
    await claim.retain(usd(2))
    expect(await claim.settle('uncertain', usd('0.2'))).toMatchObject({
      spentUsd: '2',
      uncertainUsd: '2',
      heldUsd: '0',
      openClaims: 0,
    })
    expect(ledger.lookup(scope, claim.id).state).toBe('uncertain')
  })
  it('an unsent unpriced reservation cannot permanently poison a later cap', async () => {
    const { scope, ledger } = setup()
    const unsent = await ledger.admit(scope, usd(0), usd(0), 'unknown')
    await unsent.settle('released', usd(0))
    const next = await ledger.admit(scope, usd(1), usd(1))
    expect(next.bound).toBe('1')
  })
  it('sent unpriced uncertainty blocks a later finite cap honestly', async () => {
    const { scope, ledger } = setup()
    const sent = await ledger.admit(scope, usd(0), usd(0), 'unknown')
    sent.markSent()
    await sent.settle('uncertain', usd(0))
    await expect(ledger.admit(scope, usd(1), usd(1))).rejects.toMatchObject({ kind: 'legacy' })
  })
  it('counts a failed overage publication locally and retries it without duplication', async () => {
    const { scope } = setup()
    let receiptToBlock: string | undefined
    const ledger = createSpendLedger({
      sleep: delay,
      initial: () => Promise.resolve({ settled: usd(0), unknownHistory: false }),
      step: (step) => {
        if (step === 'settlement-queued' && receiptToBlock !== undefined) mkdirSync(receiptToBlock)
        return Promise.resolve()
      },
    })
    const billed = await ledger.admit(scope, usd(1), usd(2))
    const fitting = await ledger.admit(scope, usd('0.5'), usd(2))
    billed.markSent()
    const receipt = path.join(scope.directory, 'inbox', `${billed.id}.json`)
    receiptToBlock = receipt
    await expect(billed.settle('settled', usd('1.4'))).rejects.toMatchObject({ kind: 'unreadable' })
    rmSync(receipt, { recursive: true })
    receiptToBlock = undefined
    expect(fitting.check().spentUsd).toBe('1.9')
    expect(await ledger.read(scope)).toMatchObject({ spentUsd: '1.9' })
    expect(await ledger.read(scope)).toMatchObject({ spentUsd: '1.9' })
  })
  it('retains an incurred record when its directory cannot be created, then retries it', async () => {
    const { scope, ledger } = setup()
    const blocked = { ...scope, directory: path.join(scope.directory, 'blocked') }
    writeFileSync(blocked.directory, 'file in place of directory')
    await expect(ledger.record(blocked, usd('0.3'))).rejects.toMatchObject({
      name: 'SpendLedgerError',
      kind: 'unreadable',
      facts: { file: 'inbox' },
    })
    rmSync(blocked.directory)
    const total = await ledger.read(blocked)
    expect(total.spentUsd).toBe('0.3')
    const repeated = await ledger.read(blocked)
    expect(repeated.spentUsd).toBe('0.3')
  })
  it('keeps the final charge when a snapshot read fails, then records it after repair', async () => {
    const { scope, ledger } = setup()
    const claim = await ledger.admit(scope, usd(1), usd(2))
    claim.markSent()
    const file = path.join(scope.directory, 'state.json')
    const before = readFileSync(file)
    writeFileSync(file, '{')
    await expect(claim.settle('settled', usd('1.4'))).rejects.toMatchObject({ kind: 'damaged' })
    writeFileSync(file, before)
    expect(await ledger.read(scope)).toMatchObject({ spentUsd: '1.4', heldUsd: '0' })
    expect(await ledger.read(scope)).toMatchObject({ spentUsd: '1.4' })
  })
  it('takes over a complete dead lock and a remover killed after removing the note', async () => {
    const { scope, ledger } = setup()
    await ledger.read(scope)
    const owner = await currentProcessOwner()
    const id = 'a123'
    const lock = path.join(scope.directory, 'lock')
    mkdirSync(lock)
    writeFileSync(
      path.join(lock, id),
      JSON.stringify({ id, owner: { ...owner, pid: 2_147_483_647 } }),
    )
    const readTotal5 = await ledger.read(scope)
    expect(readTotal5.spentUsd).toBe('0')
    mkdirSync(lock)
    const readTotal6 = await ledger.read(scope)
    expect(readTotal6.spentUsd).toBe('0')
  })
})
