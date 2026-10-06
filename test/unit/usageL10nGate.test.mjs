import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'
import { isPluralForms } from '../../src/shared/l10n/forms'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'

const root = process.cwd()
const script = path.join(root, 'scripts/check-l10n.mjs')
const fixture = { root: '' }
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
function runGate(args = []) {
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

beforeEach(async () => {
  fixture.root = mkdtempSync(path.join(os.tmpdir(), 'm102-l10n-'))
  cpSync(path.join(root, 'src/shared/l10n'), path.join(fixture.root, 'src/shared/l10n'), {
    recursive: true,
  })
  cpSync(
    path.join(root, 'src/shared/constants.ts'),
    path.join(fixture.root, 'src/shared/constants.ts'),
  )
  cpSync(
    path.join(root, 'src/shared/browserCheckConstants.ts'),
    path.join(fixture.root, 'src/shared/browserCheckConstants.ts'),
  )
  cpSync(path.join(root, 'l10n'), path.join(fixture.root, 'l10n'), { recursive: true })
  const { TABLE_LOCALES } = await loadL10n(root)
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  // Lane W owns these actual references. The fixture completes its future
  // manifest solely to isolate tests of the gate; no production fake exists.
  manifest.contributes.commands.push({
    command: 'museSpark.openUsagePage',
    title: '%command.openUsagePage.title%',
  })
  manifest.contributes.configuration.properties['museSpark.usageHistory'] = {
    description: '%setting.usageHistory.description%',
  }
  manifest.contributes.configuration.properties['museSpark.usageHistoryDays'] = {
    description: '%setting.usageHistoryDays.description%',
  }
  writeJson('package.json', manifest)
  for (const locale of ['', ...TABLE_LOCALES]) {
    const file = `package.nls${locale === '' ? '' : `.${locale}`}.json`
    cpSync(path.join(root, file), path.join(fixture.root, file))
    if (locale !== '') writeJson(`l10n/usage.${locale}.json`, translate(USAGE_EN, locale))
  }
})
afterEach(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('both localization families', () => {
  it('passes all 14 complete usage tables and rejects a missing key, bad slots and untranslated text', () => {
    expect(runGate()).toEqual({ code: 0, output: expect.stringContaining('0 problems') })
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

  it('keeps usage untranslated exceptions separate and validates their key names', () => {
    const file = 'l10n/usage.de.json'
    const german = JSON.parse(readFileSync(path.join(fixture.root, file), 'utf8'))
    german.refresh = USAGE_EN.refresh
    writeJson(file, german)
    expect(runGate().code).toBe(1)
    const exceptions = JSON.parse(
      readFileSync(path.join(fixture.root, 'l10n/untranslated.json'), 'utf8'),
    )
    exceptions.usage = { de: ['refresh'] }
    writeJson('l10n/untranslated.json', exceptions)
    expect(runGate().code).toBe(0)
    exceptions.usage.de.push('missing.key')
    writeJson('l10n/untranslated.json', exceptions)
    expect(runGate().output).toContain('usage.de: missing.key: not a string of the usage table')
  })

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

  it('checks all packaged usage tables byte-for-byte and strictly against their schema', () => {
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
    expect(runGate(['--packaged', stage]).code).toBe(0)
    const file = path.join(stage, 'l10n/usage.de.json')
    const german = JSON.parse(readFileSync(file, 'utf8'))
    delete german.title
    writeFileSync(file, JSON.stringify(german))
    const result = runGate(['--packaged', stage])
    expect(result.code).toBe(1)
    expect(result.output).toContain('packaged l10n/usage.de.json: differs from source')
    expect(result.output).toContain('packaged l10n/usage.de.json: title: missing')
  })
})
