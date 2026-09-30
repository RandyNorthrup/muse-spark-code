// @vitest-environment jsdom
// The verify loop in the transcript (M68, PLAN.md D49): the automatic check
// row and run_checks with their summary line, an edit's then_run as the
// call's second result, the reducer keeping both, and the Markdown export.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { renderTranscriptMarkdown } from '../../src/core/export/transcriptMarkdown'
import { describeTool } from '../../src/webview/toolPresentation'
import { thenRunOutcomeText, verifySummaryText } from '../../src/shared/verifyText'
import { initialUiState, type UiState, uiReducer } from '../../src/webview/state/uiState'
import { renderTranscript, tool } from './helpers/transcriptFixtures'

function withEvent(
  state: UiState,
  type: 'itemStarted' | 'itemCompleted' | 'itemUpdated',
  item: ItemSnapshot,
): UiState {
  return uiReducer(state, {
    type: 'hostMessage',
    message: { type: 'agentEvent', event: { type, item } },
    at: 0,
  })
}

const CHECKED = [
  'Errors and warnings of the files you edited, from the language servers:',
  'src/a.ts: errors 1, warnings 0',
  "src/a.ts:1:7: error: Type 'string' is not assignable to type 'number'. [ts]",
  '',
  "The user's check commands:",
  '',
  "lint: failed\n$ npm run lint -- 'src/a.ts'\nsrc/a.ts:1:7 error no-unused-vars\n[exit code 1]",
].join('\n')

function row(label: string): HTMLElement {
  const found = screen.getByText(label).closest('li')
  if (found === null) {
    throw new Error(`no row ${label}`)
  }
  return found
}

describe('the verify rows', () => {
  it('sum the files and checks up under the row, and open on what the model read', () => {
    renderTranscript([
      tool({
        id: 'v1',
        tool: 'verify_edits',
        args: JSON.stringify({ paths: ['src/a.ts', 'src/b.ts'] }),
        output: CHECKED,
        verifySummary: {
          files: ['src/a.ts', 'src/b.ts'],
          errors: 1,
          warnings: 2,
          checks: [
            { name: 'lint', outcome: 'failed' },
            { name: 'test', outcome: 'passed' },
            { name: 'types', outcome: 'notRun', skip: 'rejected' },
          ],
        },
      }),
    ])
    const found = row('Check edits')
    expect(within(found).getByText('src/a.ts, src/b.ts')).toBeTruthy()
    expect(
      within(found).getByText('1 error, 2 warnings · lint failed · test passed · types not run'),
    ).toBeTruthy()
    const [toggle] = within(found).getAllByRole('button', { expanded: false })
    if (toggle === undefined) {
      throw new Error('no toggle')
    }
    fireEvent.click(toggle)
    expect(found.querySelector('.tool-output')?.textContent).toContain('lint: failed')
  })

  it('reads a run with no diagnostics or checks to report as nothing, a clean one as clean', () => {
    expect(verifySummaryText(undefined)).toBeUndefined()
    expect(verifySummaryText({ files: [], checks: [] })).toBeUndefined()
    expect(verifySummaryText({ files: ['a'], errors: 0, warnings: 0, checks: [] })).toBe(
      'No errors or warnings',
    )
    expect(
      verifySummaryText({
        files: [],
        checks: [
          { name: 'lint', outcome: 'timedOut' },
          { name: 'test', outcome: 'cancelled' },
        ],
      }),
    ).toBe('lint timed out · test stopped')
  })

  // The M68 review: a file no report arrived for is "not checked", never clean.
  it('counts the files it could not check apart from the clean ones', () => {
    expect(verifySummaryText({ files: ['a', 'b'], unchecked: 2, checks: [] })).toBe(
      '2 files not checked',
    )
    expect(
      verifySummaryText({ files: ['a', 'b'], errors: 0, warnings: 0, unchecked: 1, checks: [] }),
    ).toBe('No errors or warnings · 1 file not checked')
  })

  it('label the model’s run_checks and the automatic row, with their files', () => {
    expect(describeTool('run_checks', '{"names":["lint"],"paths":["src/a.ts"]}')).toMatchObject({
      label: 'Run checks',
      summary: 'src/a.ts',
      body: 'verify',
    })
    expect(describeTool('verify_edits', '{"paths":[1,"x"]}')).toMatchObject({
      label: 'Check edits',
      summary: '',
    })
  })
})

describe('an edit’s then_run', () => {
  it('shows the command and its output under the diff: one call, two results', () => {
    renderTranscript([
      tool({
        id: 'e1',
        tool: 'edit_file',
        args: JSON.stringify({ path: 'src/a.ts', find: '1', replace: '2', then_run: 'npm test' }),
        output: 'edited\n--- original\n+++ updated\n@@\n-const a = 1\n+const a = 2\n',
        patchSummary: { files: 1, added: 1, removed: 1 },
        thenRun: { command: 'npm test', outcome: 'failed', output: '1 failing', exitCode: 1 },
      }),
    ])
    const found = row('Edit')
    expect(found.querySelector('.diff-add')?.textContent).toContain('const a = 2')
    const block = found.querySelector('.then-run')
    expect(block).not.toBeNull()
    expect(within(block as HTMLElement).getByText('Then ran')).toBeTruthy()
    expect(within(block as HTMLElement).getByText('npm test')).toBeTruthy()
    expect(within(block as HTMLElement).getByText('1 failing')).toBeTruthy()
    expect(within(block as HTMLElement).getByText('Exit code 1').className).toContain(
      'then-run-failed',
    )
  })

  it('says why a command did not run, or how it was stopped', () => {
    expect(
      thenRunOutcomeText({ command: 'x', outcome: 'notRun', skip: 'changed', output: '' }),
    ).toBe('Not run: the file changed after the edit')
    expect(thenRunOutcomeText({ command: 'x', outcome: 'timedOut', output: '' })).toBe(
      'Stopped at its time limit',
    )
    expect(thenRunOutcomeText({ command: 'x', outcome: 'cancelled', output: '' })).toBe('Stopped')
    expect(thenRunOutcomeText({ command: 'x', outcome: 'passed', output: 'ok', exitCode: 0 })).toBe(
      'Exit code 0',
    )
  })

  // The M68 review: a command that could not start failed; it was not stopped.
  it('says a failure without an exit code failed, and gives a hook’s words', () => {
    expect(thenRunOutcomeText({ command: 'x', outcome: 'failed', output: 'spawn ENOENT' })).toBe(
      'Failed without an exit code',
    )
    expect(
      thenRunOutcomeText({
        command: 'x',
        outcome: 'notRun',
        skip: 'hookDenied',
        detail: 'no tests on main',
        output: '',
      }),
    ).toBe('Not run: a hook denied it: no tests on main')
  })
})

describe('the reducer and the export keep both', () => {
  const edit: ItemSnapshot = {
    itemId: 'e1',
    kind: 'toolCall',
    status: 'completed',
    turnId: 't1',
    tool: 'edit_file',
    args: '{"path":"src/a.ts","then_run":"npm test"}',
    visibleOutput: 'edited',
    thenRun: { command: 'npm test', outcome: 'passed', output: 'ok', exitCode: 0 },
  }
  const check: ItemSnapshot = {
    itemId: 'v1',
    kind: 'toolCall',
    status: 'completed',
    turnId: 't1',
    tool: 'verify_edits',
    args: '{"paths":["src/a.ts"]}',
    visibleOutput: 'checked',
    verifySummary: { files: ['src/a.ts'], errors: 0, warnings: 0, checks: [] },
  }

  it('keeps the then_run and the summary through a start and a later revision', () => {
    // The start has no second result yet; a later revision may leave the summary out.
    const started: ItemSnapshot = {
      itemId: edit.itemId,
      kind: 'toolCall',
      status: 'inProgress',
      tool: 'edit_file',
    }
    const revised: ItemSnapshot = {
      itemId: check.itemId,
      kind: 'toolCall',
      status: 'completed',
      tool: 'verify_edits',
    }
    let state = withEvent(initialUiState, 'itemStarted', started)
    state = withEvent(state, 'itemCompleted', edit)
    state = withEvent(state, 'itemCompleted', check)
    state = withEvent(state, 'itemUpdated', revised)
    const tools = state.transcript.flatMap((entry) => (entry.kind === 'tool' ? [entry] : []))
    expect(tools.map((entry) => [entry.thenRun, entry.verifySummary])).toEqual([
      [edit.thenRun, undefined],
      [undefined, check.verifySummary],
    ])
  })

  it('exports the then_run command and what it printed', () => {
    const markdown = renderTranscriptMarkdown({
      title: 'x',
      sessionId: 's',
      backendLabel: 'Model API',
      modelId: 'muse-spark-1.3',
      exportedAt: '2026-09-28T00:00:00.000Z',
      items: [edit],
    })
    expect(markdown).toContain('Then ran:\n\n```\n$ npm test\nok\n```\n\n_Exit code 0_')
  })

  // The M68 review: the export says what the row says, skips and summary too.
  it('exports a skipped then_run and a check row’s summary line', () => {
    const skipped: ItemSnapshot = {
      ...edit,
      thenRun: { command: 'npm test', outcome: 'notRun', skip: 'rejected', output: '' },
    }
    const markdown = renderTranscriptMarkdown({
      title: 'x',
      sessionId: 's',
      backendLabel: 'Model API',
      modelId: 'muse-spark-1.3',
      exportedAt: '2026-09-28T00:00:00.000Z',
      items: [
        skipped,
        { ...check, verifySummary: { files: ['src/a.ts'], unchecked: 1, checks: [] } },
      ],
    })
    expect(markdown).toContain('_then_run `npm test`: Not run: rejected_')
    expect(markdown).not.toContain('$ npm test')
    expect(markdown).toContain('_1 file not checked_')
  })
})
