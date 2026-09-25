// @vitest-environment jsdom
// The rows of Muse Code's own tools (M43, PLAN.md D36). Every argument and
// result below is the shape Muse Code 1.3.0 sent on 2026-09-25
// (docs/certification/m43.md), trimmed to what the row reads.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderTranscript, tool } from './helpers/transcriptFixtures'

const GOAL = {
  session_id: 's',
  goal_id: 'goal-1',
  objective: 'Say hello in one word',
  status: 'active',
  percent_complete: 50,
  current_work: 'Saying hello',
  next_work: 'Mark complete',
  token_budget: null,
  tokens_used: 24_331,
}

const SEARCH = {
  query: 'Keep a Changelog 1.1.0',
  results: [
    {
      url: 'https://keepachangelog.com/en/1.1.0/',
      title: 'Keep a Changelog',
      snippet: 'Don’t let your friends dump git logs into changelogs.',
      page_last_modified: 1_788_771_840,
    },
    { url: '/etc/passwd', title: 'Not a page' },
  ],
}

/** The row's body, opened. */
function openRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest('li')
  if (row === null) {
    throw new Error(`no row ${label}`)
  }
  const toggle = within(row).getAllByRole('button', { expanded: false })[0]
  if (toggle !== undefined) {
    fireEvent.click(toggle)
  }
  return row
}

describe('memory rows (M43)', () => {
  it('shows the note saved, where it lives, and the path beside the label', () => {
    renderTranscript([
      tool({
        tool: 'add_memory',
        args: '{"content":"The favourite colour is teal.","path":"palette.md","scope":"personal_project"}',
        output:
          '{"success":true,"scope":"personal_project","path":"palette.md","operation":"add","message":"memory note written"}',
      }),
    ])
    expect(screen.getByText('palette.md')).toBeTruthy()
    const row = openRow('Save memory')
    expect(within(row).getByText('Your memory for this project')).toBeTruthy()
    expect(within(row).getByText('The favourite colour is teal.')).toBeTruthy()
    expect(within(row).queryByText(/memory note written/)).toBeNull()
  })

  it('shows what a read brought back, not the JSON around it', () => {
    renderTranscript([
      tool({
        tool: 'read_memory',
        args: '{"limit":500,"offset":1,"path":"palette.md","scope":"project"}',
        output:
          '{"success":true,"scope":"project","path":"palette.md","start_line_number":1,"content":"The favourite colour is teal.","truncated":false}',
      }),
    ])
    const row = openRow('Read memory')
    expect(within(row).getByText('Project memory, shared with the repository')).toBeTruthy()
    expect(within(row).getByText('The favourite colour is teal.')).toBeTruthy()
    expect(within(row).queryByText(/start_line_number/)).toBeNull()
  })

  it('shows an edit as the text replaced and its replacement', () => {
    const container = document.body
    renderTranscript([
      tool({
        tool: 'edit_memory',
        args: '{"new_str":"The favourite colour is navy.","old_str":"The favourite colour is teal.","path":"palette.md","scope":"personal"}',
        output: '{"success":true,"operation":"edit","message":"memory note edited"}',
      }),
    ])
    openRow('Edit memory')
    expect(container.querySelector('.diff-remove')?.textContent).toContain('teal')
    expect(container.querySelector('.diff-add')?.textContent).toContain('navy')
    expect(screen.getByText('Your memory for every project')).toBeTruthy()
  })
})

describe('goal rows (M43)', () => {
  it('shows the goal, its status, progress, current and next work, and the tokens', () => {
    renderTranscript([
      tool({
        tool: 'report_progress',
        args: '{"current_work":"Saying hello","next_work":"Mark complete","percent_complete":50}',
        output: JSON.stringify({ goal: GOAL }),
      }),
    ])
    expect(screen.getAllByText('Saying hello')).toHaveLength(1)
    const row = openRow('Goal progress')
    expect(within(row).getByText('Say hello in one word')).toBeTruthy()
    expect(within(row).getByText('Active · 50% done')).toBeTruthy()
    const bar = within(row).getByRole('progressbar', { name: 'Goal progress' })
    expect(bar.getAttribute('value')).toBe('50')
    expect(within(row).getByText('Mark complete')).toBeTruthy()
    expect(within(row).getByText('24,331')).toBeTruthy()
  })

  it('names the objective of a new goal and the status an update sets', () => {
    renderTranscript([
      tool({
        id: 'g1',
        tool: 'create_goal',
        args: '{"objective":"Ship it"}',
        status: 'inProgress',
      }),
      tool({ id: 'g2', tool: 'update_goal', args: '{"status":"complete"}', status: 'inProgress' }),
      tool({
        id: 'g3',
        tool: 'update_goal',
        args: '{"status":"budget_limited"}',
        status: 'inProgress',
      }),
    ])
    expect(screen.getByText('Ship it')).toBeTruthy()
    expect(screen.getByText('Complete')).toBeTruthy()
    // A status Muse Code adds later shows as it came.
    expect(screen.getByText('budget_limited')).toBeTruthy()
  })

  it('falls back to the text when a goal tool answers something else', () => {
    renderTranscript([tool({ tool: 'get_goal', args: '{}', output: 'No goal is set.' })])
    const row = openRow('Check goal')
    expect(within(row).getByText('No goal is set.')).toBeTruthy()
  })
})

describe('schedule rows (M43)', () => {
  it('shows the prompt, its schedule and that it runs once', () => {
    renderTranscript([
      tool({
        tool: 'cron_create',
        args: '{"cron":"59 23 31 12 *","prompt":"say hi","recurring":false}',
        output: 'Scheduled 2ef46218 (59 23 31 12 *, once)',
      }),
    ])
    const row = openRow('Schedule prompt')
    expect(within(row).getAllByText('say hi').length).toBeGreaterThan(0)
    expect(within(row).getByText('59 23 31 12 * · Once')).toBeTruthy()
    expect(within(row).getByText('Scheduled 2ef46218 (59 23 31 12 *, once)')).toBeTruthy()
  })

  it('lists the jobs with their next run and how often they ran', () => {
    renderTranscript([
      tool({
        tool: 'cron_list',
        args: '{}',
        output: JSON.stringify({
          jobs: [
            {
              id: 'a',
              cron: '*/10 * * * *',
              prompt: 'check the build',
              recurring: true,
              next_fire_at_ms: Date.UTC(2026, 11, 31, 12),
              fire_count: 3,
            },
          ],
        }),
      }),
    ])
    const row = openRow('Scheduled prompts')
    expect(within(row).getByText('check the build')).toBeTruthy()
    const facts = within(row).getByText(/\*\/10 \* \* \* \* · Repeats · Next run .+ · Ran 3 times/)
    expect(facts).toBeTruthy()
  })

  it('says when there is nothing scheduled', () => {
    renderTranscript([tool({ tool: 'cron_list', args: '{}', output: '{"jobs":[]}' })])
    const row = openRow('Scheduled prompts')
    expect(within(row).getByText('No scheduled prompts')).toBeTruthy()
  })
})

describe('web search rows (M43)', () => {
  it('lists the results as links that open in the browser, with their snippets', () => {
    const props = renderTranscript([
      tool({
        tool: 'web_search',
        args: '{"query":"Keep a Changelog 1.1.0"}',
        output: JSON.stringify(SEARCH),
      }),
    ])
    expect(screen.getByText('Keep a Changelog 1.1.0')).toBeTruthy()
    const row = openRow('Web search')
    fireEvent.click(within(row).getByRole('link', { name: 'Keep a Changelog' }))
    expect(props.onOpenLink).toHaveBeenCalledWith('https://keepachangelog.com/en/1.1.0/')
    expect(within(row).getByText(/dump git logs/)).toBeTruthy()
    expect(within(row).queryByText(/page_last_modified/)).toBeNull()
  })

  it('refuses a result that is not a web page', () => {
    const onRefuseLink = vi.fn()
    const props = renderTranscript(
      [tool({ tool: 'web_search', args: '{"query":"x"}', output: JSON.stringify(SEARCH) })],
      { onRefuseLink },
    )
    const row = openRow('Web search')
    fireEvent.click(within(row).getByRole('link', { name: 'Not a page' }))
    expect(onRefuseLink).toHaveBeenCalledOnce()
    expect(props.onOpenLink).not.toHaveBeenCalled()
  })

  it('says a search found nothing, and shows any other result as text', () => {
    renderTranscript([
      tool({
        id: 'w1',
        tool: 'web_search',
        args: '{"query":"a"}',
        output: '{"query":"a","results":[]}',
      }),
      tool({ id: 'w2', tool: 'web_search', args: '{"query":"b"}', output: 'search is off' }),
    ])
    const toggles = screen.getAllByRole('button', { name: /Web search/ })
    for (const toggle of toggles) {
      fireEvent.click(toggle)
    }
    expect(screen.getByText('No results')).toBeTruthy()
    expect(screen.getByText('search is off')).toBeTruthy()
  })
})

describe('background work (M43)', () => {
  const background = JSON.stringify({
    chunk_id: 'exec-1-1',
    command: 'Start-Sleep -Seconds 120',
    execution_state: 'background_running',
    work_id: 'work.v1.managed_bash.sha256.d48e',
    model_guidance: 'The command is still running in the background…',
    output: 'started',
    truncated: false,
  })

  it('shows what the command printed and that it still runs, not the JSON', () => {
    renderTranscript([
      tool({
        tool: 'powershell',
        args: '{"command":"Start-Sleep -Seconds 120","description":"Sleep in background"}',
        status: 'inProgress',
        output: background,
        isBackground: true,
      }),
    ])
    expect(screen.getByText('started')).toBeTruthy()
    expect(screen.getByText('Running in the background')).toBeTruthy()
    expect(screen.queryByText(/model_guidance/)).toBeNull()
  })

  it('drops the running line once the work ended', () => {
    renderTranscript([
      tool({
        tool: 'powershell',
        args: '{"command":"Start-Sleep -Seconds 120"}',
        status: 'cancelled',
        failureReason: 'terminated by powershell_input',
        output: background,
      }),
    ])
    expect(screen.queryByText('Running in the background')).toBeNull()
    expect(screen.getByText(/terminated by powershell_input/)).toBeTruthy()
  })
})

describe('labels (M43)', () => {
  it('names an MCP server’s tool by the tool and its server, its JSON indented', () => {
    renderTranscript([
      tool({ tool: 'mcp__github__create_issue', args: '{"title":"x"}', output: '[1,2]' }),
    ])
    const row = openRow('create_issue (github)')
    expect(
      within(row).getByText('{ "title": "x" }', {
        normalizer: (text) => text.replaceAll(/\s+/g, ' '),
      }),
    ).toBeTruthy()
    expect(
      within(row).getByText('[ 1, 2 ]', { normalizer: (text) => text.replaceAll(/\s+/g, ' ') }),
    ).toBeTruthy()
  })

  it('shows text that is not JSON as it came', () => {
    renderTranscript([tool({ tool: 'mystery', args: 'raw words', output: '42' })])
    const row = openRow('mystery')
    expect(within(row).getByText('raw words')).toBeTruthy()
    expect(within(row).getByText('42')).toBeTruthy()
  })
})

describe('pictures a tool read or made (M43)', () => {
  it('asks the host once for the picture a completed read names, then shows it', () => {
    const entry = tool({
      id: 'r1',
      tool: 'read_file',
      args: '{"path":"dot.png"}',
      output: 'Read image file `dot.png` as model-visible image output.',
    })
    const onReadImage = vi.fn()
    renderTranscript([entry], { onReadImage })
    expect(onReadImage).toHaveBeenCalledExactlyOnceWith('r1', 'dot.png')
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows a loaded picture, opens its file on click, and says why one failed', () => {
    const onOpenFile = vi.fn()
    renderTranscript(
      [
        tool({
          id: 'i1',
          tool: 'generate_image',
          args: '{"prompt":"a lighthouse","path":"media/l.png"}',
        }),
        tool({ id: 'i2', tool: 'read_file', args: '{"path":"big.png"}' }),
      ],
      {
        onOpenFile,
        toolImages: {
          'i1\nmedia/l.png': { kind: 'loaded', dataUri: 'data:image/png;base64,iVBORw0K' },
          'i2\nbig.png': { kind: 'failed', reason: 'big.png is larger than 10485760 bytes' },
        },
      },
    )
    const picture = screen.getByRole('img', { name: 'The image media/l.png' })
    expect(picture.getAttribute('src')).toBe('data:image/png;base64,iVBORw0K')
    fireEvent.click(picture)
    expect(onOpenFile).toHaveBeenCalledWith('media/l.png', undefined)
    expect(
      screen.getByText('The image could not be shown: big.png is larger than 10485760 bytes'),
    ).toBeTruthy()
  })

  it('asks for nothing while the tool runs or when the path is not a picture', () => {
    const onReadImage = vi.fn()
    renderTranscript(
      [
        tool({ id: 'a', tool: 'read_file', args: '{"path":"dot.png"}', status: 'inProgress' }),
        tool({ id: 'b', tool: 'read_file', args: '{"path":"notes.md"}' }),
        tool({ id: 'c', tool: 'write_file', args: '{"path":"logo.png","content":"x"}' }),
      ],
      { onReadImage },
    )
    expect(onReadImage).not.toHaveBeenCalled()
  })

  it('shows the pictures a tool reported the model saw', () => {
    const onReadImage = vi.fn()
    renderTranscript(
      [tool({ id: 'm', tool: 'mcp__ide__screenshot', args: '{}', images: ['shot.png'] })],
      {
        onReadImage,
      },
    )
    expect(onReadImage).toHaveBeenCalledWith('m', 'shot.png')
  })
})
