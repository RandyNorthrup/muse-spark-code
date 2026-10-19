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
import { malformed } from './helpers/reporting/reasonCases'
import { tempDirTracker, writeDeveloperAudit } from './helpers/reporting/tempDir'
import { canaryVaultSnapshot } from './helpers/reporting/canaryVault'
import {
  assertReasonRecord,
  assertReasonResult,
  reasonContext,
} from './helpers/reporting/reasonCases'

setUiText(EN, 'en')

const temps = tempDirTracker()
afterEach(async () => {
  setUiText(EN, 'en')
  await temps.cleanup()
})

const scrub = (text: string) => text

type SecurityReaderInput = Parameters<typeof createSecurityReportReader>[0]

const readAccounts = (dataDir: string) =>
  accountsSource(createAccountsReportReader({ dataDir }), scrub).read(reasonContext('accounts'))

const readSecurity = (dataDir: string, readVault?: SecurityReaderInput['readVault']) =>
  securitySource(
    createSecurityReportReader({ dataDir, ...(readVault !== undefined && { readVault }) }),
    scrub,
  ).read(reasonContext('security'))

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

const checkNull = (data: unknown) => {
  expect(data).toBeNull()
}

/** One-line survivor assertions, so cases never paste check bodies. */
const checkAccounts =
  (want: {
    readonly providers?: readonly string[]
    readonly usage?: number
    readonly events?: number
    readonly confirmations?: number
  }): ((data: unknown) => void) =>
  (data) => {
    if (want.providers !== undefined) {
      expect(data).toHaveProperty('providers.length', want.providers.length)
      for (const [index, provider] of want.providers.entries())
        expect(data).toHaveProperty(`providers.${String(index)}.provider`, provider)
    }
    for (const facet of ['usage', 'events', 'confirmations'] as const)
      if (want[facet] !== undefined) expect(data).toHaveProperty(`${facet}.length`, want[facet])
  }

const enableRow = { action: 'enable', source: 'page' }
const unlockRow = { action: 'unlock', source: 'palette' }

const checkSecurity =
  (want: {
    readonly vault?: null | {
      readonly state: string
      readonly itemCount: number
      readonly grants?: number
    }
    readonly audit?: number | readonly unknown[]
    readonly developerAudit?: number | readonly unknown[]
  }): ((data: unknown) => void) =>
  (data) => {
    if (want.vault !== undefined) {
      if (want.vault === null) expect(data).toHaveProperty('vault', null)
      else {
        expect(data).toHaveProperty('vault.state', want.vault.state)
        expect(data).toHaveProperty('vault.itemCount', want.vault.itemCount)
        if (want.vault.grants !== undefined)
          expect(data).toHaveProperty('vault.grants.length', want.vault.grants)
      }
    }
    for (const facet of ['audit', 'developerAudit'] as const) {
      const value = want[facet]
      if (typeof value === 'number') expect(data).toHaveProperty(`${facet}.length`, value)
      else if (value !== undefined) expect(data).toHaveProperty(facet, value)
    }
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
      reasons: ['Unavailable account details: Usage, Swaps, Confirmations.'],
      check: checkAccounts({ providers: ['meta'] }),
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
      check: checkAccounts({ providers: ['meta'] }),
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
      check: checkAccounts({ providers: [] }),
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
      check: checkAccounts({ providers: [] }),
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
      check: checkAccounts({ providers: [] }),
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
      check: checkSecurity({ vault: null, audit: 0, developerAudit: 0 }),
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
      check: checkSecurity({ vault: null, audit: 0, developerAudit: [unlockRow] }),
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
      check: checkSecurity({
        vault: { state: 'unlocked', itemCount: 0, grants: 0 },
        audit: 0,
        developerAudit: [enableRow],
      }),
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
      check: checkSecurity({ vault: null, audit: 0, developerAudit: [] }),
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
      check: checkSecurity({ vault: null, audit: 0, developerAudit: [] }),
    },
  },
]

describe('accounts and security source reasons', () => {
  it.each(cases)('$name', ({ run, want }) => assertReasonResult(temps, 'm113-reasons-', run, want))
})

// RVCM1133B: no read discards rows it already accepted, or partial reasons
// it already collected, because one later record or one sub-source failed.
// Every entry below breaks exactly one sub-source while all the others are
// good, and asserts the others' rows and reasons survive. A hard-linked
// file is the portable unreadable file case (refused like a symlink);
// adapters fail by throwing or by returning malformed rows. Entries stay
// dense on purpose: each one names its setup, its failure sentence and its
// surviving rows as data, so the duplication gate sees no pasted table
// scaffolding.
type AccountsReaderInput = Parameters<typeof createAccountsReportReader>[0]

type FailureMode = 'unreadable' | 'unparseable' | 'badRecord' | 'wrongVersion'

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

const writeGoodAudits = async (dataDir: string): Promise<void> => {
  await Promise.all([
    writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [auditLine('unlock', 'palette')]),
    writeDeveloperAudit(dataDir, 'developer-audit.jsonl.previous', [auditLine('enable', 'page')]),
  ])
}

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
  ).read(reasonContext('accounts'))

const readSecurityFull = (dataDir: string, overrides?: Partial<SecurityReaderInput>) =>
  securitySource(
    createSecurityReportReader({
      dataDir,
      readVault: () => Promise.resolve(canaryVaultSnapshot()),
      ...overrides,
    }),
    scrub,
  ).read(reasonContext('security'))

const hardLinkBeside = async (file: string) => {
  await link(file, `${file}.shadow`)
}

const registrySetup =
  (text: string): ((dataDir: string) => Promise<void>) =>
  async (dataDir) => {
    await writeFile(path.join(dataDir, 'providers.json'), text)
  }

const auditSetup =
  (file: string, lines: readonly string[]): ((dataDir: string) => Promise<void>) =>
  async (dataDir) => {
    await writeGoodAudits(dataDir)
    await writeDeveloperAudit(dataDir, file, lines)
  }

const linkRegistry = async (dataDir: string): Promise<void> => {
  await writeGoodRegistry(dataDir)
  await hardLinkBeside(path.join(dataDir, 'providers.json'))
}

const linkAuditRotation =
  (file: string): ((dataDir: string) => Promise<void>) =>
  async (dataDir) => {
    await writeGoodAudits(dataDir)
    await hardLinkBeside(path.join(dataDir, 'developer', file))
  }

const firstUsageRow = goodUsageRows()[0]
if (firstUsageRow === undefined) throw new Error('Missing usage fixture')
const malformedUsageRow = malformed<AccountsFacts['usage'][number]>({ provider: 'meta' })
const futureUsageRow = malformed<AccountsFacts['usage'][number]>({ ...firstUsageRow, future: 'x' })
const goodEvents = goodEventsResult()
const [firstEvent] = goodEvents.events
const bogusEventRow = malformed<AccountsFacts['events'][number]>({ ...firstEvent, type: 'bogus' })
const [firstConfirmation] = goodEvents.confirmations
const futureConfirmationRow = malformed<AccountsFacts['confirmations'][number]>({
  ...firstConfirmation,
  future: 'x',
})
const canarySnapshot = canaryVaultSnapshot()
const [firstVaultAudit] = canarySnapshot.audit
const futureVaultAuditRow = {
  ...(typeof firstVaultAudit === 'object' && firstVaultAudit),
  v: 2,
}

interface AccountsResilienceEntry {
  readonly kind: 'accounts'
  readonly name: string
  readonly subSource: 'registry' | 'usage' | 'events'
  readonly mode: FailureMode
  readonly setup: (dataDir: string) => Promise<void>
  readonly overrides?: Partial<Pick<AccountsReaderInput, 'readUsage' | 'readEvents'>>
  readonly reasons: readonly string[]
  readonly providers?: readonly string[]
  readonly usage?: number
  readonly events?: number
  readonly confirmations?: number
}

interface SecurityResilienceEntry {
  readonly kind: 'security'
  readonly name: string
  readonly subSource: 'vault' | 'vaultAudit' | 'developerAudit' | 'developerAuditPrevious'
  readonly mode: FailureMode
  readonly setup: (dataDir: string) => Promise<void>
  readonly readVault?: SecurityReaderInput['readVault']
  readonly reasons: readonly string[]
  readonly vault?: null | {
    readonly state: string
    readonly itemCount: number
    readonly grants?: number
  }
  readonly audit?: number | readonly unknown[]
  readonly developerAudit?: number | readonly unknown[]
}

type ResilienceEntry = AccountsResilienceEntry | SecurityResilienceEntry

const resilienceEntries: readonly ResilienceEntry[] = [
  {
    kind: 'accounts',
    name: 'resilience/registry unreadable keeps the adapter rows with the refused reason',
    subSource: 'registry',
    mode: 'unreadable',
    setup: linkRegistry,
    reasons: [EN.reportSourceReasons.refused],
    providers: [],
    usage: 1,
    events: 1,
    confirmations: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/registry unparseable keeps the adapter rows with the invalid reason',
    subSource: 'registry',
    mode: 'unparseable',
    setup: registrySetup('{nope'),
    reasons: [EN.reportSourceReasons.invalid],
    providers: [],
    usage: 1,
    events: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/registry bad record keeps the good provider and the adapters',
    subSource: 'registry',
    mode: 'badRecord',
    setup: registrySetup(
      registryWith({ meta: goodMetaEntry(), broken: { id: 'broken', auth: 'oauth' } }),
    ),
    reasons: [EN.reportSourceReasons.invalid],
    providers: ['meta'],
    usage: 1,
    confirmations: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/registry wrong version keeps the adapter rows with the invalid reason',
    subSource: 'registry',
    mode: 'wrongVersion',
    setup: registrySetup(JSON.stringify({ v: 1 })),
    reasons: [EN.reportSourceReasons.invalid],
    providers: [],
    usage: 1,
    events: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/usage unreadable keeps the registry and events with the failed reason',
    subSource: 'usage',
    mode: 'unreadable',
    setup: writeGoodRegistry,
    overrides: { readUsage: () => Promise.reject(new LocalSourceError('failed')) },
    reasons: [EN.reportSourceReasons.failed],
    providers: ['meta'],
    usage: 0,
    events: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/usage unparseable keeps the registry and events with the invalid reason',
    subSource: 'usage',
    mode: 'unparseable',
    setup: writeGoodRegistry,
    overrides: {
      readUsage: () => Promise.resolve(malformed<AccountsFacts['usage']>('{nope}')),
    },
    reasons: [EN.reportSourceReasons.invalid],
    providers: ['meta'],
    usage: 0,
    confirmations: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/usage bad record keeps the good row with the invalid reason',
    subSource: 'usage',
    mode: 'badRecord',
    setup: writeGoodRegistry,
    overrides: {
      readUsage: () => Promise.resolve([...goodUsageRows(), malformedUsageRow]),
    },
    reasons: [EN.reportSourceReasons.invalid],
    providers: ['meta'],
    usage: 1,
    events: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/usage wrong version skips the newer row with the invalid reason',
    subSource: 'usage',
    mode: 'wrongVersion',
    setup: writeGoodRegistry,
    overrides: {
      readUsage: () => Promise.resolve([firstUsageRow, futureUsageRow]),
    },
    reasons: [EN.reportSourceReasons.invalid],
    usage: 1,
    events: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/events unreadable keeps the registry and usage with the failed reason',
    subSource: 'events',
    mode: 'unreadable',
    setup: writeGoodRegistry,
    overrides: { readEvents: () => Promise.reject(new LocalSourceError('failed')) },
    reasons: [EN.reportSourceReasons.failed],
    providers: ['meta'],
    usage: 1,
    events: 0,
    confirmations: 0,
  },
  {
    kind: 'accounts',
    name: 'resilience/events unparseable keeps the confirmations with the invalid reason',
    subSource: 'events',
    mode: 'unparseable',
    setup: writeGoodRegistry,
    overrides: {
      readEvents: () =>
        Promise.resolve(
          malformed<Pick<AccountsFacts, 'events' | 'confirmations'>>({
            events: 'x',
            confirmations: goodEvents.confirmations,
          }),
        ),
    },
    reasons: [EN.reportSourceReasons.invalid],
    usage: 1,
    events: 0,
    confirmations: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/events bad record keeps the good event and confirmations',
    subSource: 'events',
    mode: 'badRecord',
    setup: writeGoodRegistry,
    overrides: {
      readEvents: () =>
        Promise.resolve(
          malformed<Pick<AccountsFacts, 'events' | 'confirmations'>>({
            events: [...goodEvents.events, bogusEventRow],
            confirmations: goodEvents.confirmations,
          }),
        ),
    },
    reasons: [EN.reportSourceReasons.invalid],
    events: 1,
    confirmations: 1,
  },
  {
    kind: 'accounts',
    name: 'resilience/events wrong version skips the newer confirmation',
    subSource: 'events',
    mode: 'wrongVersion',
    setup: writeGoodRegistry,
    overrides: {
      readEvents: () =>
        Promise.resolve(
          malformed<Pick<AccountsFacts, 'events' | 'confirmations'>>({
            events: goodEvents.events,
            confirmations: [futureConfirmationRow],
          }),
        ),
    },
    reasons: [EN.reportSourceReasons.invalid],
    events: 1,
    confirmations: 0,
  },
  {
    kind: 'security',
    name: 'resilience/vault unreadable keeps the developer audit with the failed reason',
    subSource: 'vault',
    mode: 'unreadable',
    setup: writeGoodAudits,
    readVault: () => Promise.reject(new LocalSourceError('failed')),
    reasons: [EN.reportSourceReasons.failed],
    vault: null,
    audit: 0,
    developerAudit: [enableRow, unlockRow],
  },
  {
    kind: 'security',
    name: 'resilience/vault unparseable keeps the developer audit with the invalid reason',
    subSource: 'vault',
    mode: 'unparseable',
    setup: writeGoodAudits,
    readVault: () =>
      Promise.resolve(
        malformed<SecurityVaultSnapshot>({
          state: 'unlocked',
          tier: 'osStore',
          items: 'x',
          grants: [],
          audit: [],
        }),
      ),
    reasons: [EN.reportSourceReasons.invalid],
    vault: { state: 'unlocked', itemCount: 0 },
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/vault bad record counts the good items with the invalid reason',
    subSource: 'vault',
    mode: 'badRecord',
    setup: writeGoodAudits,
    readVault: () =>
      Promise.resolve({ ...canarySnapshot, items: [...canarySnapshot.items, { kind: 'x' }] }),
    reasons: [EN.reportSourceReasons.invalid],
    vault: { state: 'unlocked', itemCount: 1, grants: 1 },
    audit: 1,
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/vault wrong version keeps the developer audit with the invalid reason',
    subSource: 'vault',
    mode: 'wrongVersion',
    setup: writeGoodAudits,
    readVault: () =>
      Promise.resolve(malformed<SecurityVaultSnapshot>({ ...canarySnapshot, state: 'bogus' })),
    reasons: [EN.reportSourceReasons.invalid],
    vault: null,
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/vaultAudit bad record keeps the good row and the vault counts',
    subSource: 'vaultAudit',
    mode: 'badRecord',
    setup: writeGoodAudits,
    readVault: () =>
      Promise.resolve({ ...canarySnapshot, audit: [...canarySnapshot.audit, { kind: 'x' }] }),
    reasons: [EN.reportSourceReasons.invalid],
    vault: { state: 'unlocked', itemCount: 1 },
    audit: [{ kind: 'environment', decision: 'allow', authority: 'grant', outcome: 'succeeded' }],
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/vaultAudit wrong version keeps the vault counts with the invalid reason',
    subSource: 'vaultAudit',
    mode: 'wrongVersion',
    setup: writeGoodAudits,
    readVault: () => Promise.resolve({ ...canarySnapshot, audit: [futureVaultAuditRow] }),
    reasons: [EN.reportSourceReasons.invalid],
    vault: { state: 'unlocked', itemCount: 1 },
    audit: 0,
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/developerAudit unreadable keeps the vault and the previous rotation',
    subSource: 'developerAudit',
    mode: 'unreadable',
    setup: linkAuditRotation('developer-audit.jsonl'),
    reasons: [EN.reportSourceReasons.refused],
    vault: { state: 'unlocked', itemCount: 1 },
    developerAudit: [enableRow],
  },
  {
    kind: 'security',
    name: 'resilience/developerAudit unparseable keeps the vault and the previous rotation',
    subSource: 'developerAudit',
    mode: 'unparseable',
    setup: auditSetup('developer-audit.jsonl', ['{nope}\n']),
    reasons: [EN.reportSourceReasons.invalid],
    vault: { state: 'unlocked', itemCount: 1 },
    audit: 1,
    developerAudit: [enableRow],
  },
  {
    kind: 'security',
    name: 'resilience/developerAudit bad record keeps the good line beside it',
    subSource: 'developerAudit',
    mode: 'badRecord',
    setup: auditSetup('developer-audit.jsonl', [auditLine('unlock', 'palette'), 'not-json\n']),
    reasons: [EN.reportSourceReasons.invalid],
    developerAudit: [enableRow, unlockRow],
  },
  {
    kind: 'security',
    name: 'resilience/developerAudit wrong version skips the newer line',
    subSource: 'developerAudit',
    mode: 'wrongVersion',
    setup: auditSetup('developer-audit.jsonl', [
      `${JSON.stringify({ v: 2, time: 1, action: 'unlock', source: 'palette' })}\n`,
      auditLine('unlock', 'palette'),
    ]),
    reasons: [EN.reportSourceReasons.invalid],
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/developerAuditPrevious unreadable keeps the vault and the current rotation',
    subSource: 'developerAuditPrevious',
    mode: 'unreadable',
    setup: linkAuditRotation('developer-audit.jsonl.previous'),
    reasons: [EN.reportSourceReasons.refused],
    vault: { state: 'unlocked', itemCount: 1 },
    developerAudit: [unlockRow],
  },
  {
    kind: 'security',
    name: 'resilience/developerAuditPrevious unparseable keeps the current rotation',
    subSource: 'developerAuditPrevious',
    mode: 'unparseable',
    setup: auditSetup('developer-audit.jsonl.previous', ['{nope}\n']),
    reasons: [EN.reportSourceReasons.invalid],
    developerAudit: [unlockRow],
  },
  {
    kind: 'security',
    name: 'resilience/developerAuditPrevious bad record keeps every good line',
    subSource: 'developerAuditPrevious',
    mode: 'badRecord',
    setup: auditSetup('developer-audit.jsonl.previous', [auditLine('enable', 'page'), '{nope}\n']),
    reasons: [EN.reportSourceReasons.invalid],
    developerAudit: 2,
  },
  {
    kind: 'security',
    name: 'resilience/developerAuditPrevious wrong version skips the newer line',
    subSource: 'developerAuditPrevious',
    mode: 'wrongVersion',
    setup: auditSetup('developer-audit.jsonl.previous', [
      `${JSON.stringify({ v: 2, time: 2, action: 'enable', source: 'page' })}\n`,
    ]),
    reasons: [EN.reportSourceReasons.invalid],
    developerAudit: [unlockRow],
  },
]

/** Every way each sub-source can fail. A sub-source that gains a new way
 * to fail grows this map, which fails the coverage test until its case
 * exists. */
const REQUIRED_MODES: Record<string, readonly ResilienceEntry['mode'][]> = {
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
  it.each(resilienceEntries)('$name', async (entry) => {
    const dataDir = await temps.dir('m113-resilience-')
    await entry.setup(dataDir)
    if (entry.kind === 'accounts') {
      const result = await readAccountsFull(dataDir, entry.overrides)
      assertReasonRecord(result, { status: 'partial', reasons: entry.reasons })
      checkAccounts({
        ...(entry.providers !== undefined && { providers: entry.providers }),
        ...(entry.usage !== undefined && { usage: entry.usage }),
        ...(entry.events !== undefined && { events: entry.events }),
        ...(entry.confirmations !== undefined && { confirmations: entry.confirmations }),
      })(result.data)
    } else {
      const result = await readSecurityFull(dataDir, {
        ...(entry.readVault !== undefined && { readVault: entry.readVault }),
      })
      assertReasonRecord(result, { status: 'partial', reasons: entry.reasons })
      checkSecurity({
        ...(entry.vault !== undefined && { vault: entry.vault }),
        ...(entry.audit !== undefined && { audit: entry.audit }),
        ...(entry.developerAudit !== undefined && { developerAudit: entry.developerAudit }),
      })(result.data)
    }
  })

  it('covers every sub-source in every way it can fail', () => {
    const inventories = [...ACCOUNTS_REPORT_SUB_SOURCES, ...SECURITY_REPORT_SUB_SOURCES]
    expect(new Set(inventories).size).toBe(inventories.length)
    for (const source of inventories) {
      const modes = resilienceEntries
        .filter((candidate) => candidate.subSource === source)
        .map((candidate) => candidate.mode)
        .toSorted(byCodeUnit)
      expect(modes).toEqual([...(REQUIRED_MODES[source] ?? [])].toSorted(byCodeUnit))
    }
    const outside = resilienceEntries.filter(
      (candidate) =>
        inventories.every((source) => source !== candidate.subSource) ||
        !(REQUIRED_MODES[candidate.subSource] ?? []).includes(candidate.mode),
    )
    expect(outside).toEqual([])
  })
})
