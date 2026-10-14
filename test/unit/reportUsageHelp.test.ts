import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_WORKING_KINDS } from '../../src/shared/constants'
import {
  parseReportsArguments,
  reportsHelp,
  ReportUsageError,
} from '../../src/runtime/reporting/reportsArgs'
import {
  runReportsCommand,
  type ReportsCommandDeps,
} from '../../src/runtime/reporting/reportsCommand'
import { REPORT_THEME } from './reportRenderFixtures'

describe('report usage errors', () => {
  it.each([
    ['release', 'releaseNeedsVersion'],
    ['milestone', 'milestoneNeedsId'],
    ['estimate', 'estimateNeedsScope'],
  ] as const)('/report %s says what it needs', (kind, key) => {
    try {
      parseReportsArguments([kind])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ReportUsageError)
      expect((error as ReportUsageError).code).toBe(key)
      const missing = { release: 'version', milestone: 'id', estimate: 'scope' }[kind]
      expect(EN.reportUi[key]).toContain(missing)
    }
  })

  it('prints the missing piece before usage on the terminal', async () => {
    let diagnostic = ''
    const deps: ReportsCommandDeps = {
      text: EN,
      services: {},
      keepHistory: true,
      locale: 'en',
      localePort: { textForLocale: () => EN },
      theme: REPORT_THEME,
      now: () => '2026-10-14T00:00:00.000Z',
      readSaved: () => Promise.reject(new Error('unused')),
      writeOut: () => Promise.resolve(),
      stdout: (text) => {
        diagnostic += `unexpected stdout: ${text}`
      },
      stderr: (text) => {
        diagnostic += text
      },
    }
    const code = await runReportsCommand(['release'], deps)
    expect(code).toBe(2)
    expect(diagnostic).toContain(EN.reportUi.releaseNeedsVersion)
    expect(diagnostic).toContain('report <kind>')
  })
})

describe('report help', () => {
  it('lists every working kind with its label', () => {
    const help = reportsHelp(EN)
    for (const kind of REPORT_WORKING_KINDS) {
      expect(help).toContain(kind)
      expect(help).toContain(EN.reportKinds[kind])
    }
  })

  it('answers --help with the kinds on the terminal', async () => {
    let shown = ''
    const deps: ReportsCommandDeps = {
      text: EN,
      services: {},
      keepHistory: true,
      locale: 'en',
      localePort: { textForLocale: () => EN },
      theme: REPORT_THEME,
      now: () => '2026-10-14T00:00:00.000Z',
      readSaved: () => Promise.reject(new Error('unused')),
      writeOut: () => Promise.resolve(),
      stdout: (text) => {
        shown += text
      },
      stderr: (text) => {
        shown += `unexpected stderr: ${text}`
      },
    }
    const code = await runReportsCommand(['--help'], deps)
    expect(code).toBe(0)
    for (const kind of REPORT_WORKING_KINDS) expect(shown).toContain(kind)
  })
})
