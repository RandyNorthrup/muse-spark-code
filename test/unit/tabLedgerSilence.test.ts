import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTabLedger, tabLocalDate } from '../../src/host/tab/tabLedger'
import { Usd } from '../../src/shared/usd'
import { collectingLogger } from './helpers/collectingLogger'
import { usingTempDir } from './helpers/temporaryFolders'

// M94 acceptance 20 (no path in the log): the ledger's warnings over real
// failures. The operating system's errors name the file they failed on;
// the log keeps the bare file name and the failure's fixed words, never
// the folder and never the file's content.

describe('Tab ledger log silence', () => {
  it('names no folder and no content when its own file fails', async () => {
    await usingTempDir('muse-tab-silence-', async (root) => {
      const messages: string[] = []
      const ledger = createTabLedger({
        directory: root,
        windowId: 'window1',
        now: () => Date.now(),
        sleep: () => Promise.resolve(),
        log: collectingLogger(messages),
      })
      const own = path.join(root, tabLocalDate(Date.now()), 'window1.json')
      mkdirSync(own, { recursive: true })
      await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
      expect(messages.length).toBeGreaterThan(0)
      for (const line of messages) {
        expect(line).not.toContain(root)
      }
    })
  })

  it('names no folder and no secret when its content is corrupt', async () => {
    await usingTempDir('muse-tab-silence-', async (root) => {
      const messages: string[] = []
      const ledger = createTabLedger({
        directory: root,
        windowId: 'window1',
        now: () => Date.now(),
        sleep: () => Promise.resolve(),
        log: collectingLogger(messages),
      })
      const day = path.join(root, tabLocalDate(Date.now()))
      mkdirSync(day, { recursive: true })
      writeFileSync(
        path.join(day, 'window1.json'),
        '{"date": "tomorrow", "password": "hunter22"',
        'utf8',
      )
      await ledger.admit(Usd.from(1).toAmount(), Usd.from(100).toAmount())
      expect(messages.length).toBeGreaterThan(0)
      for (const line of messages) {
        expect(line).not.toContain(root)
        expect(line).not.toContain('hunter22')
      }
    })
  })

  it('names no folder when the day cannot be listed', async () => {
    await usingTempDir('muse-tab-silence-', async (root) => {
      const messages: string[] = []
      const ledger = createTabLedger({
        directory: root,
        windowId: 'window1',
        now: () => Date.now(),
        sleep: () => Promise.resolve(),
        log: collectingLogger(messages),
      })
      writeFileSync(path.join(root, tabLocalDate(Date.now())), 'in the way', 'utf8')
      await ledger.todayTotal()
      expect(messages.length).toBeGreaterThan(0)
      for (const line of messages) {
        expect(line).not.toContain(root)
      }
    })
  })
})
