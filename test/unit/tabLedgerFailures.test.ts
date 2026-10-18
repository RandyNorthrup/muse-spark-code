import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { createTabLedger, tabLocalDate } from '../../src/host/tab/tabLedger'
import { Usd } from '../../src/shared/usd'

const quiet = (): void => undefined
function memoryLog(): { log: Logger; warns: string[] } {
  const warns: string[] = []
  return {
    warns,
    log: {
      trace: quiet,
      info: quiet,
      warn: (message) => void warns.push(message),
      error: quiet,
    },
  }
}
const ledgerWith = (root: string, log: Logger) =>
  createTabLedger({
    directory: root,
    windowId: 'window1',
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
    log,
  })

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})
const freshRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-ledger-'))
  roots.push(root)
  return root
}
const ownFile = (root: string, windowId = 'window1') =>
  path.join(root, tabLocalDate(Date.now()), `${windowId}.json`)

describe('createTabLedger failure words', () => {
  it('fails closed with a warn when its own file is unreadable', async () => {
    const root = freshRoot()
    const { log, warns } = memoryLog()
    const ledger = ledgerWith(root, log)
    mkdirSync(ownFile(root), { recursive: true })
    const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
    expect(admitted.admitted).toBe(false)
    expect(warns.some((line) => line.includes('unreadable'))).toBe(true)
  })

  it('fails closed with a warn when its own file is unparseable', async () => {
    const root = freshRoot()
    const { log, warns } = memoryLog()
    const ledger = ledgerWith(root, log)
    const file = ownFile(root)
    mkdirSync(path.join(root, tabLocalDate(Date.now())), { recursive: true })
    writeFileSync(file, '{torn', 'utf8')
    const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
    expect(admitted.admitted).toBe(false)
    expect(warns.some((line) => line.includes('unparseable'))).toBe(true)
  })

  it('refuses the day total when the day folder cannot be listed', async () => {
    const root = freshRoot()
    const { log, warns } = memoryLog()
    const ledger = ledgerWith(root, log)
    writeFileSync(path.join(root, tabLocalDate(Date.now())), 'in the way', 'utf8')
    const total = await ledger.todayUsage()
    expect(total.ok).toBe(false)
    expect(warns.some((line) => line.includes('day unreadable'))).toBe(true)
  })

  it('keeps its reservation when settlement cannot read the file back', async () => {
    const root = freshRoot()
    const { log, warns } = memoryLog()
    const ledger = ledgerWith(root, log)
    const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
    expect(admitted.admitted).toBe(true)
    if (!admitted.admitted) return
    rmSync(ownFile(root), { force: true })
    mkdirSync(ownFile(root), { recursive: true })
    await ledger.settle(admitted.reservation, Usd.from(1).toAmount())
    expect(warns.some((line) => line.includes('keeping its reservation'))).toBe(true)
  })
})
