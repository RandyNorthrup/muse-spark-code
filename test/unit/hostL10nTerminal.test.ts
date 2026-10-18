// F7: a headless run has no panel, so its language log names the terminal's
// messages; only the VS Code panel names the panel. Real logger, real table
// files, real shape check: no mocks, no fakes.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadUiTable } from '../../src/host/l10n'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { stderrLogger } from '../../src/runtime/stderrLog'

function collector() {
  const lines: string[] = []
  return {
    lines,
    log: stderrLogger((line) => {
      lines.push(line)
    }, 'info'),
  }
}

const repoFile = (name: string) => readFile(new URL(`../../l10n/${name}`, import.meta.url), 'utf8')

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('loadUiTable surfaces', () => {
  it('names the terminal messages, never the panel, on a headless run', async () => {
    const t = collector()
    const loaded = await loadUiTable({
      language: 'en-us',
      readExtensionFile: () => Promise.reject(new Error('must not read without a table')),
      surface: 'terminal',
      log: t.log,
    })
    expect(loaded).toEqual({ locale: BASE_LOCALE, table: EN })
    expect(t.lines).toEqual(['[info] Display language en-us: messages are in English'])
  })

  it('installs the real German table on the terminal and says so', async () => {
    const t = collector()
    const loaded = await loadUiTable({
      language: 'de',
      readExtensionFile: () => repoFile('ui.de.json'),
      surface: 'terminal',
      log: t.log,
    })
    expect(loaded.locale).toBe('de')
    expect(t.lines).toEqual(['[info] Display language de: messages are in de (l10n/ui.de.json)'])
  })

  it('keeps the panel wording where a panel exists', async () => {
    const t = collector()
    await loadUiTable({
      language: 'en-us',
      readExtensionFile: () => Promise.reject(new Error('must not read without a table')),
      log: t.log,
    })
    expect(t.lines).toEqual(['[info] Display language en-us: the panel is in English'])
  })

  it('names the terminal messages when the table cannot be read or match', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'cliflows2-l10n-'))
    try {
      await writeFile(path.join(folder, 'broken.json'), '{oops')
      await writeFile(path.join(folder, 'wrong.json'), JSON.stringify({}))
      const readFrom = (name: string) => readFile(path.join(folder, name), 'utf8')
      const unreadable = collector()
      await loadUiTable({
        language: 'de',
        readExtensionFile: () => readFrom('broken.json'),
        surface: 'terminal',
        log: unreadable.log,
      })
      expect(unreadable.lines.join('\n')).toContain('messages stay in English')
      const mismatch = collector()
      await loadUiTable({
        language: 'de',
        readExtensionFile: () => readFrom('wrong.json'),
        surface: 'terminal',
        log: mismatch.log,
      })
      expect(mismatch.lines.join('\n')).toContain('messages stay in English')
      expect(mismatch.lines.join('\n')).not.toContain('panel')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
