import { existsSync, readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { ACCOUNT_REQUEST_CERTIFICATION } from '../../src/shared/constants'
import { featureCatalog } from '../../src/shared/featureCatalog'
import { formatAcpUsage } from '../../src/runtime/cliOptions'
import { EN } from '../../src/shared/l10n/en'
import { accountReleaseFiles, accountReleaseReference } from '../../scripts/lib/accountRestore.mjs'

const register = JSON.parse(readFileSync('docs/certification/cm1082-restore.json', 'utf8'))
const note = readFileSync('docs/certification/cm1082-restore.md', 'utf8')
afterEach(() => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
})

const historical = (text) => text.slice(text.indexOf('## [0.17.0]'))

it('account certification switch restores exactly the lane walk-back register in all fourteen languages', () => {
  const ids = note
    .matchAll(/^- \*\*(WB-\d+)\*\*/gm)
    .map((match) => match[1])
    .toArray()
    .toSorted((a, b) => a.localeCompare(b))
  expect(
    [...new Set(register.items.map((item) => item.id))].toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(ids)
  const names = [
    ...new Set([
      'package.json',
      ...register.items.flatMap((item) =>
        item.kind === 'setting'
          ? Object.keys(item.descriptions)
          : [item.file].filter((file) => file !== undefined),
      ),
    ]),
  ].filter((file) => existsSync(file))
  const files = new Map(names.map((file) => [file, readFileSync(file, 'utf8')]))
  const registry = register.items.find((item) => item.kind === 'registry')
  const unavailable = `export const UNAVAILABLE_SETTINGS = { 'museSpark.accountSwap': 'settingsUnavailableAccounts', 'museSpark.accountParallel': 'settingsUnavailableAccounts', 'museSpark.accounts.severalOnThisDevice': 'settingsUnavailableAccounts', 'museSpark.vault.enabled': 'settingsUnavailableVault' }`
  files.set(registry.file, unavailable)
  names.push(registry.file)
  const pending = Object.fromEntries(
    names
      .filter((file) => file.startsWith('package.nls'))
      .map((file) => [
        file,
        file === 'package.nls.json'
          ? EN.accounts.certificationPending
          : JSON.parse(
              readFileSync(
                `l10n/ui.${file.slice('package.nls.'.length, -'.json'.length)}.json`,
                'utf8',
              ),
            ).accounts.certificationPending,
      ]),
  )
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
  const closed = accountReleaseFiles(
    files,
    ACCOUNT_REQUEST_CERTIFICATION.isComplete,
    register,
    pending,
  )
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
  const opened = accountReleaseFiles(
    closed,
    ACCOUNT_REQUEST_CERTIFICATION.isComplete,
    register,
    pending,
  )
  expect(
    opened
      .keys()
      .toArray()
      .toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(names.toSorted((a, b) => a.localeCompare(b)))
  const expected = new Map(closed)
  const manifest = JSON.parse(closed.get('package.json'))
  const settings = register.items.filter((item) => item.kind === 'setting')
  expect(settings.map((item) => item.setting)).toEqual(['accountSwap', 'accountParallel'])
  for (const item of settings) {
    expect(Object.keys(item.descriptions)).toHaveLength(15)
    delete manifest.contributes.configuration.properties[`museSpark.${item.setting}`]
      .deprecationMessage
    for (const [file, description] of Object.entries(item.descriptions)) {
      const table = JSON.parse(expected.get(file))
      table[`config.${item.setting}.description`] = description
      expected.set(file, JSON.stringify(table, null, 2) + '\n')
      expect(JSON.parse(opened.get(file))[`config.${item.setting}.description`]).toBe(description)
      expect(pending[file]).toBeTruthy()
    }
  }
  expected.set('package.json', JSON.stringify(manifest, null, 2) + '\n')
  for (const item of register.items) {
    if (item.kind !== 'text') continue
    expected.set(
      item.file,
      expected.get(item.file).replace(item.held, () => item.restored),
    )
  }
  const registryOutput = opened.get(registry.file)
  expect(registryOutput).not.toContain('museSpark.accountSwap')
  expect(registryOutput).not.toContain('museSpark.accountParallel')
  expect(registryOutput).toContain('museSpark.accounts.severalOnThisDevice')
  expect(registryOutput).toContain('museSpark.vault.enabled')
  const registryTokens = registryOutput.match(/['"][^'"]+['"]/g)
  expect(registryTokens).toEqual([
    "'museSpark.accounts.severalOnThisDevice'",
    "'settingsUnavailableAccounts'",
    "'museSpark.vault.enabled'",
    "'settingsUnavailableVault'",
  ])
  expected.set(registry.file, registryOutput)
  expect(opened).toEqual(expected)
  expect(historical(opened.get('CHANGELOG.md'))).toBe(historical(closed.get('CHANGELOG.md')))
  const properties = JSON.parse(opened.get('package.json')).contributes.configuration.properties
  expect(properties['museSpark.accounts.severalOnThisDevice']).toEqual(
    JSON.parse(closed.get('package.json')).contributes.configuration.properties[
      'museSpark.accounts.severalOnThisDevice'
    ],
  )
  const model = {
    cli: [
      { name: 'exec: --account' },
      { name: 'exec: --account-pool' },
      { name: 'providers accounts: --provider' },
    ],
  }
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
  expect(
    accountReleaseReference(model, ACCOUNT_REQUEST_CERTIFICATION.isComplete).cli.map(
      (row) => row.name,
    ),
  ).toEqual(['exec: --account', 'providers accounts: --provider'])
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
  expect(accountReleaseReference(model, ACCOUNT_REQUEST_CERTIFICATION.isComplete)).toEqual(model)
  expect(featureCatalog().find((row) => row.id === 'accounts')?.surfaces).toEqual([
    'vscode:modelApi',
    'acp:modelApi',
  ])
  for (const file of Object.keys(pending)) {
    const table =
      file === 'package.nls.json'
        ? EN
        : JSON.parse(
            readFileSync(
              `l10n/ui.${file.slice('package.nls.'.length, -'.json'.length)}.json`,
              'utf8',
            ),
          )
    ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
    expect(formatAcpUsage(table, 'muse-spark-code-acp')).toContain('--account-pool')
    ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
    expect(formatAcpUsage(table, 'muse-spark-code-acp')).not.toContain('--account-pool')
  }
  expect(featureCatalog().find((row) => row.id === 'accounts')?.surfaces).toEqual(['acp:modelApi'])
})
