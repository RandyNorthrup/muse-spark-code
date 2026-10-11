// RVCM1133: every way an accounts or security source can be absent,
// partial or failed keeps its own true reason all the way into the source
// record — through the real reader and the real source port. Nothing
// collapses into a generic missing file, and no partial reports success
// with silently dropped rows.
import { link, mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { accountsSource } from '../../src/core/reporting/sources/accounts'
import { securitySource } from '../../src/core/reporting/sources/security'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import type { AccountsFacts } from '../../src/core/reporting/sources/types'
import {
  ACCOUNTS_REPORT_SUB_SOURCES,
  SECURITY_REPORT_SUB_SOURCES,
  createAccountsReportReader,
  createSecurityReportReader,
  type SecurityVaultSnapshot,
} from '../../src/runtime/reporting/reportInputs'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import { tempDirTracker, writeDeveloperAudit } from './helpers/reporting/tempDir'
import { canaryVaultSnapshot } from './helpers/reporting/canaryVault'

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

type SecurityReaderInput = Parameters<typeof createSecurityReportReader>[0]

const readAccounts = (dataDir: string) =>
  accountsSource(createAccountsReportReader({ dataDir }), scrub).read(ctxFor('accounts'))

const readSecurity = (dataDir: string, readVault?: SecurityReaderInput['readVault']) =>
  securitySource(
    createSecurityReportReader({ dataDir, ...(readVault !== undefined && { readVault }) }),
    scrub,
  ).read(ctxFor('security'))

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

const checkNull = (data: unknown) => {
  expect(data).toBeNull()
}

const cases: readonly ReasonCase[] = [
  {
    name: 'accounts/absent registry reads missing',
    run: (dataDir) => readAccounts(dataDir),
    want: {
      status: 'unavailable',
      reasons: [EN.reportSourceReasons.missing],
      check: checkNull,
    },
  },
  {
    name: 'accounts/valid registry with no adapters names the missing facets',
    run: async (dataDir) => {
      await writeFile(path.join(dataDir, 'providers.json'), registryWith({ meta: goodMetaEntry() }))
      return await readAccounts(dataDir)
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
      return await readAccounts(dataDir)
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
    name: 'accounts/no good entry keeps the invalid reason as a partial',
    run: async (dataDir) => {
      await writeFile(
        path.join(dataDir, 'providers.json'),
        registryWith({ broken: { id: 'broken', auth: 'oauth' } }),
      )
      return await readAccounts(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(providerIds(data)).toEqual([])
      },
    },
  },
  {
    name: 'accounts/corrupt registry keeps the invalid reason as a partial',
    run: async (dataDir) => {
      await writeFile(path.join(dataDir, 'providers.json'), '{nope')
      return await readAccounts(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(providerIds(data)).toEqual([])
      },
    },
  },
  {
    name: 'accounts/linked registry refuses as one failed sub-source',
    run: async (dataDir) => {
      const outside = await temps.dir('m113-reasons-outside-')
      await writeFile(path.join(outside, 'providers.json'), registryWith({ meta: goodMetaEntry() }))
      await symlink(path.join(outside, 'providers.json'), path.join(dataDir, 'providers.json'))
      return await readAccounts(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.refused],
      check: (data) => {
        expect(providerIds(data)).toEqual([])
      },
    },
  },
  {
    name: 'security/both absent names both reasons as a partial',
    run: (dataDir) => readSecurity(dataDir),
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
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [auditLine('unlock', 'palette')])
      return await readSecurity(dataDir)
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
    name: 'security/invalid vault item keeps zero counts and the readable developer audit',
    run: async (dataDir) => {
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [auditLine('enable', 'page')])
      // Fails the vault item metadata schema: the bad item is skipped, not
      // the whole vault view (RVCM1133B P2).
      const snapshot: SecurityVaultSnapshot = {
        state: 'unlocked',
        tier: 'osStore',
        items: [{ kind: 'password' }],
        grants: [],
        audit: [],
      }
      return await readSecurity(dataDir, () => Promise.resolve(snapshot))
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(data).toEqual({
          vault: {
            state: 'unlocked',
            tier: 'osStore',
            itemCount: 0,
            itemsByKind: [],
            grants: [],
          },
          audit: [],
          developerAudit: [{ action: 'enable', source: 'page' }],
        })
      },
    },
  },
  {
    name: 'security/corrupt audit keeps the invalid reason as a partial',
    run: async (dataDir) => {
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', ['{nope}\n'])
      return await readSecurity(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportDetailReasons.securityVaultUnavailable, EN.reportSourceReasons.invalid],
      check: (data) => {
        expect(data).toEqual({ vault: null, audit: [], developerAudit: [] })
      },
    },
  },
  {
    name: 'security/linked audit refuses as one failed sub-source',
    run: async (dataDir) => {
      const outside = await temps.dir('m113-reasons-outside-')
      await writeFile(path.join(outside, 'developer-audit.jsonl'), auditLine('unlock', 'palette'))
      await mkdir(path.join(dataDir, 'developer'), { recursive: true })
      await symlink(
        path.join(outside, 'developer-audit.jsonl'),
        path.join(dataDir, 'developer', 'developer-audit.jsonl'),
      )
      return await readSecurity(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportDetailReasons.securityVaultUnavailable, EN.reportSourceReasons.refused],
      check: (data) => {
        expect(data).toEqual({ vault: null, audit: [], developerAudit: [] })
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

// RVCM1133B: no read discards rows it already accepted, or partial reasons
// it already collected, because one later record or one sub-source failed.
// Every case below breaks exactly one sub-source while all the others are
// good, and asserts the others' rows and reasons survive. A hard-linked
// file is the portable unreadable file case (refused like a symlink);
// adapters fail by throwing or by returning malformed rows.
type AccountsReaderInput = Parameters<typeof createAccountsReportReader>[0]

const goodUsageRows = (): AccountsFacts['usage'] => [
  {
    provider: 'meta',
    account: 'primary',
    label: 'Primary',
    period: 'day',
    inputTokens: 1,
    outputTokens: 2,
    costUsd: null,
    certainty: 'reported',
  },
]

const goodEventsResult = (): Pick<AccountsFacts, 'events' | 'confirmations'> => ({
  events: [
    {
      type: 'swap',
      provider: 'meta',
      account: 'primary',
      time: '2026-10-01T00:00:00.000Z',
      trigger: 'userCap/spendUsd/day',
      previousAccount: null,
    },
  ],
  confirmations: [
    {
      provider: 'meta',
      product: 'muse',
      choice: 'confirm',
      answeredAt: '2026-10-01T00:00:00.000Z',
    },
  ],
})

const writeGoodRegistry = (dataDir: string) =>
  writeFile(path.join(dataDir, 'providers.json'), registryWith({ meta: goodMetaEntry() }))

const writeGoodAudits = (dataDir: string) =>
  Promise.all([
    writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [auditLine('unlock', 'palette')]),
    writeDeveloperAudit(dataDir, 'developer-audit.jsonl.previous', [auditLine('enable', 'page')]),
  ])

const readAccountsFull = (
  dataDir: string,
  overrides?: Partial<Pick<AccountsReaderInput, 'readUsage' | 'readEvents'>>,
) =>
  accountsSource(
    createAccountsReportReader({
      dataDir,
      readUsage: () => Promise.resolve(goodUsageRows()),
      readEvents: () => Promise.resolve(goodEventsResult()),
      ...overrides,
    }),
    scrub,
  ).read(ctxFor('accounts'))

const readSecurityFull = (dataDir: string, overrides?: Partial<SecurityReaderInput>) =>
  securitySource(
    createSecurityReportReader({
      dataDir,
      readVault: () => Promise.resolve(canaryVaultSnapshot()),
      ...overrides,
    }),
    scrub,
  ).read(ctxFor('security'))

const hardLinkBeside = async (file: string) => {
  await link(file, `${file}.shadow`)
}

interface ResilienceCase extends ReasonCase {
  readonly subSource: string
  readonly mode: 'unreadable' | 'unparseable' | 'badRecord' | 'wrongVersion'
}

const resilienceCases: readonly ResilienceCase[] = [
  {
    name: 'resilience/registry unreadable keeps the adapter rows with the refused reason',
    subSource: 'registry',
    mode: 'unreadable',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      await hardLinkBeside(path.join(dataDir, 'providers.json'))
      return await readAccountsFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.refused],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers).toEqual([])
        expect(facts.usage).toHaveLength(1)
        expect(facts.events).toHaveLength(1)
        expect(facts.confirmations).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/registry unparseable keeps the adapter rows with the invalid reason',
    subSource: 'registry',
    mode: 'unparseable',
    run: async (dataDir) => {
      await writeFile(path.join(dataDir, 'providers.json'), '{nope')
      return await readAccountsFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers).toEqual([])
        expect(facts.usage).toHaveLength(1)
        expect(facts.events).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/registry bad record keeps the good provider and the adapters',
    subSource: 'registry',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeFile(
        path.join(dataDir, 'providers.json'),
        registryWith({ meta: goodMetaEntry(), broken: { id: 'broken', auth: 'oauth' } }),
      )
      return await readAccountsFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers.map((entry) => entry.provider)).toEqual(['meta'])
        expect(facts.usage).toHaveLength(1)
        expect(facts.confirmations).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/registry wrong version keeps the adapter rows with the invalid reason',
    subSource: 'registry',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ v: 1 }))
      return await readAccountsFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers).toEqual([])
        expect(facts.usage).toHaveLength(1)
        expect(facts.events).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/usage unreadable keeps the registry and events with the failed reason',
    subSource: 'usage',
    mode: 'unreadable',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      return await readAccountsFull(dataDir, {
        readUsage: () => Promise.reject(new LocalSourceError('failed')),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.failed],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers.map((entry) => entry.provider)).toEqual(['meta'])
        expect(facts.usage).toEqual([])
        expect(facts.events).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/usage unparseable keeps the registry and events with the invalid reason',
    subSource: 'usage',
    mode: 'unparseable',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      return await readAccountsFull(dataDir, {
        readUsage: () => Promise.resolve('{nope}' as unknown as AccountsFacts['usage']),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers.map((entry) => entry.provider)).toEqual(['meta'])
        expect(facts.usage).toEqual([])
        expect(facts.confirmations).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/usage bad record keeps the good row with the invalid reason',
    subSource: 'usage',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      return await readAccountsFull(dataDir, {
        readUsage: () =>
          Promise.resolve([
            ...goodUsageRows(),
            { provider: 'meta' } as unknown as AccountsFacts['usage'][number],
          ]),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers.map((entry) => entry.provider)).toEqual(['meta'])
        expect(facts.usage).toHaveLength(1)
        expect(facts.events).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/usage wrong version skips the newer row with the invalid reason',
    subSource: 'usage',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      const [row] = goodUsageRows()
      return await readAccountsFull(dataDir, {
        readUsage: () =>
          Promise.resolve([
            row,
            { ...row, future: 'x' } as unknown as AccountsFacts['usage'][number],
          ]),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.usage).toHaveLength(1)
        expect(facts.events).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/events unreadable keeps the registry and usage with the failed reason',
    subSource: 'events',
    mode: 'unreadable',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      return await readAccountsFull(dataDir, {
        readEvents: () => Promise.reject(new LocalSourceError('failed')),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.failed],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.providers.map((entry) => entry.provider)).toEqual(['meta'])
        expect(facts.usage).toHaveLength(1)
        expect(facts.events).toEqual([])
        expect(facts.confirmations).toEqual([])
      },
    },
  },
  {
    name: 'resilience/events unparseable keeps the confirmations with the invalid reason',
    subSource: 'events',
    mode: 'unparseable',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      const good = goodEventsResult()
      return await readAccountsFull(dataDir, {
        readEvents: () =>
          Promise.resolve({
            events: 'x',
            confirmations: good.confirmations,
          } as unknown as Pick<AccountsFacts, 'events' | 'confirmations'>),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.events).toEqual([])
        expect(facts.confirmations).toHaveLength(1)
        expect(facts.usage).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/events bad record keeps the good event and confirmations',
    subSource: 'events',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      const good = goodEventsResult()
      return await readAccountsFull(dataDir, {
        readEvents: () =>
          Promise.resolve({
            events: [
              ...good.events,
              { ...good.events[0], type: 'bogus' },
            ] as unknown as AccountsFacts['events'],
            confirmations: good.confirmations,
          }),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.events).toHaveLength(1)
        expect(facts.confirmations).toHaveLength(1)
      },
    },
  },
  {
    name: 'resilience/events wrong version skips the newer confirmation',
    subSource: 'events',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeGoodRegistry(dataDir)
      const good = goodEventsResult()
      return await readAccountsFull(dataDir, {
        readEvents: () =>
          Promise.resolve({
            events: good.events,
            confirmations: [
              { ...good.confirmations[0], future: 'x' },
            ] as unknown as AccountsFacts['confirmations'],
          }),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as AccountsFacts
        expect(facts.events).toHaveLength(1)
        expect(facts.confirmations).toEqual([])
      },
    },
  },
  {
    name: 'resilience/vault unreadable keeps the developer audit with the failed reason',
    subSource: 'vault',
    mode: 'unreadable',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      return await readSecurityFull(dataDir, {
        readVault: () => Promise.reject(new LocalSourceError('failed')),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.failed],
      check: (data) => {
        const facts = data as {
          vault: null
          audit: unknown[]
          developerAudit: { action: string }[]
        }
        expect(facts.vault).toBeNull()
        expect(facts.audit).toEqual([])
        const actions = facts.developerAudit.map((row) => row.action)
        expect(actions).toHaveLength(2)
        expect(actions).toEqual(expect.arrayContaining(['enable', 'unlock']))
      },
    },
  },
  {
    name: 'resilience/vault unparseable keeps the developer audit with the invalid reason',
    subSource: 'vault',
    mode: 'unparseable',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      return await readSecurityFull(dataDir, {
        readVault: () =>
          Promise.resolve({
            state: 'unlocked',
            tier: 'osStore',
            items: 'x',
            grants: [],
            audit: [],
          } as unknown as SecurityVaultSnapshot),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { vault: { itemCount: number }; developerAudit: unknown[] }
        expect(facts.vault.itemCount).toBe(0)
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/vault bad record counts the good items with the invalid reason',
    subSource: 'vault',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      const snapshot = canaryVaultSnapshot()
      return await readSecurityFull(dataDir, {
        readVault: () =>
          Promise.resolve({ ...snapshot, items: [...snapshot.items, { kind: 'password' }] }),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as {
          vault: { itemCount: number; grants: unknown[] }
          audit: unknown[]
          developerAudit: unknown[]
        }
        expect(facts.vault.itemCount).toBe(1)
        expect(facts.vault.grants).toHaveLength(1)
        expect(facts.audit).toHaveLength(1)
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/vault wrong version keeps the developer audit with the invalid reason',
    subSource: 'vault',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      return await readSecurityFull(dataDir, {
        readVault: () =>
          Promise.resolve({
            ...canaryVaultSnapshot(),
            state: 'bogus',
          } as unknown as SecurityVaultSnapshot),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { vault: null; developerAudit: unknown[] }
        expect(facts.vault).toBeNull()
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/vaultAudit bad record keeps the good row and the vault counts',
    subSource: 'vaultAudit',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      const snapshot = canaryVaultSnapshot()
      return await readSecurityFull(dataDir, {
        readVault: () =>
          Promise.resolve({ ...snapshot, audit: [...snapshot.audit, { kind: 'environment' }] }),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as {
          vault: { itemCount: number }
          audit: { outcome: string }[]
          developerAudit: unknown[]
        }
        expect(facts.audit).toEqual([
          { kind: 'environment', decision: 'allow', authority: 'grant', outcome: 'succeeded' },
        ])
        expect(facts.vault.itemCount).toBe(1)
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/vaultAudit wrong version keeps the vault counts with the invalid reason',
    subSource: 'vaultAudit',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      const snapshot = canaryVaultSnapshot()
      const [first] = snapshot.audit
      return await readSecurityFull(dataDir, {
        readVault: () =>
          Promise.resolve({
            ...snapshot,
            audit: [{ ...(first as Record<string, unknown>), v: 2 }],
          }),
      })
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as {
          vault: { itemCount: number }
          audit: unknown[]
          developerAudit: unknown[]
        }
        expect(facts.audit).toEqual([])
        expect(facts.vault.itemCount).toBe(1)
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/developerAudit unreadable keeps the vault and the previous rotation',
    subSource: 'developerAudit',
    mode: 'unreadable',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await hardLinkBeside(path.join(dataDir, 'developer', 'developer-audit.jsonl'))
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.refused],
      check: (data) => {
        const facts = data as {
          vault: { state: string }
          developerAudit: { action: string }[]
        }
        expect(facts.vault.state).toBe('unlocked')
        expect(facts.developerAudit).toEqual([{ action: 'enable', source: 'page' }])
      },
    },
  },
  {
    name: 'resilience/developerAudit unparseable keeps the vault and the previous rotation',
    subSource: 'developerAudit',
    mode: 'unparseable',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', ['{nope}\n'])
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as {
          vault: { state: string }
          developerAudit: { action: string }[]
        }
        expect(facts.vault.state).toBe('unlocked')
        expect(facts.developerAudit).toEqual([{ action: 'enable', source: 'page' }])
      },
    },
  },
  {
    name: 'resilience/developerAudit bad record keeps the good line beside it',
    subSource: 'developerAudit',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [
        auditLine('unlock', 'palette'),
        'not-json\n',
      ])
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { developerAudit: { action: string }[]; vault: { state: string } }
        expect(facts.developerAudit).toContainEqual({ action: 'unlock', source: 'palette' })
        expect(facts.developerAudit).toContainEqual({ action: 'enable', source: 'page' })
        expect(facts.vault.state).toBe('unlocked')
      },
    },
  },
  {
    name: 'resilience/developerAudit wrong version skips the newer line',
    subSource: 'developerAudit',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [
        `${JSON.stringify({ v: 2, time: 1, action: 'unlock', source: 'palette' })}\n`,
        auditLine('unlock', 'palette'),
      ])
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { developerAudit: unknown[] }
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/developerAuditPrevious unreadable keeps the vault and the current rotation',
    subSource: 'developerAuditPrevious',
    mode: 'unreadable',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await hardLinkBeside(path.join(dataDir, 'developer', 'developer-audit.jsonl.previous'))
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.refused],
      check: (data) => {
        const facts = data as {
          vault: { state: string }
          developerAudit: { action: string }[]
        }
        expect(facts.vault.state).toBe('unlocked')
        expect(facts.developerAudit).toEqual([{ action: 'unlock', source: 'palette' }])
      },
    },
  },
  {
    name: 'resilience/developerAuditPrevious unparseable keeps the current rotation',
    subSource: 'developerAuditPrevious',
    mode: 'unparseable',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl.previous', ['{nope}\n'])
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { developerAudit: { action: string }[] }
        expect(facts.developerAudit).toEqual([{ action: 'unlock', source: 'palette' }])
      },
    },
  },
  {
    name: 'resilience/developerAuditPrevious bad record keeps every good line',
    subSource: 'developerAuditPrevious',
    mode: 'badRecord',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl.previous', [
        auditLine('enable', 'page'),
        '{nope}\n',
      ])
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { developerAudit: unknown[] }
        expect(facts.developerAudit).toHaveLength(2)
      },
    },
  },
  {
    name: 'resilience/developerAuditPrevious wrong version skips the newer line',
    subSource: 'developerAuditPrevious',
    mode: 'wrongVersion',
    run: async (dataDir) => {
      await writeGoodAudits(dataDir)
      await writeDeveloperAudit(dataDir, 'developer-audit.jsonl.previous', [
        `${JSON.stringify({ v: 2, time: 2, action: 'enable', source: 'page' })}\n`,
      ])
      return await readSecurityFull(dataDir)
    },
    want: {
      status: 'partial',
      reasons: [EN.reportSourceReasons.invalid],
      check: (data) => {
        const facts = data as { developerAudit: { action: string }[] }
        expect(facts.developerAudit).toEqual([{ action: 'unlock', source: 'palette' }])
      },
    },
  },
]

/** Every way each sub-source can fail. A sub-source that gains a new way
 * to fail grows this map, which fails the coverage test until its case
 * exists. */
const REQUIRED_MODES: Record<string, readonly ResilienceCase['mode'][]> = {
  registry: ['unreadable', 'unparseable', 'badRecord', 'wrongVersion'],
  usage: ['unreadable', 'unparseable', 'badRecord', 'wrongVersion'],
  events: ['unreadable', 'unparseable', 'badRecord', 'wrongVersion'],
  vault: ['unreadable', 'unparseable', 'badRecord', 'wrongVersion'],
  // The vault audit arrives inside the snapshot, so only its records can
  // fail on their own; a snapshot that is not a row list is the vault case.
  vaultAudit: ['badRecord', 'wrongVersion'],
  developerAudit: ['unreadable', 'unparseable', 'badRecord', 'wrongVersion'],
  developerAuditPrevious: ['unreadable', 'unparseable', 'badRecord', 'wrongVersion'],
}

const byCodeUnit = (left: string, right: string): number => {
  if (left === right) return 0
  return left < right ? -1 : 1
}

describe('accounts and security sub-source resilience', () => {
  it.each(resilienceCases)('$name', async ({ run, want }) => {
    const dataDir = await temps.dir('m113-resilience-')
    const result = await run(dataDir)
    expect(result.record.status).toBe(want.status)
    const reason = typeof result.record.reason === 'string' ? result.record.reason : ''
    for (const sentence of want.reasons) expect(reason).toContain(sentence)
    // No record text ever reaches a reason: only fixed sentences travel.
    expect(reason).not.toContain('{nope}')
    expect(reason).not.toContain('bogus')
    want.check?.(result.data)
  })

  it('covers every sub-source in every way it can fail', () => {
    const inventories = [...ACCOUNTS_REPORT_SUB_SOURCES, ...SECURITY_REPORT_SUB_SOURCES]
    expect(new Set(inventories).size).toBe(inventories.length)
    for (const source of inventories) {
      const modes = resilienceCases
        .filter((entry) => entry.subSource === source)
        .map((entry) => entry.mode)
        .toSorted(byCodeUnit)
      expect(modes).toEqual([...(REQUIRED_MODES[source] ?? [])].toSorted(byCodeUnit))
    }
    const outside = resilienceCases.filter(
      (entry) =>
        !(inventories as readonly string[]).includes(entry.subSource) ||
        !(REQUIRED_MODES[entry.subSource] ?? []).includes(entry.mode),
    )
    expect(outside).toEqual([])
  })
})
