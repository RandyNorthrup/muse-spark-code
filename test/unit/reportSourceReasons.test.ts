// RVCM1133: every way an accounts or security source can be absent,
// partial or failed keeps its own true reason all the way into the source
// record — through the real reader and the real source port. Nothing
// collapses into a generic missing file, and no partial reports success
// with silently dropped rows.
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { accountsSource } from '../../src/core/reporting/sources/accounts'
import { securitySource } from '../../src/core/reporting/sources/security'
import {
  createAccountsReportReader,
  createSecurityReportReader,
} from '../../src/runtime/reporting/reportInputs'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import { tempDirTracker } from './helpers/reporting/tempDir'

setUiText(EN, 'en')

const temps = tempDirTracker()
afterEach(async () => {
  setUiText(EN, 'en')
  await temps.cleanup()
})

const ctxFor = (kind: 'accounts' | 'security') => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: {
    kind,
    asOf: REPORT_FIXTURE_AS_OF,
    scope: '',
    full: false,
    network: false,
    failOn: [],
  },
  signal: new AbortController().signal,
})

const scrub = (text: string) => text

const goodMetaEntry = () => ({
  id: 'meta',
  product: 'muse',
  auth: 'oauth',
  accounts: [{ id: 'primary', label: 'Primary', order: 0, thresholds: {} }],
})
const registryWith = (providers: unknown) => JSON.stringify({ v: 1, providers })
const auditLine = (action: string, source: string) =>
  `${JSON.stringify({ v: 1, time: 1, action, source })}\n`

interface ReasonCase {
  readonly name: string
  readonly run: (dataDir: string) => Promise<{
    record: { status: string; reason: unknown }
    data: unknown
  }>
  readonly want: {
    readonly status: string
    readonly reasons: readonly string[]
    readonly check?: (data: unknown) => void
  }
}

const providerIds = (data: unknown) =>
  (data as { providers: { provider: string }[] }).providers.map((entry) => entry.provider)

const cases: readonly ReasonCase[] = [
  {
    name: 'accounts/absent registry reads missing',
    run: async (dataDir) => {
      const source = accountsSource(createAccountsReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('accounts'))
    },
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.missing],
      check: (data) => {
        expect(data).toBeNull()
      },
    },
  },
  {
    name: 'accounts/valid registry with no adapters names the missing facets',
    run: async (dataDir) => {
      await writeFile(path.join(dataDir, 'providers.json'), registryWith({ meta: goodMetaEntry() }))
      const source = accountsSource(createAccountsReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('accounts'))
    },
    want: {
      status: 'partial',
      reasons: ['Unavailable account details: usage, swaps, confirmations.'],
      check: (data) => {
        expect(providerIds(data)).toEqual(['meta'])
      },
    },
  },
  {
    name: 'accounts/one bad entry keeps the good provider with the invalid reason',
    run: async (dataDir) => {
      await writeFile(
        path.join(dataDir, 'providers.json'),
        registryWith({
          meta: goodMetaEntry(),
          // Schema-invalid: no product (RVCM1133 P2 scenario).
          broken: { id: 'broken', auth: 'oauth' },
        }),
      )
      const source = accountsSource(createAccountsReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('accounts'))
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(providerIds(data)).toEqual(['meta'])
      },
    },
  },
  {
    name: 'accounts/no good entry reads invalid, not failed',
    run: async (dataDir) => {
      await writeFile(
        path.join(dataDir, 'providers.json'),
        registryWith({ broken: { id: 'broken', auth: 'oauth' } }),
      )
      const source = accountsSource(createAccountsReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('accounts'))
    },
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(data).toBeNull()
      },
    },
  },
  {
    name: 'accounts/corrupt registry reads invalid',
    run: async (dataDir) => {
      await writeFile(path.join(dataDir, 'providers.json'), '{nope')
      const source = accountsSource(createAccountsReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('accounts'))
    },
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(data).toBeNull()
      },
    },
  },
  {
    name: 'accounts/linked registry refuses like a linked session file',
    run: async (dataDir) => {
      const outside = await temps.dir('m113-reasons-outside-')
      await writeFile(path.join(outside, 'providers.json'), registryWith({ meta: goodMetaEntry() }))
      await symlink(path.join(outside, 'providers.json'), path.join(dataDir, 'providers.json'))
      const source = accountsSource(createAccountsReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('accounts'))
    },
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.refused],
      check: (data) => {
        expect(data).toBeNull()
      },
    },
  },
  {
    name: 'security/both absent names both reasons as a partial',
    run: async (dataDir) => {
      const source = securitySource(createSecurityReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('security'))
    },
    want: {
      status: 'partial',
      reasons: [
        EN.reportDetailReasons.securityVaultUnavailable,
        EN.reportDetailReasons.securityDeveloperAuditUnavailable,
      ],
      check: (data) => {
        expect(data).toEqual({ vault: null, audit: [], developerAudit: [] })
      },
    },
  },
  {
    name: 'security/audit without a vault names only the vault reason',
    run: async (dataDir) => {
      await mkdir(path.join(dataDir, 'developer'), { recursive: true })
      await writeFile(
        path.join(dataDir, 'developer', 'developer-audit.jsonl'),
        auditLine('unlock', 'palette'),
      )
      const source = securitySource(createSecurityReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('security'))
    },
    want: {
      status: 'partial',
      reasons: [EN.reportDetailReasons.securityVaultUnavailable],
      check: (data) => {
        expect(data).toEqual({
          vault: null,
          audit: [],
          developerAudit: [{ action: 'unlock', source: 'palette' }],
        })
      },
    },
  },
  {
    name: 'security/invalid vault keeps the readable developer audit',
    run: async (dataDir) => {
      await mkdir(path.join(dataDir, 'developer'), { recursive: true })
      await writeFile(
        path.join(dataDir, 'developer', 'developer-audit.jsonl'),
        auditLine('enable', 'page'),
      )
      const source = securitySource(
        createSecurityReportReader({
          dataDir,
          readVault: () =>
            Promise.resolve({
              state: 'unlocked' as const,
              tier: 'osStore',
              // Fails the vault item metadata schema: no valid snapshot.
              items: [{ kind: 'password' }],
              grants: [],
              audit: [],
            }),
        }),
        scrub,
      )
      return await source.read(ctxFor('security'))
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(data).toEqual({
          vault: null,
          audit: [],
          developerAudit: [{ action: 'enable', source: 'page' }],
        })
      },
    },
  },
  {
    name: 'security/corrupt audit reads invalid',
    run: async (dataDir) => {
      await mkdir(path.join(dataDir, 'developer'), { recursive: true })
      await writeFile(path.join(dataDir, 'developer', 'developer-audit.jsonl'), '{nope}\n')
      const source = securitySource(createSecurityReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('security'))
    },
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(data).toBeNull()
      },
    },
  },
  {
    name: 'security/linked audit refuses like a linked session file',
    run: async (dataDir) => {
      const outside = await temps.dir('m113-reasons-outside-')
      await writeFile(path.join(outside, 'developer-audit.jsonl'), auditLine('unlock', 'palette'))
      await mkdir(path.join(dataDir, 'developer'), { recursive: true })
      await symlink(
        path.join(outside, 'developer-audit.jsonl'),
        path.join(dataDir, 'developer', 'developer-audit.jsonl'),
      )
      const source = securitySource(createSecurityReportReader({ dataDir }), scrub)
      return await source.read(ctxFor('security'))
    },
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.refused],
      check: (data) => {
        expect(data).toBeNull()
      },
    },
  },
]

describe('accounts and security source reasons', () => {
  it.each(cases)('$name', async ({ run, want }) => {
    const dataDir = await temps.dir('m113-reasons-')
    const result = await run(dataDir)
    expect(result.record.status).toBe(want.status)
    const reason = typeof result.record.reason === 'string' ? result.record.reason : ''
    for (const sentence of want.reasons) expect(reason).toContain(sentence)
    want.check?.(result.data)
  })
})
