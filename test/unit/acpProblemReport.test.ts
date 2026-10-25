// `/report problem` in an ACP editor (lane REPORTFLOW R2): the description the
// command carries, and what the session answers when the problem report
// cannot be built. Any other `/report` use stays with the deterministic engine.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { problemReportDescription, runAcpProblemReport } from '../../src/acp/reports'
import { UI_TEXT } from '../../src/shared/constants'

const MISSING = path.join('temp', 'acp-problem-report-never-written.md')

function contextWith(signal: AbortSignal) {
  return { cwd: path.join(path.sep, 'reports', 'workspace'), sessionId: 'session', signal }
}

describe('problemReportDescription', () => {
  it('reads the description and leaves every other /report use to the engine', () => {
    expect(problemReportDescription('problem')).toBe('')
    expect(problemReportDescription('problem   the panel is blank  ')).toBe('the panel is blank')
    expect(problemReportDescription('project')).toBeUndefined()
    expect(problemReportDescription('problems')).toBeUndefined()
    expect(problemReportDescription('')).toBeUndefined()
  })
})

describe('runAcpProblemReport', () => {
  it('answers undefined with no port, so the engine handles the command', async () => {
    const answer = await runAcpProblemReport(
      'blank',
      undefined,
      contextWith(new AbortController().signal),
    )
    expect(answer).toBeUndefined()
  })

  it('answers the draft text the port built', async () => {
    const answer = await runAcpProblemReport(
      'blank',
      { execute: (description) => Promise.resolve(`draft: ${description}`) },
      contextWith(new AbortController().signal),
    )
    expect(answer).toBe('draft: blank')
  })

  it('names the reason a failed build gives', async () => {
    const answer = await runAcpProblemReport(
      'blank',
      {
        // A real refusal: the system's own ENOENT for a journal that is not there.
        execute: async () => {
          await readFile(MISSING, 'utf8')
          return ''
        },
      },
      contextWith(new AbortController().signal),
    )
    expect(answer).toContain(UI_TEXT.reportUi.generationReason.split('{reason}', 1)[0])
    expect(answer).toContain('ENOENT')
  })

  it('keeps the fixed sentence for a turn the person cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const answer = await runAcpProblemReport(
      'blank',
      { execute: () => Promise.resolve('never reached') },
      contextWith(controller.signal),
    )
    expect(answer).toBe(UI_TEXT.reportUi.generationFailed)
  })
})
