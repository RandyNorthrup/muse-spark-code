import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { REPORT_MAX_ROWS } from '../../src/shared/constants'
import { EN, type UiText } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { reportDocumentSchema } from '../../src/shared/reportSchema'
import { accountsSource } from '../../src/core/reporting/sources/accounts'
import { securitySource } from '../../src/core/reporting/sources/security'
import {
  createAccountsReportReader,
  createSecurityReportReader,
} from '../../src/runtime/reporting/reportInputs'
import { collectFixture, getSection } from './helpers/reporting/kindFixtures'
import { availableSource, buildSourceSnapshot } from './helpers/reporting/kindFixtures'
import { reasonContext } from './helpers/reporting/reasonCases'
import { tempDirTracker } from './helpers/reporting/tempDir'
import { canaryVaultSnapshot } from './helpers/reporting/canaryVault'

const temps = tempDirTracker()
afterEach(() => temps.cleanup())
const usage = {
  provider: 'meta',
  account: 'primary',
  label: 'Primary',
  period: 'day',
  inputTokens: 1,
  outputTokens: 2,
  costUsd: null,
  certainty: 'reported',
} as const
const scrub = (text: string) => text
function slot<T>(row: T, error: unknown): T[] {
  const rows = [row, row, row]
  Object.defineProperty(rows, 1, {
    get() {
      throw error
    },
  })
  return rows
}

it('accounts and security preserve later slots and facets through real readers', async () => {
  const dataDir = await temps.dir('join-slots-')
  const accounts = await accountsSource(
    createAccountsReportReader({
      dataDir,
      readUsage: () => Promise.resolve(slot(usage, new Error('slot'))),
      readEvents: () => Promise.resolve({ events: [], confirmations: [] }),
    }),
    scrub,
  ).read(reasonContext('accounts'))
  expect(accounts.record.status).toBe('partial')
  expect(accounts.data?.usage).toHaveLength(2)
  const snapshot = canaryVaultSnapshot()
  const security = await securitySource(
    createSecurityReportReader({
      dataDir,
      readVault: () =>
        Promise.resolve({
          ...snapshot,
          audit: slot(
            snapshot.audit[0],
            // eslint-disable-next-line no-restricted-syntax -- poisoned prototype input: only a Proxy can make getPrototypeOf throw, which is what this recovery case proves the reader survives.
            new Proxy(
              {},
              {
                getPrototypeOf() {
                  throw new Error('recovery')
                },
              },
            ),
          ),
        }),
    }),
    scrub,
  ).read(reasonContext('security'))
  expect(security.record.status).toBe('partial')
  expect(security.data?.audit).toHaveLength(2)
  expect(security.data?.vault?.itemCount).toBe(1)
})

it('the real account reader, source, collector and final schema fit an exact cap with disclosure', async () => {
  const dataDir = await temps.dir('join-cap-')
  const result = await accountsSource(
    createAccountsReportReader({
      dataDir,
      readUsage: () =>
        Promise.resolve(
          Array.from({ length: REPORT_MAX_ROWS }, (_, index) => ({
            ...usage,
            account: String(index),
          })),
        ),
    }),
    scrub,
  ).read(reasonContext('accounts'))
  const document = collectFixture(
    'accounts',
    { full: true },
    buildSourceSnapshot({ accounts: result }),
  )
  const section = getSection(document, 'accounts/usage')
  expect(section.rows).toHaveLength(REPORT_MAX_ROWS)
  expect(section.omittedRows).toBe(1)
  expect(reportDocumentSchema.safeParse(document).success).toBe(true)
})

it('combined account limit arrays share the final section admission bound', () => {
  const thresholds = {
    spendUsd: [],
    percents: [],
    counts: Array.from({ length: REPORT_MAX_ROWS }, () => ({
      metric: 'requests' as const,
      period: 'day',
      value: 1,
    })),
  }
  const providers = [
    {
      provider: 'meta',
      product: 'muse',
      auth: 'oauth',
      accounts: [
        { id: 'one', label: 'One', order: 0, limitGroup: null, thresholds },
        { id: 'two', label: 'Two', order: 1, limitGroup: null, thresholds },
      ],
    },
  ]
  const document = collectFixture(
    'accounts',
    { full: true },
    buildSourceSnapshot({
      accounts: availableSource('accounts', {
        providers,
        usage: [],
        events: [],
        confirmations: [],
      }),
    }),
  )
  expect(getSection(document, 'accounts/limits').rows).toHaveLength(REPORT_MAX_ROWS)
  expect(getSection(document, 'accounts/limits').omittedRows).toBe(REPORT_MAX_ROWS)
  expect(reportDocumentSchema.safeParse(document).success).toBe(true)
})

function isSpanishTable(input: unknown): input is UiText {
  return tableProblems(EN, input, { locale: 'es', isStrict: false }).length === 0
}

it('absent account facets use the Spanish request labels', async () => {
  const value: unknown = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, '../../l10n/ui.es.json'), 'utf8'),
  )
  if (!isSpanishTable(value)) throw new Error('Invalid Spanish fixture')
  const dataDir = await temps.dir('join-spanish-')
  const result = await accountsSource(
    createAccountsReportReader({
      dataDir,
      readUsage: () => Promise.resolve(null),
      readEvents: () => Promise.resolve(undefined),
    }),
    scrub,
  ).read({ ...reasonContext('accounts'), reportText: value })
  expect(result.record.reason).toContain(
    [value.reportLabels.usage, value.reportLabels.swaps, value.reportLabels.confirmations].join(
      ', ',
    ),
  )
  expect(result.record.reason).not.toContain('usage, swaps, confirmations')
})
