// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { trafficMessageSchema } from '../../src/shared/modelsPanel'
import { createTrafficView } from '../../src/webview/components/traffic/TrafficView'
import { RunnersSection } from '../../src/webview/models/sections/runners/RunnersSection'
import { trafficFixture, runnersFixture } from './helpers/trafficFixtures'

const loadSurface = vi.fn(
  async () => await import('../../src/webview/components/traffic/TrafficSurface'),
)

const TrafficView = createTrafficView(loadSurface)

afterEach(() => {
  cleanup()
  setUiText(EN, 'en')
})
async function view() {
  const state = trafficFixture()
  const postMessage = vi.fn((message: unknown) => {
    trafficMessageSchema.parse(message)
  })
  const result = render(<TrafficView mode="team" state={state} postMessage={postMessage} />)
  await screen.findByRole('tab', { name: UI_TEXT.teamTraffic.board })
  return { ...result, state, postMessage }
}
function select(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

describe('Traffic accessibility and controls', () => {
  it('renders nothing and sends nothing in single-model mode', () => {
    loadSurface.mockClear()
    const SingleModelView = createTrafficView(loadSurface)
    const { container } = render(<SingleModelView mode="singleModel" />)
    expect(container).toBeEmptyDOMElement()
    expect(loadSurface).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('ranks ready tasks by scheduler order, explains scores and sends current attempts with every board action', async () => {
    const { postMessage } = await view()
    const panel = screen.getByRole('tabpanel')
    const tasks = within(panel).getAllByRole('listitem')
    expect(tasks[0]).toHaveAccessibleName('engineering, ready-two, Ready')
    expect(
      within(tasks[0] ?? panel).getByText('Priority 4 × critical path 2 × fit 1 = 8'),
    ).toBeVisible()
    fireEvent.click(
      within(tasks[0] ?? panel).getByRole('button', { name: UI_TEXT.teamTraffic.runNext }),
    )
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'traffic/task',
      workspaceId: 'workspace',
      windowInstanceId: 'window',
      taskId: 'ready-two',
      attempt: 0,
      action: 'runNext',
    })
    const first = tasks[1] ?? panel
    fireEvent.change(within(first).getByLabelText(UI_TEXT.teamTraffic.priority), {
      target: { value: 'urgent' },
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'priority', priority: 'urgent' }),
    )
    fireEvent.change(within(first).getByLabelText(UI_TEXT.teamTraffic.reassign), {
      target: { value: 'other-entry' },
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'reassign', entryId: 'other-entry' }),
    )
    expect(screen.queryByRole('option', { name: 'docs model' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: UI_TEXT.teamTraffic.handOffAnyway }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.teamTrafficNotices.uncertainAttempt)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamTraffic.resumeQueue }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'traffic/queue', action: 'resume' }),
    )
  })
  it('withholds board controls when the available actions belong to a stale attempt', async () => {
    const { state, postMessage, rerender } = await view()
    rerender(
      <TrafficView
        mode="team"
        state={{
          ...state,
          taskActions: state.taskActions.map((row) => ({ ...row, attempt: row.attempt + 1 })),
        }}
        postMessage={postMessage}
      />,
    )
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.queryByRole('button')).not.toBeInTheDocument()
    expect(panel.queryByRole('combobox')).not.toBeInTheDocument()
    expect(postMessage).not.toHaveBeenCalled()
  })
  it('has one tab stop and supports arrows, Home and End with focus following selection', async () => {
    await view()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    const first = tabs[0]
    if (!first) throw new Error('tab missing')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const lanes = screen.getByRole('tab', { name: UI_TEXT.teamTraffic.lanes })
    expect(lanes).toHaveFocus()
    expect(lanes).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(lanes, { key: 'End' })
    const metrics = screen.getByRole('tab', { name: UI_TEXT.teamTraffic.metrics })
    expect(metrics).toHaveFocus()
    fireEvent.keyDown(metrics, { key: 'ArrowRight' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(metrics).toHaveFocus()
    fireEvent.keyDown(metrics, { key: 'Home' })
    expect(first).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', first.id)
    fireEvent.keyDown(first, { key: 'End' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(lanes).toHaveFocus()
    expect(lanes).toHaveAttribute('aria-selected', 'true')
  })
  it('announces only new landings or returned candidates once, never turns the Traffic view into a live region', async () => {
    const { state, postMessage, container, rerender } = await view()
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    const updated = {
      ...state,
      announcements: [{ id: 'one', kind: 'landed' as const, taskId: 'ready-one' }],
    }
    rerender(<TrafficView mode="team" state={updated} postMessage={postMessage} />)
    expect(status).toHaveTextContent('Merged: ready-one')
    status.textContent = ''
    rerender(
      <TrafficView mode="team" state={{ ...updated, hostBusy: true }} postMessage={postMessage} />,
    )
    expect(status).toBeEmptyDOMElement()
    rerender(
      <TrafficView
        mode="team"
        state={{
          ...updated,
          announcements: [
            ...updated.announcements,
            { id: 'two', kind: 'candidateReturned', taskId: 'ready-two' },
          ],
        }}
        postMessage={postMessage}
      />,
    )
    expect(status).toHaveTextContent('Candidate sent back: ready-two')
    const announce = vi.fn()
    rerender(
      <TrafficView mode="team" state={updated} postMessage={postMessage} announce={announce} />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('skips announcement history on mount and uses the existing panel announcer for new events', async () => {
    const announce = vi.fn()
    const state = {
      ...trafficFixture(),
      announcements: [{ id: 'history', kind: 'landed' as const, taskId: 'past' }],
    }
    const postMessage = vi.fn()
    const { container, rerender } = render(
      <TrafficView mode="team" state={state} postMessage={postMessage} announce={announce} />,
    )
    await screen.findByRole('tab', { name: UI_TEXT.teamTraffic.board })
    expect(announce).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-live]')).toBeNull()
    const updated = {
      ...state,
      announcements: [
        ...state.announcements,
        { id: 'new', kind: 'landed' as const, taskId: 'ready-one' },
      ],
    }
    rerender(
      <TrafficView mode="team" state={updated} postMessage={postMessage} announce={announce} />,
    )
    expect(announce).toHaveBeenCalledExactlyOnceWith('Merged: ready-one')
  })
  it('sums only fresh other-window hints and offers only opening a peer window', async () => {
    const { state, postMessage, rerender } = await view()
    const own = state.windows[0]
    if (!own) throw new Error('fixture window missing')
    rerender(
      <TrafficView
        mode="team"
        state={{
          ...state,
          windows: [
            ...state.windows,
            { ...own, windowInstanceId: state.board.windowInstanceId, workers: 100 },
          ],
        }}
        postMessage={postMessage}
      />,
    )
    select(UI_TEXT.teamTraffic.otherWindows)
    expect(screen.getByText('3 windows run 9 workers on this machine.')).toBeVisible()
    expect(screen.getByText(UI_TEXT.teamTrafficDetails.advisoryExceeded)).toBeVisible()
    expect(screen.getByText(UI_TEXT.teamTrafficDetails.staleHint)).toBeVisible()
    const buttons = within(screen.getByRole('tabpanel')).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    for (const button of buttons)
      expect(button).toHaveAccessibleName(UI_TEXT.teamTraffic.openWindow)
    fireEvent.click(buttons[0] ?? screen.getByRole('tabpanel'))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'traffic/window',
        otherWindowId: 'peer-one',
        action: 'openWindow',
      }),
    )
  })
  it('keeps recovery read-only for possibly live owners and offers no lock removal or locked recovery', async () => {
    const { postMessage } = await view()
    select(UI_TEXT.teamTraffic.recovery)
    const panel = screen.getByRole('tabpanel')
    expect(
      within(panel).queryByRole('button', { name: UI_TEXT.teamTrafficDetails.resume }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: UI_TEXT.teamTrafficDetails.discard }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: UI_TEXT.teamTraffic.recover }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.teamTrafficDetails.ownerMayBeLive)).toBeVisible()
    fireEvent.click(screen.getByLabelText(UI_TEXT.teamTraffic.includeEdits))
    fireEvent.click(within(panel).getByRole('button', { name: UI_TEXT.teamTraffic.newTask }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'newTask', includeEdits: true }),
    )
    fireEvent.click(within(panel).getByRole('button', { name: UI_TEXT.teamTraffic.stop }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ recoveryId: 'orphan', action: 'stop' }),
    )
  })
  it('shows lanes, leases, conflicts, serial merge reasons, flaky checks and safe disk cleanup', async () => {
    const { postMessage } = await view()
    select(UI_TEXT.teamTraffic.lanes)
    expect(screen.getAllByRole('meter')).toHaveLength(2)
    select(UI_TEXT.teamTraffic.leases)
    expect(screen.getByText(UI_TEXT.teamTraffic.exclusiveWriter)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamTraffic.takeBack }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'traffic/resource', action: 'takeBack' }),
    )
    select(UI_TEXT.teamTraffic.conflicts)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamTraffic.serialize }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'traffic/conflict', action: 'serialize' }),
    )
    select(UI_TEXT.teamTraffic.mergeQueue)
    expect(screen.getByText(UI_TEXT.teamTrafficDetails.serial)).toBeVisible()
    expect(screen.getByText(UI_TEXT.teamTraffic.flaky)).toBeVisible()
    expect(screen.getByText(/Queue position 1: dependency/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamTraffic.landWithoutChecks }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'traffic/merge', action: 'landWithoutChecks' }),
    )
    expect(screen.getAllByRole('button', { name: UI_TEXT.teamTraffic.cleanup })).toHaveLength(2)
  })
  it('reads the installed table at render time and shows reported and estimated metrics separately', async () => {
    setUiText({ ...EN, teamTraffic: { ...EN.teamTraffic, title: 'Verkehr' } }, 'de')
    await view()
    expect(screen.getByRole('heading', { name: 'Verkehr' })).toBeVisible()
    select(UI_TEXT.teamTraffic.metrics)
    expect(screen.getAllByText('50 %')).toHaveLength(3)
    expect(screen.getAllByText(/Cost per merged change · Reported/)).toHaveLength(3)
    expect(screen.getAllByText(/Cost per merged change · Estimated/)).toHaveLength(3)
    expect(
      screen.getAllByText(
        'Predicted conflicts per writing task: 0,5 · Merge conflicts per landing: 0',
      ),
    ).toHaveLength(3)
    expect(
      screen.getAllByText(
        'Review rounds after the first: 0,25 · Reassignments: 0,25 · Candidates sent back: 0,25',
      ),
    ).toHaveLength(3)
  })
})

describe('Runners section', () => {
  it('preserves an existing multiline setup command when saving untouched fields', () => {
    const state = runnersFixture()
    const runner = state.runners[0]
    if (!runner) throw new Error('runner fixture missing')
    const setupCommand = "  echo first\necho 'second line'  "
    const postMessage = vi.fn()
    render(
      <RunnersSection
        state={{ ...state, runners: [{ ...runner, setupCommand }] }}
        postMessage={postMessage}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.goalEdit }))
    expect(screen.getByLabelText(UI_TEXT.teamRunners.setupCommand)).toHaveValue(setupCommand)
    fireEvent.submit(screen.getByRole('form'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'runners/save',
      runner: { ...runner, setupCommand },
    })
  })
  it('shows health/fingerprint and input-hang instructions, disables remote tests when untrusted', () => {
    const state = runnersFixture()
    const postMessage = vi.fn()
    const { rerender } = render(<RunnersSection state={state} postMessage={postMessage} />)
    expect(screen.getByText(/SHA256:fixture-host/)).toBeVisible()
    expect(screen.getByText(UI_TEXT.teamRunners.inputHangNotice)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamRunners.test }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'runners/test', runnerId: 'macmini' })
    rerender(<RunnersSection state={{ ...state, trusted: false }} postMessage={postMessage} />)
    expect(screen.getByRole('button', { name: UI_TEXT.teamRunners.test })).toBeDisabled()
    expect(screen.getByRole('button', { name: UI_TEXT.teamRunners.testAll })).toBeDisabled()
  })
  it('edits a validated user runner and refuses credential variables before posting', () => {
    const postMessage = vi.fn()
    render(<RunnersSection state={runnersFixture()} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.goalEdit }))
    expect(screen.getByLabelText(UI_TEXT.teamTrafficDetails.runnerId)).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText(UI_TEXT.teamRunners.environmentNames), {
      target: { value: 'META_API_KEY' },
    })
    fireEvent.submit(screen.getByRole('form'))
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.teamTrafficDetails.runnerInvalid)
    expect(postMessage).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(UI_TEXT.teamRunners.environmentNames), {
      target: { value: 'CI, TEST_MODE' },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.teamRunners.port), { target: { value: '2222' } })
    fireEvent.submit(screen.getByRole('form'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'runners/save',
      runner: { ...runnersFixture().runners[0], port: 2222, environmentNames: ['CI', 'TEST_MODE'] },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamRunners.add }))
    expect(screen.getByLabelText(UI_TEXT.teamRunners.destination)).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.installCancelAction }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
})
