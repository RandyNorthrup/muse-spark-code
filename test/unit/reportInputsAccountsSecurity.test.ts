// M113 C-M113-3: bound accounts and security inputs over real directories.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import {
  createAccountsReportReader,
  createSecurityReportReader,
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
const dir = (prefix: string) => temps.dir(prefix)

const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: {
    kind: 'accounts' as const,
    asOf: REPORT_FIXTURE_AS_OF,
    scope: '',
    full: false,
    network: false,
    failOn: [],
  },
  signal: new AbortController().signal,
})
const securityContext = () => ({
  ...context(),
  options: { ...context().options, kind: 'security' as const },
})

describe('accounts report reader', () => {
  it('reads the registry with projected thresholds and names missing facets', async () => {
    const dataDir = await dir('m113-accounts-')
    await writeFile(
      path.join(dataDir, 'providers.json'),
      JSON.stringify({
        v: 1,
        providers: {
          meta: {
            id: 'meta',
            policyProvider: 'meta',
            product: 'muse',
            auth: 'oauth',
            origin: 'fixture',
            accounts: [
              {
                id: 'primary',
                label: 'Primary',
                order: 0,
                thresholds: {
                  spendUsd: { day: '5' },
                  requests: { week: 100 },
                  planWindowPercent: { plan: 80 },
                  rateLimitHeadroomPercent: { tokens: 10 },
                },
              },
            ],
          },
        },
      }),
    )
    const reader = createAccountsReportReader({ dataDir })
    const result = await reader.read(context())
    expect(result!.facts.providers).toEqual([
      {
        provider: 'meta',
        product: 'muse',
        auth: 'oauth',
        accounts: [
          {
            id: 'primary',
            label: 'Primary',
            order: 0,
            limitGroup: null,
            thresholds: {
              spendUsd: [{ period: 'day', value: '5' }],
              counts: [{ metric: 'requests', period: 'week', value: 100 }],
              percents: [
                { name: 'plan', value: 80 },
                { name: 'rateLimitHeadroom/tokens', value: 10 },
              ],
            },
          },
        ],
      },
    ])
    expect(result!.facts.usage).toEqual([])
    expect(result!.partial).toBe('Unavailable account details: usage, swaps, confirmations.')
  })

  it('binds injected use and event adapters without a partial', async () => {
    const dataDir = await dir('m113-accounts-bound-')
    await writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ v: 1, providers: {} }))
    const reader = createAccountsReportReader({
      dataDir,
      readUsage: () => Promise.resolve([]),
      readEvents: () => Promise.resolve({ events: [], confirmations: [] }),
    })
    const result = await reader.read(context())
    expect(result!.partial).toBeUndefined()
    expect(result!.facts.providers).toEqual([])
  })

  it('reads a missing registry as null and a corrupt one as partial with the invalid reason', async () => {
    const missing = createAccountsReportReader({ dataDir: await dir('m113-accounts-empty-') })
    await expect(missing.read(context())).resolves.toBeNull()
    // RVCM1133B P2: a corrupt registry is one failed sub-source, never a
    // failed read: the facts still return with the invalid reason.
    for (const [prefix, text] of [
      ['m113-accounts-corrupt-', '{nope'],
      ['m113-accounts-envelope-', JSON.stringify({ v: 1 })],
    ] as const) {
      const registryDir = await dir(prefix)
      await writeFile(path.join(registryDir, 'providers.json'), text)
      const read = await createAccountsReportReader({ dataDir: registryDir }).read(context())
      expect(read!.facts.providers).toEqual([])
      expect(read!.partial).toContain(EN.reportSourceReasons.invalid)
    }
  })
})

describe('security report reader', () => {
  it('reads the developer audit across both rotations with a locked vault', async () => {
    const dataDir = await dir('m113-security-')
    await writeDeveloperAudit(dataDir, 'developer-audit.jsonl', [
      `${JSON.stringify({ v: 1, time: 1, action: 'unlock', source: 'palette' })}\n`,
    ])
    await writeDeveloperAudit(dataDir, 'developer-audit.jsonl.previous', [
      `${JSON.stringify({ v: 1, time: 2, action: 'enable', source: 'page' })}\n`,
    ])
    const reader = createSecurityReportReader({ dataDir })
    const result = await reader.read(securityContext())
    expect(result!.facts.vault).toBeNull()
    expect(result!.facts.audit).toEqual([])
    expect(result!.facts.developerAudit).toEqual([
      { action: 'unlock', source: 'palette' },
      { action: 'enable', source: 'page' },
    ])
    expect(result!.partial).toBe('The vault is locked or unavailable.')
  })

  it('projects an unlock-capable vault view to counts and kinds only', async () => {
    const dataDir = await dir('m113-security-vault-')
    const reader = createSecurityReportReader({
      dataDir,
      readVault: () => Promise.resolve(canaryVaultSnapshot()),
    })
    const result = await reader.read(securityContext())
    expect(result!.facts.vault).toEqual({
      state: 'unlocked',
      tier: 'osStore',
      itemCount: 1,
      itemsByKind: [{ kind: 'password', count: 1 }],
      grants: [{ scope: 'named/named', count: 1 }],
    })
    expect(result!.facts.audit).toEqual([
      { kind: 'environment', decision: 'allow', authority: 'grant', outcome: 'succeeded' },
    ])
    expect(result!.partial).toBe('The developer audit is unavailable.')
    expect(JSON.stringify(result)).not.toContain('canary')
  })

  it('reads nothing as partial facts naming both reasons and a corrupt audit as partial', async () => {
    const empty = createSecurityReportReader({ dataDir: await dir('m113-security-empty-') })
    const read = await empty.read(securityContext())
    expect(read).not.toBeNull()
    expect(read!.facts).toEqual({ vault: null, audit: [], developerAudit: [] })
    expect(read!.partial).toContain(EN.reportDetailReasons.securityVaultUnavailable)
    expect(read!.partial).toContain(EN.reportDetailReasons.securityDeveloperAuditUnavailable)
    // RVCM1133B P2: a corrupt audit rotation is one failed sub-source: the
    // facts still return with the invalid reason beside the vault reason.
    const corruptDir = await dir('m113-security-corrupt-')
    await writeDeveloperAudit(corruptDir, 'developer-audit.jsonl', ['{nope}\n'])
    const corrupt = await createSecurityReportReader({ dataDir: corruptDir }).read(
      securityContext(),
    )
    expect(corrupt!.facts).toEqual({ vault: null, audit: [], developerAudit: [] })
    expect(corrupt!.partial).toContain(EN.reportDetailReasons.securityVaultUnavailable)
    expect(corrupt!.partial).toContain(EN.reportSourceReasons.invalid)
    expect(new LocalSourceError('invalid').isLocalSourceError).toBe(true)
  })
})
