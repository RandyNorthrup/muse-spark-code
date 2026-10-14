import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { runAcpReport } from '../../src/acp/reports'
import {
  runReportsCommand,
  type ReportsCommandDeps,
} from '../../src/runtime/reporting/reportsCommand'
import { REPORT_THEME } from './reportRenderFixtures'

function commandDeps(stderr: (text: string) => void): ReportsCommandDeps {
  return {
    text: EN,
    services: {
      generate: () => Promise.reject(new Error('plan store locked: EACCES')),
    },
    keepHistory: true,
    locale: 'en',
    localePort: { textForLocale: () => EN },
    theme: REPORT_THEME,
    now: () => '2026-10-14T00:00:00.000Z',
    readSaved: () => Promise.reject(new Error('unused')),
    writeOut: () => Promise.resolve(),
    stdout: (text) => {
      stderr(`unexpected stdout: ${text}`)
    },
    stderr,
  }
}

describe('report failure reasons', () => {
  it('names the failing source on the terminal instead of one sentence', async () => {
    let diagnostic = ''
    const code = await runReportsCommand(
      ['project'],
      commandDeps((text) => {
        diagnostic += text
      }),
    )
    expect(code).toBe(1)
    expect(diagnostic).toContain('The report could not be generated:')
    expect(diagnostic).toContain('plan store locked')
  })

  it('returns the real reason to the session instead of one sentence', async () => {
    const text = await runAcpReport(
      'project',
      {
        format: 'md',
        execute: () => Promise.reject(new Error('git probe timed out')),
      },
      { cwd: '/reports/workspace', sessionId: 'session', signal: new AbortController().signal },
    )
    expect(text).toContain('The report could not be generated:')
    expect(text).toContain('git probe timed out')
  })
})
