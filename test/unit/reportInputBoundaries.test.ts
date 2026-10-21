// CM1133R4: fault inventory comes from the code, not the review's cited lines.
import * as fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it } from 'vitest'
import { accountsSource } from '../../src/core/reporting/sources/accounts'
import { securitySource } from '../../src/core/reporting/sources/security'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import {
  REPORT_MAX_ROWS,
  EXEC_UNTRUSTED_FILE_MAX_BYTES,
  DEVELOPER_AUDIT_MAX_BYTES,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  createAccountsReportReader,
  createSecurityReportReader,
} from '../../src/runtime/reporting/reportInputs'
import { tempDirTracker, writeDeveloperAudit } from './helpers/reporting/tempDir'
import { canaryVaultSnapshot } from './helpers/reporting/canaryVault'
import { malformed, reasonContext, assertReasonRecord } from './helpers/reporting/reasonCases'

const temps = tempDirTracker()
setUiText(EN, 'en')
afterEach(async () => {
  await temps.cleanup()
})
const scrub = (value: string) => value
const fail = () => Promise.reject(new LocalSourceError('refused'))
const vaultRecordKey = (facet: string): 'items' | 'grants' | 'audit' => {
  if (facet === 'items') return 'items'
  return facet === 'grants' ? 'grants' : 'audit'
}
const lostVaultFacets = (facet: string): string[] => {
  if (['state', 'tier', 'items'].includes(facet)) return ['vault']
  return facet === 'audit' ? ['audit'] : []
}
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
const event = {
  type: 'swap',
  provider: 'meta',
  account: 'primary',
  time: '2026-10-01T00:00:00.000Z',
  trigger: 'userCap/spendUsd/day',
  previousAccount: null,
} as const
const confirmation = {
  provider: 'meta',
  product: 'muse',
  choice: 'confirm',
  answeredAt: '2026-10-01T00:00:00.000Z',
} as const
const account = () => ({
  id: 'primary',
  label: 'Primary',
  order: 0,
  thresholds: { spendUsd: { day: '5' }, requests: { week: 100 } },
})
const provider = () => ({ id: 'meta', product: 'muse', auth: 'oauth', accounts: [account()] })
const audit = (action = 'unlock') =>
  JSON.stringify({ v: 1, time: 1, action, source: 'page' }) + '\n'
const registry = (entry: unknown = provider()) =>
  JSON.stringify({ v: 1, providers: { meta: entry } })
const setup = async () => {
  const dir = await temps.dir('m113-boundaries-')
  await fs.writeFile(path.join(dir, 'providers.json'), registry())
  await writeDeveloperAudit(dir, 'developer-audit.jsonl', [audit(), '{nope}\n'])
  await writeDeveloperAudit(dir, 'developer-audit.jsonl.previous', [audit('enable')])
  return dir
}
const accounts = (
  dir: string,
  options: Partial<Parameters<typeof createAccountsReportReader>[0]> = {},
) =>
  accountsSource(
    createAccountsReportReader({
      dataDir: dir,
      readUsage: () => Promise.resolve([usage]),
      readEvents: () => Promise.resolve({ events: [event], confirmations: [confirmation] }),
      ...options,
    }),
    scrub,
  ).read(reasonContext('accounts'))
const security = (dir: string, ...snapshots: readonly unknown[]) =>
  securitySource(
    createSecurityReportReader({
      dataDir: dir,
      readVault: () =>
        Promise.resolve(
          malformed(
            snapshots.length === 0 ? canaryVaultSnapshot() : snapshots[0],
            canaryVaultSnapshot(),
          ),
        ),
    }),
    scrub,
  ).read(reasonContext('security'))
const partial = (
  result: { record: { status: string; reason: unknown }; data: unknown },
  reasons = [EN.reportSourceReasons.invalid],
) => {
  assertReasonRecord(result, { status: 'partial', reasons })
  expect(result.data).not.toBeNull()
}
const accountSurvivors = (result: Awaited<ReturnType<typeof accounts>>, lost: string[] = []) => {
  for (const [facet, row] of [
    ['usage', usage],
    ['events', event],
    ['confirmations', confirmation],
  ] as const)
    if (!lost.includes(facet)) expect(result.data).toHaveProperty(facet, [row])
  if (!lost.includes('providers'))
    expect(result.data).toHaveProperty('providers.0.accounts.0.id', 'primary')
}
const securitySurvivors = (result: Awaited<ReturnType<typeof security>>, lost: string[] = []) => {
  if (!lost.includes('vault')) expect(result.data).toHaveProperty('vault.itemCount', 1)
  if (!lost.includes('audit'))
    expect(result.data).toHaveProperty('audit', [
      { kind: 'environment', decision: 'allow', authority: 'grant', outcome: 'succeeded' },
    ])
  const rows = ['enable', 'unlock']
    .filter((action) => !lost.includes(action))
    .map((action) => ({ action, source: 'page' }))
  expect(result.data).toHaveProperty('developerAudit', rows)
}

// Each inventory entry names its executable scenario family below. Awaited calls,
// validators, decoding and row admission are mechanically extracted for every
// local accounts/security helper and both assembled-source validators. A new
// boundary fails this inventory unless its injection cases are added.
const coverage: Record<string, string> = {
  'readDataFile/open': 'file operations',
  'readDataFile/lstatIdentity': 'file operations',
  'readDataFile/handleIdentity': 'file operations',
  'readDataFile/sameFile': 'file identity',
  'readDataFile/handle.read': 'file operations and split body',
  'readDataFile/handle.close': 'file operations',
  "readDataFile/new TextDecoder('utf-8', { fatal: true }).decode": 'file decoding',
  'collectValidRows/readReportRows': 'adapter/vault record families',
  'collectValidRows/into.push': 'adapter/vault record families',
  'readSnapshotFacet/readReportField': 'throwing snapshot facet',
  'projectThresholds/accountThresholdsSchema.safeParse': 'threshold records',
  'projectThresholds/recordFieldsSchema.safeParse': 'threshold records',
  'projectThresholds/accountIdSchema.safeParse': 'threshold records',
  'projectThresholds/collectValidRows': 'threshold records',
  'createAccountsReportReader/accountSchema.safeParse': 'future account fields',
  'createAccountsReportReader/registryAccountMetadataSchema.safeParse': 'registry records',
  'createSecurityReportReader/z.object({}).safeParse': 'vault results',
  'createSecurityReportReader/readSnapshotFacet': 'throwing snapshot facet',
  'accountsSource/reader.read': 'final assembled validation',
  'securitySource/reader.read': 'final assembled validation',
  'createAccountsReportReader/readDataFile': 'file operations',
  'createAccountsReportReader/JSON.parse': 'registry decoding',
  'createAccountsReportReader/z.object({ providers: z.record(z.string(), z.unknown()) }).safeParse':
    'registry envelope',
  'createAccountsReportReader/registryEntrySchema.safeParse': 'registry records',
  'createAccountsReportReader/projectThresholds': 'threshold records',
  'createAccountsReportReader/input.readUsage': 'adapter results',
  'createAccountsReportReader/input.readEvents': 'adapter results',
  'createAccountsReportReader/readSnapshotFacet': 'throwing account facet',
  'createAccountsReportReader/collectValidRows': 'adapter/vault record families',
  'createSecurityReportReader/input.readVault': 'vault results',
  'createSecurityReportReader/z.strictObject({ state: vaultStatusSchema.shape.state, tier: vaultStatusSchema.shape.tier, }).safeParse':
    'vault scalars',
  'createSecurityReportReader/collectValidRows': 'adapter/vault record families',
  'createSecurityReportReader/readDataFile': 'file operations',
  'createSecurityReportReader/JSON.parse': 'audit decoding',
  'createSecurityReportReader/developerAuditSchema.safeParse': 'audit records',
  'accountsSource/factsSchema.parse': 'final assembled validation',
  'securitySource/factsSchema.parse': 'final assembled validation',
}

it('inventories every read, validation, decode and admission boundary from source', async () => {
  const found = new Map<string, number>()
  const roots = new Set([
    'createAccountsReportReader',
    'createSecurityReportReader',
    'accountsSource',
    'securitySource',
  ])
  for (const file of [
    'src/runtime/reporting/reportInputs.ts',
    'src/core/reporting/sources/accounts.ts',
    'src/core/reporting/sources/security.ts',
  ]) {
    const source = ts.createSourceFile(
      file,
      await fs.readFile(path.resolve(file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const functions = new Map<
      string,
      ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
    >()
    source.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined)
        functions.set(node.name.text, node)
      if (ts.isVariableStatement(node))
        for (const entry of node.declarationList.declarations)
          if (
            ts.isIdentifier(entry.name) &&
            entry.initializer !== undefined &&
            (ts.isArrowFunction(entry.initializer) || ts.isFunctionExpression(entry.initializer))
          )
            functions.set(entry.name.text, entry.initializer)
    })
    const scopes = new Set<string>()
    const follow = (name: string) => {
      const body = functions.get(name)
      if (body === undefined || scopes.has(name)) return
      scopes.add(name)
      const calls = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
          follow(node.expression.text)
        node.forEachChild(calls)
      }
      calls(body)
    }
    for (const root of roots) follow(root)
    const visit = (node: ts.Node, scope = '', isAwaited = false) => {
      if (ts.isFunctionDeclaration(node)) scope = node.name?.text ?? ''
      if (ts.isCallExpression(node) && scopes.has(scope)) {
        const expression = node.expression
          .getText(source)
          .replaceAll(/\s+/gu, ' ')
          .replaceAll(/\s+\./gu, '.')
        if (
          isAwaited ||
          expression === 'sameFile' ||
          /\.(?:safeParse|parse|decode)$/u.test(expression) ||
          (expression.endsWith('.push') &&
            !['partials.push', 'missing.push'].includes(expression)) ||
          [
            'collectValidRows',
            'projectThresholds',
            'admitRow',
            'readSnapshotFacet',
            'isReportRowAdmitted',
            'readReportRows',
            'readReportField',
          ].includes(expression)
        ) {
          const key = `${scope}/${expression}`
          found.set(key, (found.get(key) ?? 0) + 1)
        }
      }
      node.forEachChild((child) => {
        visit(child, scope, ts.isAwaitExpression(node))
      })
    }
    for (const scope of scopes) {
      const body = functions.get(scope)
      if (body !== undefined) visit(body, scope)
    }
  }
  const repeats: Record<string, number> = {
    'readDataFile/lstatIdentity': 2,
    'readDataFile/sameFile': 2,
    'projectThresholds/collectValidRows': 4,
    'createAccountsReportReader/collectValidRows': 5,
    'createAccountsReportReader/readSnapshotFacet': 2,
    'createSecurityReportReader/collectValidRows': 5,
    'createSecurityReportReader/readSnapshotFacet': 5,
  }
  expect(Object.fromEntries(found)).toEqual(
    Object.fromEntries(Object.keys(coverage).map((key) => [key, repeats[key] ?? 1])),
  )
  const cases = await fs.readFile(path.resolve('test/unit/reportInputBoundaries.test.ts'), 'utf8')
  const declarations = ts.createSourceFile('cases.ts', cases, ts.ScriptTarget.Latest, true)
  const titles: string[] = []
  const findTitles = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.getText(declarations) === 'it' ||
        node.expression.getText(declarations).startsWith('it.each('))
    ) {
      const title = node.arguments[0]
      if (title !== undefined && ts.isStringLiteral(title)) titles.push(title.text)
    }
    node.forEachChild(findTitles)
  }
  findTitles(declarations)
  const titlesByFamily: Record<string, string> = {
    'file operations and split body': 'split body',
    'registry envelope': 'registry decoding/envelope',
    'vault scalars': 'vault results/scalars',
    'vault results': 'vault results/scalars',
    'audit records': 'audit decoding/records',
    'audit decoding': 'audit decoding/records',
  }
  // MSM113FIX: withdrawn families have scenario notes instead of cases (see
  // the NOTES above), so the inventory requires titles only for the rest.
  // Their source calls stay catalogued in `coverage` by design.
  const withdrawnFamilies = new Set([
    'file operations',
    'file identity',
    'file operations and split body',
  ])
  for (const family of Object.values(coverage))
    if (!withdrawnFamilies.has(family))
      expect(titles.join('\n')).toContain(titlesByFamily[family] ?? family)
  // These readers consume local files/ports only. Network/page/request limits
  // belong to reportNetworkBinding; introducing one here changes the inventory.
})

const malformedResults = [
  null,
  undefined,
  'bogus',
  [],
  { events: null, confirmations: [confirmation] },
  { events: [event], confirmations: null },
] as const
it.each(malformedResults)('adapter results retain other facets: %j', async (value) => {
  const dir = await setup()
  const result = await accounts(dir, { readEvents: async () => await malformed(value) })
  partial(result, [
    value == null
      ? 'Unavailable account details: Swaps, Confirmations.'
      : EN.reportSourceReasons.invalid,
  ])
  accountSurvivors(result, ['events', 'confirmations'])
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return
  }

  if ('events' in value && Array.isArray(value.events))
    expect(result.data).toHaveProperty('events', [event])
  if ('confirmations' in value && Array.isArray(value.confirmations))
    expect(result.data).toHaveProperty('confirmations', [confirmation])
})
it.each([null, undefined])('usage absence is named: %j', async (value) => {
  const result = await accounts(await setup(), { readUsage: async () => await malformed(value) })
  partial(result, ['Unavailable account details: Usage.'])
  accountSurvivors(result, ['usage'])
})
it.each(['events', 'confirmations'] as const)(
  'throwing account facet %s retains its sibling and earlier reasons',
  async (facet) => {
    const response = { events: [event], confirmations: [confirmation] }
    Object.defineProperty(response, facet, {
      get: () => {
        throw new Error('bogus')
      },
    })
    const result = await accounts(await setup(), {
      readUsage: () => Promise.resolve(null),
      readEvents: () => Promise.resolve(response),
    })
    partial(result, [EN.reportSourceReasons.failed, 'Unavailable account details: Usage.'])
    accountSurvivors(result, ['usage', facet])
  },
)
it.each(['usage', 'events', 'vault'] as const)(
  'throwing %s retains rows and earlier reasons',
  async (facet) => {
    const dir = await setup()

    if (facet === 'vault') {
      const result = await securitySource(
        createSecurityReportReader({ dataDir: dir, readVault: fail }),
        scrub,
      ).read(reasonContext('security'))
      partial(result, [
        EN.reportSourceReasons.refused,
        EN.reportSourceReasons.invalid,
        EN.reportDetailReasons.securityVaultUnavailable,
      ])
      securitySurvivors(result, ['vault', 'audit'])
    } else {
      await fs.writeFile(
        path.join(dir, 'providers.json'),
        JSON.stringify({ providers: { meta: provider(), bad: {} } }),
      )
      const result = await accounts(
        dir,
        facet === 'usage' ? { readUsage: fail } : { readEvents: fail },
      )
      partial(result, [EN.reportSourceReasons.invalid, EN.reportSourceReasons.refused])
      accountSurvivors(result, facet === 'usage' ? ['usage'] : ['events', 'confirmations'])
    }
  },
)

it.each([
  null,
  undefined,
  'bogus',
  [],
  { ...canaryVaultSnapshot(), state: 'bogus' },
  { ...canaryVaultSnapshot(), tier: 'bogus' },
])('vault results/scalars retain independent audits: %j', async (value) => {
  const result = await security(await setup(), value)
  partial(result, [
    EN.reportSourceReasons.invalid,
    ...(value == null ? [EN.reportDetailReasons.securityVaultUnavailable] : []),
  ])
  securitySurvivors(
    result,
    typeof value === 'object' && value !== null && 'audit' in value
      ? ['vault']
      : ['vault', 'audit'],
  )
})

const thresholdFaults = [
  { spendUsd: { week: '-1' } },
  { requests: { day: -1 } },
  { outputTokens: { day: -1 } },
  { inputTokens: { day: -1 } },
  { planWindowPercent: { bad: -1, good: 80 } },
  { rateLimitHeadroomPercent: { requests: -1, tokens: 80 } },
]
it.each(thresholdFaults)(
  'threshold records retain metadata and independent limits: %j',
  async (fault) => {
    const dir = await setup()
    const good = account()
    const thresholds = {
      ...good.thresholds,
      ...fault,
      spendUsd: { ...good.thresholds.spendUsd, ...('spendUsd' in fault && fault.spendUsd) },
      requests: { ...good.thresholds.requests, ...('requests' in fault && fault.requests) },
    }
    await fs.writeFile(
      path.join(dir, 'providers.json'),
      registry({
        ...provider(),
        accounts: [
          { ...good, thresholds },
          { ...good, id: 'broken', thresholds: { spendUsd: { day: '-1' } } },
        ],
      }),
    )
    const result = await accounts(dir)
    partial(result)
    accountSurvivors(result)
    expect(result.data).toHaveProperty('providers.0.accounts.0.thresholds.spendUsd', [
      { period: 'day', value: '5' },
    ])
    expect(result.data).toHaveProperty('providers.0.accounts.0.thresholds.counts', [
      { metric: 'requests', period: 'week', value: 100 },
    ])
    expect(result.data).toHaveProperty('providers.0.accounts.1.id', 'broken')
  },
)
it.each([null, { ...account(), label: '' }, { ...account(), order: -1 }])(
  'registry records retain sibling accounts: %j',
  async (bad) => {
    const dir = await setup()
    await fs.writeFile(
      path.join(dir, 'providers.json'),
      registry({ ...provider(), accounts: [account(), bad] }),
    )
    const result = await accounts(dir)
    partial(result)
    accountSurvivors(result)
    expect(result.data).toHaveProperty('providers.0.accounts.length', 1)
  },
)
it.each(['{nope}', '{}', '{"providers":null}', JSON.stringify({ providers: { bad: {} } })])(
  'registry decoding/envelope retains adapters: %s',
  async (text) => {
    const dir = await setup()
    await fs.writeFile(path.join(dir, 'providers.json'), text)
    const result = await accounts(dir)
    partial(result)
    accountSurvivors(result, ['providers'])
  },
)
it('missing registry still reads the available adapters', async () => {
  const dir = await setup()
  await fs.unlink(path.join(dir, 'providers.json'))
  const result = await accounts(dir)
  partial(result, [EN.reportSourceReasons.missing])
  accountSurvivors(result, ['providers'])
})

it.each(['usage', 'events', 'confirmations', 'items', 'grants', 'audit'] as const)(
  'adapter/vault record families retain every valid sibling: %s',
  async (facet) => {
    const dir = await setup()
    if (['usage', 'events', 'confirmations'].includes(facet)) {
      const rows = {
        usage: [usage, null, { future: 2 }],
        events: [event, null, { future: 2 }],
        confirmations: [confirmation, null, { future: 2 }],
      }
      const result = await accounts(dir, {
        readUsage: async () => await malformed(rows.usage),
        readEvents: async () => await malformed(rows),
      })
      partial(result)
      accountSurvivors(result)
    } else {
      const view = canaryVaultSnapshot()
      const key = vaultRecordKey(facet)
      const result = await security(dir, { ...view, [facet]: [...view[key], null, { v: 2 }] })
      partial(result)
      securitySurvivors(result)
    }
  },
)
it.each(['items', 'grants', 'audit'] as const)(
  'malformed vault array retains other evidence: %s',
  async (facet) => {
    const result = await security(await setup(), { ...canaryVaultSnapshot(), [facet]: null })
    partial(result)
    securitySurvivors(result, lostVaultFacets(facet))
  },
)
it.each([
  '{nope}\n',
  JSON.stringify({ v: 2, time: 1, action: 'unlock', source: 'page' }) + '\n',
  '{}\n',
])('audit decoding/records retain both rotations: %s', async (bad) => {
  const dir = await setup()
  await writeDeveloperAudit(dir, 'developer-audit.jsonl', [audit(), bad])
  const result = await security(dir)
  partial(result)
  securitySurvivors(result)
})

const fileFailure = async (dir: string, file: string, reason: string) => {
  if (file === 'providers.json') {
    const result = await accounts(dir)
    partial(result, [reason])
    accountSurvivors(result, ['providers'])
  } else {
    const result = await security(dir)
    partial(result, [
      reason,
      ...(file.endsWith('.previous') ? [EN.reportSourceReasons.invalid] : []),
    ])
    securitySurvivors(result, [file.endsWith('.previous') ? 'enable' : 'unlock'])
  }
}

const files = [
  'providers.json',
  'developer/developer-audit.jsonl',
  'developer/developer-audit.jsonl.previous',
] as const
// NOTE (MSM113FIX): the EIO fault-injection table is gone. It failed every
// file operation on demand through spies on node:fs and the identity
// module: interception, with no deterministic real trigger (a real disk
// failure cannot be scheduled into a microsecond read window). The
// failure-word mapping it proved is withdrawn in
// docs/certification/msm113.md; static corrupt/oversize inputs stay proven
// below through real files.
it.each(files)(
  'file decoding rejects invalid UTF-8 without losing other sources: %s',
  async (file) => {
    const dir = await setup()
    await fs.writeFile(path.join(dir, file), Buffer.from([0xc3, 0x28]))
    await fileFailure(dir, file, EN.reportSourceReasons.invalid)
  },
)
it.each(files)('byte bounds preserve other sources: %s', async (file) => {
  const dir = await setup()
  await fs.writeFile(
    path.join(dir, file),
    ' '.repeat(
      (file === 'providers.json' ? EXEC_UNTRUSTED_FILE_MAX_BYTES : DEVELOPER_AUDIT_MAX_BYTES) + 1,
    ),
  )
  await fileFailure(dir, file, EN.reportSourceReasons.limit)
})
// NOTE (MSM113FIX): the split-read assembly case is gone. It answered
// every handle read two bytes at a time through a read hook: interception,
// with no deterministic real trigger (regular-file reads arrive whole).
// The multi-chunk assembly verdict is withdrawn in
// docs/certification/msm113.md.

it.each([
  'usage',
  'events',
  'confirmations',
  'percents',
  'accounts',
  'providers',
  'audit',
  'items',
  'grants',
  'developerAudit',
] as const)('row bounds are enforced before final assembled validation: %s', async (facet) => {
  const dir = await setup()
  const count = REPORT_MAX_ROWS + 1
  if (['audit', 'items', 'grants', 'developerAudit'].includes(facet)) {
    if (facet === 'developerAudit') {
      // The byte cap protects this stream before it can exceed the joint row cap.
      const line = JSON.stringify({ v: 1, time: 1, action: 'a', source: 'b' }) + '\n'
      // Its byte cap is reached before the combined rotation row cap.
      await writeDeveloperAudit(dir, 'developer-audit.jsonl', [line.repeat(count)])
      const result = await security(dir)
      partial(result, [EN.reportSourceReasons.limit])
      securitySurvivors(result, ['unlock'])
      return
    }
    const view = canaryVaultSnapshot()
    const key = vaultRecordKey(facet)
    const result = await security(dir, {
      ...view,
      [key]: Array.from({ length: count }, () => view[key][0]),
    })
    partial(result, [EN.reportSourceReasons.limit, EN.reportSourceReasons.invalid])
    securitySurvivors(result, lostVaultFacets(facet))
    if (facet === 'audit') expect(result.data).toHaveProperty('audit.length', REPORT_MAX_ROWS)
    else if (facet === 'items')
      expect(result.data).toHaveProperty('vault.itemCount', REPORT_MAX_ROWS)
    return
  }
  if (facet === 'percents') {
    await fs.writeFile(
      path.join(dir, 'providers.json'),
      registry({
        ...provider(),
        accounts: [
          {
            ...account(),
            thresholds: {
              ...account().thresholds,
              planWindowPercent: Object.fromEntries(
                Array.from({ length: count }, (_, index) => [`p${String(index)}`, 80]),
              ),
            },
          },
        ],
      }),
    )
  } else if (facet === 'accounts' || facet === 'providers') {
    // Omit optional empty accounts so provider rows reach admission within the byte cap.
    const tinyAccount = { id: 'a', label: 'A', order: 0, thresholds: {} }
    const tinyProvider = { id: 'z', product: 'a', auth: 'none' }
    const text =
      facet === 'accounts'
        ? registry({
            ...provider(),
            accounts: [account(), ...Array.from({ length: REPORT_MAX_ROWS }, () => tinyAccount)],
          })
        : JSON.stringify({
            providers: Object.fromEntries([
              ['meta', provider()],
              ...Array.from({ length: REPORT_MAX_ROWS }, (_, index) => [
                `p${String(index)}`,
                tinyProvider,
              ]),
            ]),
          })
    if (Buffer.byteLength(text) > EXEC_UNTRUSTED_FILE_MAX_BYTES) {
      await fs.writeFile(path.join(dir, 'providers.json'), text)
      const result = await accounts(dir)
      partial(result, [EN.reportSourceReasons.limit])
      accountSurvivors(result, ['providers'])
      return
    }
    await fs.writeFile(path.join(dir, 'providers.json'), text)
  }
  const result = await accounts(dir, {
    readUsage: () =>
      Promise.resolve(facet === 'usage' ? Array.from({ length: count }, () => usage) : [usage]),
    readEvents: () =>
      Promise.resolve({
        events: facet === 'events' ? Array.from({ length: count }, () => event) : [event],
        confirmations:
          facet === 'confirmations'
            ? Array.from({ length: count }, () => confirmation)
            : [confirmation],
      }),
  })
  partial(result, [EN.reportSourceReasons.limit])
  accountSurvivors(result, ['usage', 'events', 'confirmations'].includes(facet) ? [facet] : [])
  const key =
    facet === 'percents' ? 'providers.0.accounts.0.thresholds.percents.length' : `${facet}.length`
  if (facet !== 'accounts') expect(result.data).toHaveProperty(key, REPORT_MAX_ROWS)
})

it('records the only malformed-port cast and keeps assertion helpers cast-free', async () => {
  const plan = await fs.readFile(path.resolve('PLAN.md'), 'utf8')
  const helper = await fs.readFile(
    path.resolve('test/unit/helpers/reporting/reasonCases.ts'),
    'utf8',
  )
  const reasons = await fs.readFile(path.resolve('test/unit/reportSourceReasons.test.ts'), 'utf8')
  expect(plan.slice(plan.indexOf('## 8. Escape hatches register'))).toContain(
    'test/unit/helpers/reporting/reasonCases.ts:malformed',
  )
  expect(helper).toContain('PLAN §8 CM1133R4')
  expect(reasons).not.toMatch(/as unknown as|data as /u)
})

// NOTE (MSM113FIX): the identity-change and growing-body cases are gone.
// Both rewrote identity answers mid-read through module hooks: the
// replaced-inode refusal and the growth-past-the-byte-bound verdicts have
// no deterministic real trigger (a real replacement cannot be scheduled
// into the microsecond read window). Both verdicts are withdrawn in
// docs/certification/msm113.md; static oversize inputs stay proven above
// through real files.

it.each([
  null,
  [],
  { requests: null },
  { spendUsd: null },
  { planWindowPercent: { 'invalid/name': 80, good: 80 } },
  { requests: { extra: 100 } },
])(
  'malformed threshold containers retain metadata and unaffected limits: %j',
  async (thresholds) => {
    const dir = await setup()
    await fs.writeFile(
      path.join(dir, 'providers.json'),
      registry({ ...provider(), accounts: [{ ...account(), thresholds }, account()] }),
    )
    const result = await accounts(dir)
    partial(result)
    accountSurvivors(result)
    expect(result.data).toHaveProperty('providers.0.accounts.1.thresholds.spendUsd', [
      { period: 'day', value: '5' },
    ])
  },
)

it('future account fields are disclosed without erasing known metadata', async () => {
  const dir = await setup()
  await fs.writeFile(
    path.join(dir, 'providers.json'),
    registry({ ...provider(), accounts: [{ ...account(), future: 'bogus' }] }),
  )
  const result = await accounts(dir)
  partial(result)
  accountSurvivors(result)
})

it.each(['usage', 'events', 'confirmations', 'items', 'grants', 'audit'] as const)(
  'throwing record getters retain earlier and later siblings: %s',
  async (facet) => {
    const dir = await setup()
    // eslint-disable-next-line no-restricted-syntax -- throwing record getters: only a Proxy get trap makes every property read throw, which is what this sibling-retention case proves the reader survives.
    const bad = new Proxy(
      {},
      {
        get: () => {
          throw new Error('record decode broke')
        },
      },
    )
    if (['usage', 'events', 'confirmations'].includes(facet)) {
      const rows = { usage: [usage], events: [event], confirmations: [confirmation] }
      const result = await accounts(dir, {
        readUsage: () =>
          Promise.resolve(
            malformed(facet === 'usage' ? [usage, bad, usage] : rows.usage, rows.usage),
          ),
        readEvents: () =>
          Promise.resolve(
            malformed(
              {
                ...rows,
                ...(facet !== 'usage' && {
                  [facet]: [
                    facet === 'events' ? event : confirmation,
                    bad,
                    facet === 'events' ? event : confirmation,
                  ],
                }),
              },
              rows,
            ),
          ),
      })
      partial(result, [EN.reportSourceReasons.failed])
      accountSurvivors(result, [facet])
      expect(result.data).toHaveProperty(`${facet}.length`, 2)
    } else {
      const view = canaryVaultSnapshot()
      const key = vaultRecordKey(facet)
      const result = await security(dir, { ...view, [facet]: [view[key][0], bad, view[key][0]] })
      partial(result, [EN.reportSourceReasons.failed, EN.reportSourceReasons.invalid])
      expect(result.data).toHaveProperty('developerAudit.length', 2)
      if (facet === 'audit') expect(result.data).toHaveProperty('audit.length', 2)
      else if (facet === 'items') expect(result.data).toHaveProperty('vault.itemCount', 2)
    }
  },
)

it.each(['state', 'tier', 'items', 'grants', 'audit'] as const)(
  'throwing snapshot facet retains independent evidence: %s',
  async (facet) => {
    const view = canaryVaultSnapshot()
    Object.defineProperty(view, facet, {
      get: () => {
        throw new Error('snapshot facet broke')
      },
    })
    const result = await security(await setup(), view)
    partial(result, [EN.reportSourceReasons.failed, EN.reportSourceReasons.invalid])
    securitySurvivors(result, lostVaultFacets(facet))
  },
)
