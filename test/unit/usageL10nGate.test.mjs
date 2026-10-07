import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'
import { createLocalizationCheck } from '../../scripts/lib/localizationGate.mjs'
import { isPluralForms } from '../../src/shared/l10n/forms'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'

const root = process.cwd()
const script = path.join(root, 'scripts/check-l10n.mjs')
const fixture = {
  root: '',
  check: undefined,
  completeGate: undefined,
  sourceGate: undefined,
  locales: [],
}
const originalFiles = new Map()
// Compression speed is irrelevant to the gate's decoded-value validation.
const TEST_BROTLI_OPTIONS = { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } }
function writeJson(file, value) {
  writeFileSync(path.join(fixture.root, file), JSON.stringify(value))
}
function translate(value, locale) {
  if (typeof value === 'string') return `${locale}: ${value}`
  if (isPluralForms(value)) {
    return Object.fromEntries(
      new Intl.PluralRules(locale)
        .resolvedOptions()
        .pluralCategories.map((category) => [
          category,
          `${locale}: ${value[category] ?? value.other}`,
        ]),
    )
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, translate(child, locale)]),
  )
}
function runCli(args = []) {
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
      }),
    }
  } catch (error) {
    return { code: error.status, output: String(error.stdout) }
  }
}
function runGate(args = []) {
  return fixture.check(args)
}

beforeAll(async () => {
  mkdirSync(path.join(root, 'temp'), { recursive: true })
  fixture.root = mkdtempSync(path.join(root, 'temp', 'm102-l10n-'))
  cpSync(path.join(root, 'src/shared'), path.join(fixture.root, 'src/shared'), {
    recursive: true,
  })
  mkdirSync(path.join(fixture.root, 'src/core/judge'), { recursive: true })
  cpSync(
    path.join(root, 'src/core/judge/engine.ts'),
    path.join(fixture.root, 'src/core/judge/engine.ts'),
  )
  cpSync(path.join(root, 'l10n'), path.join(fixture.root, 'l10n'), { recursive: true })
  cpSync(path.join(root, 'src/core/whatsNew'), path.join(fixture.root, 'src/core/whatsNew'), {
    recursive: true,
  })
  mkdirSync(path.join(fixture.root, 'src/runtime'), { recursive: true })
  cpSync(
    path.join(root, 'src/runtime/cliOptions.ts'),
    path.join(fixture.root, 'src/runtime/cliOptions.ts'),
  )
  const { TABLE_LOCALES } = await loadL10n(root)
  fixture.locales = TABLE_LOCALES
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  writeJson('package.json', manifest)
  for (const locale of ['', ...TABLE_LOCALES]) {
    const file = `package.nls${locale === '' ? '' : `.${locale}`}.json`
    cpSync(path.join(root, file), path.join(fixture.root, file))
    if (locale !== '') writeJson(`l10n/usage.${locale}.json`, translate(USAGE_EN, locale))
  }
  for (const file of [
    'l10n/untranslated.json',
    ...TABLE_LOCALES.map((locale) => `l10n/usage.${locale}.json`),
  ])
    originalFiles.set(file, readFileSync(path.join(fixture.root, file)))
  fixture.check = await createLocalizationCheck(fixture.root)
  // Retain a real CLI smoke check; mutations use the same checker without cold builds.
  fixture.completeGate = runCli()
  fixture.sourceGate = fixture.check()
})
beforeEach(() => {
  // Every test gets pristine mutable files without recopying the entire source tree.
  for (const [file, contents] of originalFiles)
    writeFileSync(path.join(fixture.root, file), contents)
  for (const file of ['src/read.ts', 'l10n/usage.unknown.json', 'stage'])
    rmSync(path.join(fixture.root, file), { recursive: true, force: true })
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('both localization families', () => {
  it('passes all 14 complete usage tables and rejects a missing key, bad slots and untranslated text', () => {
    expect(fixture.completeGate).toEqual({ code: 0, output: expect.stringContaining('0 problems') })
    expect(fixture.sourceGate).toEqual(fixture.completeGate)
    const file = 'l10n/usage.de.json'
    const german = JSON.parse(readFileSync(path.join(fixture.root, file), 'utf8'))
    delete german.title
    german.journalHost = 'Host {path}'
    german.refresh = USAGE_EN.refresh
    writeJson(file, german)
    const result = runGate()
    expect(result.code).toBe(1)
    expect(result.output).toContain('l10n/usage.de.json: title: missing')
    expect(result.output).toContain('journalHost: slots {host} expected, found {path}')
    expect(result.output).toContain('refresh: left in English')
  })

  it('rejects a missing usage file, an unknown locale and invalid plural categories', () => {
    rmSync(path.join(fixture.root, 'l10n/usage.de.json'))
    writeJson('l10n/usage.unknown.json', {})
    const file = 'l10n/usage.ru.json'
    const russian = JSON.parse(readFileSync(path.join(fixture.root, file), 'utf8'))
    russian.recordCount = { other: 'ru: {count} records' }
    writeJson(file, russian)
    const result = runGate()
    expect(result.code).toBe(1)
    expect(result.output).toContain('l10n/usage.de.json: missing')
    expect(result.output).toContain('unknown is not in TABLE_LOCALES')
    expect(result.output).toContain('recordCount: ru uses the forms few, many, one, other')
  })

  it.each(['absent', 'allowed', 'unknown'])(
    'keeps usage untranslated exceptions separate: %s',
    (kind) => {
      const file = 'l10n/usage.de.json'
      const german = JSON.parse(readFileSync(path.join(fixture.root, file), 'utf8'))
      german.refresh = USAGE_EN.refresh
      writeJson(file, german)
      const exceptions = JSON.parse(
        readFileSync(path.join(fixture.root, 'l10n/untranslated.json'), 'utf8'),
      )
      if (kind !== 'absent') exceptions.usage = { de: ['refresh'] }
      if (kind === 'unknown') exceptions.usage.de.push('missing.key')
      writeJson('l10n/untranslated.json', exceptions)
      const result = runGate()
      expect(result.code).toBe(kind === 'allowed' ? 0 : 1)
      if (kind === 'unknown')
        expect(result.output).toContain('usage.de: missing.key: not a string of the usage table')
    },
  )

  it('guards module-load reads of usage text, including import aliases', () => {
    writeFileSync(
      path.join(fixture.root, 'src/read.ts'),
      "import { USAGE_TEXT as T } from './shared/l10n/usageTable'; export const title = T.title",
    )
    const result = runGate()
    expect(result.code).toBe(1)
    expect(result.output).toContain('src/read.ts:1:')
    expect(result.output).toContain('T read at module load')
  })

  it.each(['complete', 'missing'])(
    'checks packaged usage tables byte-for-byte: %s',
    async (kind) => {
      const stage = path.join(fixture.root, 'stage')
      mkdirSync(stage)
      cpSync(path.join(fixture.root, 'l10n'), path.join(stage, 'l10n'), { recursive: true })
      for (const name of [
        'package.json',
        ...[
          '',
          'zh-cn',
          'zh-tw',
          'ja',
          'ko',
          'de',
          'fr',
          'es',
          'pt-br',
          'ru',
          'it',
          'tr',
          'pl',
          'cs',
          'hu',
        ].map((locale) => `package.nls${locale === '' ? '' : `.${locale}`}.json`),
      ])
        cpSync(path.join(fixture.root, name), path.join(stage, name))
      const TABLE_LOCALES = fixture.locales
      const ui = TABLE_LOCALES.map((locale) =>
        JSON.parse(readFileSync(path.join(stage, 'l10n', `ui.${locale}.json`), 'utf8')),
      )
      const keys = Object.keys(ui[0])
      writeFileSync(
        path.join(stage, 'l10n/ui.tables.json.br'),
        brotliCompressSync(
          JSON.stringify({
            version: 1,
            keys,
            locales: TABLE_LOCALES,
            values: ui.map((table) => keys.map((key) => table[key])),
          }),
          TEST_BROTLI_OPTIONS,
        ),
      )
      const usage = Object.fromEntries(
        TABLE_LOCALES.map((locale) => [
          locale,
          JSON.parse(readFileSync(path.join(stage, 'l10n', `usage.${locale}.json`), 'utf8')),
        ]),
      )
      const file = path.join(stage, 'l10n/usage.tables.json.br')
      if (kind === 'missing') delete usage.de.title
      writeFileSync(file, brotliCompressSync(JSON.stringify(usage), TEST_BROTLI_OPTIONS))
      const result = runGate(['--packaged', stage])
      if (kind === 'complete')
        expect(result).toEqual({
          code: 0,
          output: expect.stringContaining('0 problems'),
        })
      else {
        expect(result.code).toBe(1)
        expect(result.output).toContain('packaged l10n/usage.de.json: differs from source')
        expect(result.output).toContain('packaged l10n/usage.de.json: title: missing')
      }
    },
  )
})
