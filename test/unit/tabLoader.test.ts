import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isTabBundle, tabLoader } from '../../src/host/tab/tabLoader'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { collectingLogger } from './helpers/collectingLogger'
import { removeFolder } from './helpers/temporaryFolders'

// M94 acceptance 18 (the bundle loads on first use) and acceptance 20
// (no path in the log): the real Tab loader over Node's own require. A
// missing file and a real wrong-shape module both throw the table's own
// failure sentence, keep fixed words in the log, and are tried again.

const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-tab-load-')))
afterAll(async () => {
  await removeFolder(base)
})

const unavailable = fill(UI_TEXT.tabStatusError, { kind: 'load' })

describe('tabLoader', () => {
  it('throws the failure sentence with the load failure as the cause, and tries again', () => {
    const messages: string[] = []
    const missing = path.join(base, 'dist', 'tab.js')
    const load = tabLoader({ bundlePath: missing, log: collectingLogger(messages) })
    const failures: unknown[] = []
    for (let n = 0; n < 2; n += 1) {
      try {
        load()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    expect(failures).toHaveLength(2)
    for (const failure of failures) {
      expect(failure instanceof Error ? failure.message : undefined).toBe(unavailable)
      expect(failure instanceof Error ? failure.cause : undefined).toBeInstanceOf(Error)
    }
    // Fixed words only: the missing path never reaches the log.
    expect(messages).toHaveLength(2)
    for (const message of messages) {
      expect(message).toBe('The Tab bundle could not be loaded')
      expect(message).not.toContain(base)
    }
  })

  it('refuses a real module without the entries, with fixed words', () => {
    const wrongShape = path.join(base, 'not-tab.js')
    writeFileSync(wrongShape, 'module.exports = { createTabServices: () => ({}) }\n', 'utf8')
    const messages: string[] = []
    const load = tabLoader({ bundlePath: wrongShape, log: collectingLogger(messages) })
    let failure: unknown
    try {
      load()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure instanceof Error ? failure.message : undefined).toBe(unavailable)
    expect(messages).toEqual(['The Tab bundle does not export the Tab'])
  })
})

describe('isTabBundle', () => {
  const entries = {
    createTabServices: () => ({}),
    createTabProvider: () => ({}),
    showTabMenu: () => Promise.resolve(),
    snoozeTabCommand: () => Promise.resolve(),
    tabLanguagesCommand: () => Promise.resolve(),
  }

  it('accepts the five entries and refuses anything else', () => {
    expect(isTabBundle(entries)).toBe(true)
    expect(isTabBundle({ ...entries, showTabMenu: undefined })).toBe(false)
    expect(isTabBundle({})).toBe(false)
    expect(isTabBundle(undefined)).toBe(false)
  })
})
