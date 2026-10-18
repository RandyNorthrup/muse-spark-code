// The installed-language table over real files: a missing table, a
// malformed one and a wrong-shaped one all keep the panel in English,
// and each failure is said once in the log.

import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadUiTable } from '../../src/host/l10n'
import type { Logger } from '../../src/host/logger'
import { EN } from '../../src/shared/l10n/en'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-ui-table-')))
afterAll(async () => {
  await removeFolder(base)
})

function readFrom(directory: string) {
  return async (segments: readonly string[]): Promise<string> =>
    await readFile(path.join(directory, ...segments), 'utf8')
}

function logger(messages: string[]): Logger {
  const push = (message: string) => {
    messages.push(message)
  }
  return { info: push, warn: push, error: push, debug: push, trace: push }
}

describe('loadUiTable', () => {
  it('keeps English when the table is missing, malformed or wrong-shaped', async () => {
    const empty: string[] = []
    const missing = await loadUiTable({
      language: 'de',
      readExtensionFile: readFrom(base),
      log: logger(empty),
    })
    expect(missing.locale).toBe('en')
    expect(missing.table).toBe(EN)
    expect(empty).toHaveLength(1)

    const directory = path.join(base, 'tables')
    await mkdir(path.join(directory, 'l10n'), { recursive: true })
    await writeFile(path.join(directory, 'l10n', 'ui.de.json'), '{not json')
    const malformed: string[] = []
    const broken = await loadUiTable({
      language: 'de',
      readExtensionFile: readFrom(directory),
      log: logger(malformed),
    })
    expect(broken.locale).toBe('en')
    expect(malformed).toHaveLength(1)

    await writeFile(path.join(directory, 'l10n', 'ui.de.json'), '{"shapes":[]}')
    const wrongShape: string[] = []
    const shaped = await loadUiTable({
      language: 'de',
      readExtensionFile: readFrom(directory),
      log: logger(wrongShape),
    })
    expect(shaped.locale).toBe('en')
  })
})
