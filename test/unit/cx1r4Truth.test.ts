// CX1R4: RVCX1C findings — every current surface says what the code does today.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  contributedIds,
  parseChangelog,
  repositoryUrl,
} from '../../scripts/lib/whatsNewContent.mjs'
import manifest from '../../package.json'
import { formatAcpUsage } from '../../src/runtime/cliOptions'
import { createRuntimeReports } from '../../src/runtime/reporting/reportsEntry'
import { parseReportsArguments, reportsUsage } from '../../src/runtime/reporting/reportsArgs'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseReportRequest } from '../../src/host/reporting/reportRequest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_KINDS, REPORT_WORKING_KINDS } from '../../src/shared/constants'
import { currentWhatsNewText } from './helpers/currentWhatsNew'

function repoFile(name: string): string {
  return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}

function tableOf(language: string): Record<string, unknown> {
  return JSON.parse(repoFile(`l10n/ui.${language}.json`)) as Record<string, unknown>
}

function at(table: Record<string, unknown>, path: string): string {
  let value: unknown = table
  for (const part of path.split('.')) value = (value as Record<string, unknown>)[part]
  return value as string
}

const changelog = repoFile('CHANGELOG.md')
const releases = parseChangelog(
  repoFile('CHANGELOG.md'),
  contributedIds(manifest),
  repositoryUrl(manifest),
)

const WORKING_REPORT_KINDS = [
  'project',
  'milestone',
  'release',
  'changes',
  'quality',
  'usage',
  'session',
  'keybindings',
  'accounts',
  'security',
  'estimate',
  'playbook',
  'issues',
  'schedules',
]
const DORMANT_REPORT_KINDS = REPORT_KINDS.filter(
  (kind) => !(WORKING_REPORT_KINDS as readonly string[]).includes(kind),
)

function noIo(): never {
  throw new Error('no IO during help')
}

function acpReports() {
  return createRuntimeReports({
    cwd: '/cx1r4/workspace',
    locale: 'en',
    table: EN,
    now: () => '2026-10-10T12:00:00Z',
    readSaved: noIo,
    resolveSaved: noIo,
    writeOut: noIo,
    readTable: noIo,
    stdout: noIo,
    stderr: noIo,
    servicesFor: undefined,
    roots: ['/cx1r4/workspace'],
  })
}

const acpContext = {
  cwd: '/cx1r4/workspace',
  sessionId: 'cx1r4-session',
  format: 'md' as const,
  signal: new AbortController().signal,
}

// CM108ACC bound accounts in the terminal and in ACP on the Model API backend:
// list, current, thresholds and per-account keys. Pooling, in-session
// switching, the three settings and the editor's page stay unpublished.
describe('CX1R4 F1 after CM108ACC: accounts are published where the code serves them', () => {
  it('compact help prints the accounts usage line and offers no pooling', () => {
    const usage = formatAcpUsage(EN, 'muse-spark-code-acp')
    expect(usage).toContain(
      'Accounts: muse-spark-code-acp providers accounts list|add|remove|order|thresholds',
    )
    expect(usage).toContain('muse-spark-code-acp auth set --provider <id> --account <id>')
    expect(usage).not.toMatch(/account-pool/)
  })

  it('released history archives the 0.17.0 accounts highlight', () => {
    const highlights = JSON.stringify(
      releases.find((entry) => entry.version === '0.17.0')?.highlights,
    )
    expect(highlights).not.toContain('Several accounts')
    expect(changelog).toMatch(
      /\*\*Several accounts per provider\.\*\*[\s\S]{0,200}<!-- whats-new: historical -->/,
    )
  })
})

describe('CX1R4 F2: previews claim is historical, strict-tool facts stay current', () => {
  it('the 0.16.0 Added notes keep the working loop facts without the previews claim', () => {
    const release = releases.find((entry) => entry.version === '0.16.0')
    expect(release).toBeDefined()
    const shown = JSON.stringify(release?.sections)
    expect(shown).toContain('completed calls remain the execution boundary')
    expect(shown).not.toMatch(/previews load on first use/)
  })

  it('encoded current notes exclude the archived previews bullet', () => {
    // 0.17.1 is now the newest release, so What's New's two full releases are
    // 0.17.1 and 0.17.0. 0.16.0's own notes still take the shipped round trip.
    const shown = currentWhatsNewText(releases.filter((entry) => entry.version === '0.16.0'))
    expect(shown).toContain('completed calls remain the execution boundary')
    expect(shown).not.toMatch(/previews load on first use/)
    expect(currentWhatsNewText(releases)).not.toMatch(/previews load on first use/)
    expect(changelog).toContain('Tool argument previews load on first use.')
  })
})

describe('CX1R4 F3: live Help and pickers list only the fourteen working kinds', () => {
  it('the working set is exactly the fourteen sourced kinds', () => {
    expect([...REPORT_WORKING_KINDS]).toEqual(WORKING_REPORT_KINDS)
    expect(DORMANT_REPORT_KINDS).toHaveLength(1)
  })

  it('the real ACP report entry lists the fourteen kinds and none of the dormant one', async () => {
    const { text } = await acpReports().acp.execute('', acpContext)
    for (const kind of WORKING_REPORT_KINDS) expect(text).toContain(`/report ${kind}`)
    for (const kind of DORMANT_REPORT_KINDS) expect(text).not.toContain(`/report ${kind}`)
    expect(text).toContain('/report history')
  })

  it('the terminal usage lists every working kind with its required argument (RVMSM113)', () => {
    const usage = reportsUsage(EN)
    for (const kind of WORKING_REPORT_KINDS) expect(usage).toContain(kind)
    expect(usage).toContain('milestone <id>')
    expect(usage).toContain('release <version|latest>')
    expect(usage).toContain('estimate <milestone>')
  })

  it('report --help reaches the report command, not the whole help reference (RVMSM113)', () => {
    expect(parseCommandLine(['report', '--help'])).toEqual({
      command: 'reports',
      args: ['--help'],
    })
  })

  it('parsers and history keep accepting every kind', () => {
    // Scoped forms match each parser's own argument rules.
    const cliArgv: Readonly<Record<string, readonly string[]>> = {
      estimate: ['estimate', 'goal'],
    }
    const editorText: Readonly<Record<string, string>> = {
      estimate: 'estimate goal',
    }
    for (const kind of DORMANT_REPORT_KINDS) {
      expect(parseReportsArguments(cliArgv[kind] ?? [kind]).kind).toBe(kind)
      const request = parseReportRequest(editorText[kind] ?? kind, '2026-10-10T12:00:00Z')
      expect(request).toMatchObject({ action: 'run', options: { kind } })
    }
    expect(parseReportRequest('', '2026-10-10T12:00:00Z')).toEqual({ action: 'pick' })
  })
})
describe('CX1R4 F5: corrected English keys ship fresh translations', () => {
  const corrected: Readonly<Record<string, string>> = {
    resourceRelocationNoRoute:
      'Relocation requires a paired device or runner route. Work stays on this machine.',
    resourceRelocateDescription:
      'Relocation requires a paired device or runner route. Work stays on this machine.',
    'reportUi.unsupportedKind': 'Report kind {kind} is unavailable.',
    'reportSourceReasons.unbound': 'This source integration is unavailable.',
    providerOpenRouterServices:
      'Connect your OpenRouter account and view the key’s usage, limit and remaining balance.',
  }
  // Stale markers from the superseded translations: any table value still
  // matching its language marker keeps the old translation for that key.
  const stale: Readonly<Record<string, RegExp>> = {
    cs: /zatím/,
    de: /noch nicht verfügbar/,
    es: /aún no están? disponible/,
    fr: /pas encore disponibles?/,
    hu: /még nem/,
    it: /ancora/,
    ja: /まだ/,
    ko: /아직/,
    pl: /jeszcze/,
    'pt-br': /ainda/,
    ru: /пока/,
    tr: /henüz/,
    'zh-cn': /尚不可用|暂不可用/,
    'zh-tw': /尚無法使用|尚未/,
  }

  it('English holds the corrected wording', () => {
    for (const [path, text] of Object.entries(corrected)) expect(at(EN, path)).toBe(text)
  })

  it.each(Object.entries(stale))(
    'the %s table carries no stale wording for a corrected key',
    (language, marker) => {
      const table = tableOf(language)
      for (const path of Object.keys(corrected)) expect(at(table, path)).not.toMatch(marker)
    },
  )
})
