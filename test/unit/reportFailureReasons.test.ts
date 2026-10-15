import { describe, expect, it } from 'vitest'
import { runAcpReport } from '../../src/acp/reports'
import { runReportsCommand } from '../../src/runtime/reporting/reportsCommand'
import { reportsCommandDeps } from './reportRenderFixtures'

describe('report failure reasons', () => {
  it('names the failing source on the terminal instead of one sentence', async () => {
    let diagnostic = ''
    const collect = (text: string) => {
      diagnostic += text
    }
    const code = await runReportsCommand(
      ['project'],
      reportsCommandDeps({
        services: {
          generate: () => Promise.reject(new Error('plan store locked: EACCES')),
        },
        stdout: (text) => {
          collect(`unexpected stdout: ${text}`)
        },
        stderr: collect,
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
