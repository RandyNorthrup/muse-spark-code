import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { createTabLedger, tabLocalDate } from '../../src/host/tab/tabLedger'
import { Usd } from '../../src/shared/usd'
import { usingTempDir } from './helpers/temporaryFolders'

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

const ownFile = (root: string) => path.join(root, tabLocalDate(Date.now()), 'window1.json')

describe('createTabLedger failure words', () => {
  it('fails closed with a warn when its own file is unreadable', async () => {
    await usingTempDir('muse-tab-ledger-', async (root) => {
      const { log, warns } = memoryLog()
      const ledger = ledgerWith(root, log)
      mkdirSync(ownFile(root), { recursive: true })
      const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
      expect(admitted.admitted).toBe(false)
      expect(warns.some((line) => line.includes('unreadable'))).toBe(true)
    })
  })

  it('fails closed with a warn when its own file is unparseable', async () => {
    await usingTempDir('muse-tab-ledger-', async (root) => {
      const { log, warns } = memoryLog()
      const ledger = ledgerWith(root, log)
      const file = ownFile(root)
      mkdirSync(path.join(root, tabLocalDate(Date.now())), { recursive: true })
      writeFileSync(file, '{torn', 'utf8')
      const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
      expect(admitted.admitted).toBe(false)
      expect(warns.some((line) => line.includes('unparseable'))).toBe(true)
    })
  })

  it('refuses the day total when the day folder cannot be listed', async () => {
    await usingTempDir('muse-tab-ledger-', async (root) => {
      const { log, warns } = memoryLog()
      const ledger = ledgerWith(root, log)
      writeFileSync(path.join(root, tabLocalDate(Date.now())), 'in the way', 'utf8')
      const total = await ledger.todayUsage()
      expect(total.ok).toBe(false)
      expect(warns.some((line) => line.includes('day unreadable'))).toBe(true)
    })
  })

  it('keeps its reservation when settlement cannot read the file back', async () => {
    await usingTempDir('muse-tab-ledger-', async (root) => {
      const { log, warns } = memoryLog()
      const ledger = ledgerWith(root, log)
      const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
      expect(admitted.admitted).toBe(true)
      if (!admitted.admitted) return
      rmSync(ownFile(root), { force: true })
      mkdirSync(ownFile(root), { recursive: true })
      await expect(ledger.settle(admitted.reservation, Usd.from(1).toAmount())).resolves.toBe(false)
      expect(warns.some((line) => line.includes('keeping its reservation'))).toBe(true)
    })
  })

  it('reports a durable settlement as settled', async () => {
    await usingTempDir('muse-tab-ledger-', async (root) => {
      const { log } = memoryLog()
      const ledger = ledgerWith(root, log)
      const admitted = await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
      expect(admitted.admitted).toBe(true)
      if (!admitted.admitted) return
      await expect(ledger.settle(admitted.reservation, Usd.from(0.4).toAmount())).resolves.toBe(
        true,
      )
      const total = await ledger.todayUsage()
      expect(total.ok).toBe(true)
      if (!total.ok) throw new Error(total.detail)
      expect(total.totalUsd).toBe(Usd.from(0.4).toAmount())
    })
  })
})
