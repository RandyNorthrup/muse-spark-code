import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadUiTable, readUiTableFile, type UiTableDeps } from '../../src/host/l10n'
import type { Logger } from '../../src/host/logger'
import { L10N_TABLE_MAX_BYTES } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT, uiLocale } from '../../src/shared/l10n/text'

interface FakeLog extends Logger {
  readonly info: ReturnType<typeof vi.fn<(message: string) => void>>
  readonly warn: ReturnType<typeof vi.fn<(message: string) => void>>
}

function fakeLog(): FakeLog {
  return {
    trace: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  }
}

const GERMAN = { ...EN, sendTitle: 'Senden', toolOutputTitle: 'Ausgabe von {tool} ({id})' }

// The shipped list is empty until M40b; these tests name their own tables.
function onlyGerman(language: string): string | undefined {
  return language === 'de' || language.startsWith('de-') ? 'de' : undefined
}

function setup(language: string, file: () => Promise<string>, hasGerman = true) {
  const log = fakeLog()
  const readExtensionFile = vi.fn<UiTableDeps['readExtensionFile']>(file)
  const deps: UiTableDeps = {
    language,
    readExtensionFile,
    log,
    ...(hasGerman && { tableLocaleFor: onlyGerman }),
  }
  return { deps, log, readExtensionFile }
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('loadUiTable (PLAN.md D33)', () => {
  it('keeps English for a display language without a table, and says so once', async () => {
    const t = setup('ar', () => Promise.reject(new Error('not read')), false)
    const loaded = await loadUiTable(t.deps)
    expect(loaded).toEqual({ locale: BASE_LOCALE, table: EN })
    expect(t.readExtensionFile).not.toHaveBeenCalled()
    expect(t.log.info).toHaveBeenCalledOnce()
    expect(t.log.info.mock.calls[0]?.[0]).toContain('ar')
    expect(t.log.warn).not.toHaveBeenCalled()
    expect(uiLocale()).toBe(BASE_LOCALE)
    expect(UI_TEXT.sendTitle).toBe(EN.sendTitle)
  })

  it('reads and installs the table the display language maps to', async () => {
    const t = setup('de-CH', () => Promise.resolve(JSON.stringify(GERMAN)))
    const loaded = await loadUiTable(t.deps)
    // `de-CH` has no table of its own; it reads German's file, installed as `de`.
    expect(t.readExtensionFile).toHaveBeenCalledExactlyOnceWith(['l10n', 'ui.de.json'])
    expect(loaded).toEqual({ locale: 'de', table: GERMAN })
    expect(UI_TEXT.sendTitle).toBe('Senden')
    expect(uiLocale()).toBe('de')
    expect(t.log.info.mock.calls[0]?.[0]).toContain('de')
    expect(t.log.warn).not.toHaveBeenCalled()
  })

  it('stays in English, with a warning, when the file cannot be read', async () => {
    const t = setup('de', () => Promise.reject(new Error('ENOENT: no such file')))
    expect(await loadUiTable(t.deps)).toEqual({ locale: BASE_LOCALE, table: EN })
    expect(t.log.warn).toHaveBeenCalledOnce()
    expect(t.log.warn.mock.calls[0]?.[0]).toMatch(/ui\.de\.json.*ENOENT: no such file/)
    expect(uiLocale()).toBe(BASE_LOCALE)
    expect(UI_TEXT.sendTitle).toBe(EN.sendTitle)
  })

  it('stays in English, with a warning, when the file is not JSON', async () => {
    const t = setup('de', () => Promise.resolve('{ "sendTitle": "Senden",'))
    expect(await loadUiTable(t.deps)).toEqual({ locale: BASE_LOCALE, table: EN })
    expect(t.log.warn).toHaveBeenCalledOnce()
    expect(t.log.warn.mock.calls[0]?.[0]).toContain('ui.de.json')
    expect(uiLocale()).toBe(BASE_LOCALE)
  })

  it('stays in English, naming the first problems, when the table does not match English', async () => {
    // One key gone, one template that lost a slot.
    const damaged = Object.fromEntries(
      Object.entries({ ...GERMAN, toolOutputTitle: 'Ausgabe ({id})' }).filter(
        ([key]) => key !== 'sendTitle',
      ),
    )
    const t = setup('de', () => Promise.resolve(JSON.stringify(damaged)))
    expect(await loadUiTable(t.deps)).toEqual({ locale: BASE_LOCALE, table: EN })
    const warning = t.log.warn.mock.calls[0]?.[0] ?? ''
    expect(warning).toContain('toolOutputTitle: slots {id}, {tool} expected, found {id}')
    expect(warning).toContain('sendTitle: missing')
    expect(UI_TEXT.toolOutputTitle).toBe(EN.toolOutputTitle)
    expect(uiLocale()).toBe(BASE_LOCALE)
  })

  it('names only the first few problems of a badly damaged table', async () => {
    const t = setup('de', () => Promise.resolve('{}'))
    await loadUiTable(t.deps)
    const warning = t.log.warn.mock.calls[0]?.[0] ?? ''
    expect(warning.match(/: missing/g)).toHaveLength(5)
    expect(warning).toMatch(/and \d+ more$/)
  })
})

describe('source and packaged translation bytes', () => {
  const fixture = { root: '' }
  beforeAll(() => {
    mkdirSync(path.join(process.cwd(), 'temp'), { recursive: true })
    fixture.root = mkdtempSync(path.join(process.cwd(), 'temp', 'train14-l10n-'))
    mkdirSync(path.join(fixture.root, 'l10n'))
  })
  afterAll(() => removeFolder(fixture.root))

  it('reads ordinary source/ACP JSON without changing its text', async () => {
    const text = JSON.stringify(EN, undefined, 2)
    writeFileSync(path.join(fixture.root, 'l10n/ui.en.json'), text)
    await expect(readUiTableFile(fixture.root, ['l10n', 'ui.en.json'])).resolves.toBe(text)
  })

  it('decodes the staged table and installs its actual translated values', async () => {
    const text = JSON.stringify(GERMAN)
    writeFileSync(
      path.join(fixture.root, 'l10n/ui.de.json.br'),
      brotliCompressSync(Buffer.from(text)),
    )
    await expect(readUiTableFile(fixture.root, ['l10n', 'ui.de.json'])).resolves.toBe(text)
    const table = await loadUiTable({
      language: 'de',
      readExtensionFile: (segments) => readUiTableFile(fixture.root, segments),
      log: fakeLog(),
    })
    expect(table.locale).toBe('de')
    expect(table.table).toEqual(GERMAN)
    expect(UI_TEXT.sendTitle).toBe('Senden')
  })

  it('refuses a compressed table whose decoded bytes exceed the fixed bound', async () => {
    const oversized = Buffer.from(' '.repeat(L10N_TABLE_MAX_BYTES + 1))
    writeFileSync(path.join(fixture.root, 'l10n/ui.fr.json.br'), brotliCompressSync(oversized))
    await expect(readUiTableFile(fixture.root, ['l10n', 'ui.fr.json'])).rejects.toThrow()
  })

  it('refuses corrupt compressed bytes instead of using a second file', async () => {
    writeFileSync(path.join(fixture.root, 'l10n/ui.it.json.br'), 'Invalid Brotli')
    writeFileSync(path.join(fixture.root, 'l10n/ui.it.json'), JSON.stringify(EN))
    await expect(readUiTableFile(fixture.root, ['l10n', 'ui.it.json'])).rejects.toThrow()
  })
})
