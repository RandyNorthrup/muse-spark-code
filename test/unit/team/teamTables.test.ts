// Lane R (M96, PLAN.md D75): the team strings in every table.
//
// Replicates the localization gate's table check for the translation
// tables (scripts/check-l10n.mjs): every key and no extra one, the same
// slots, and no value left in English unless l10n/untranslated.json allows
// it. The gate itself cannot run in this sandbox (its bundler reads
// directories the sandbox denies); this test runs the same
// `tableProblems` over the same files.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tableProblems } from '../../../src/shared/l10n/check'
import { EN } from '../../../src/shared/l10n/en'
import { TABLE_LOCALES, tableFileName } from '../../../src/shared/l10n/locales'
import { fill } from '../../../src/shared/l10n/text'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..', '..')
const tablePath = (locale: string) => path.join(repoRoot, 'l10n', tableFileName(locale))

const untranslated = JSON.parse(
  readFileSync(path.join(repoRoot, 'l10n', 'untranslated.json'), 'utf8'),
) as { readonly ui: Readonly<Record<string, readonly string[]>> }

const allowedFor = (locale: string): Set<string> =>
  new Set([...(untranslated.ui['*'] ?? []), ...(untranslated.ui[locale] ?? [])])

const TEAM_KEYS = [
  'teamCapabilityNoTools',
  'teamCapabilitySmallWindow',
  'teamCapabilityWarnWindow',
  'teamCapabilityWarnImages',
  'teamCapabilityWarnReasoning',
  'teamCapabilityUnknown',
  'teamRoleFileRefused',
  'teamJsonRefused',
  'teamRoleNeedsAllowance',
] as const

describe('team strings', () => {
  it('adds every team key to the English table', () => {
    for (const key of TEAM_KEYS) {
      expect(typeof EN[key]).toBe('string')
    }
  })

  it.each(TABLE_LOCALES)('ui.%s.json passes the gate check', (locale) => {
    const table = JSON.parse(readFileSync(tablePath(locale), 'utf8')) as Record<string, unknown>
    expect(
      tableProblems(EN, table, { locale, isStrict: true, untranslated: allowedFor(locale) }),
    ).toEqual([])
  })

  it('fills every team template', () => {
    const values = { role: 'research', tokens: 16_384, minimum: 32_768, recommended: 131_072 }
    for (const key of TEAM_KEYS) {
      const filled = fill(EN[key], { ...values, model: 'm', file: 'f', detail: 'd', id: 'i' })
      expect(filled).not.toContain('{')
    }
  })
})
