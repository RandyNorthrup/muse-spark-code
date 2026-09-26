// @vitest-environment jsdom
// The rows of M46 (PLAN.md D39): a running shell call's Move to background,
// a background task's Stop, and the user's own `!` commands. The arguments
// and results are the shapes Muse Code 1.3.0 sent on 2026-09-25
// (docs/certification/m46.md).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { Header } from '../../src/webview/components/Header'
import { renderTranscript, tool, userShell } from './helpers/transcriptFixtures'
import { SHELL_CALL_STARTED, SHELL_CALL_STOPPED } from './helpers/m46Capture'

/** The captured shell call, as a row. */
function shellCall(overrides: Parameters<typeof tool>[0] = {}) {
  return tool({
    id: SHELL_CALL_STARTED.item.itemId,
    tool: 'powershell',
    args: SHELL_CALL_STARTED.item.args,
    status: 'inProgress',
    ...overrides,
  })
}

describe('a running shell call (M46)', () => {
  it('offers Move to background, which asks the host once', () => {
    const onMoveToBackground = vi.fn()
    renderTranscript([shellCall()], { onMoveToBackground })
    const move = screen.getByRole('button', {
      name: 'Move to background: PowerShell Run delayed output command',
    })
    expect(move).toHaveAttribute('title', UI_TEXT.moveToBackgroundTitle)
    fireEvent.click(move)
    expect(onMoveToBackground).toHaveBeenCalledWith(SHELL_CALL_STARTED.item.itemId)
  })

  it('waits on a request already made', () => {
    renderTranscript([shellCall({ taskRequest: 'background' })])
    expect(screen.getByRole('button', { name: /^Move to background/ })).toBeDisabled()
  })

  it('offers nothing while its approval waits, once it ended, or for a tool that is no shell', () => {
    renderTranscript([
      shellCall({
        id: 'waiting',
        approval: {
          approvalId: 'a1',
          requirementId: { approvalId: 'a1', sourceIndex: 0 },
          subject: { kind: 'shell', command: 'npm test' },
          rawArgs: '{}',
          availableChoices: [],
          isProtectedWrite: false,
          isJudgeEscalated: false,
        },
      }),
      shellCall({ id: 'done', status: 'completed' }),
      tool({ id: 'read', status: 'inProgress' }),
    ])
    expect(screen.queryByRole('button', { name: /^Move to background/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull()
  })
})

describe('a background task (M46)', () => {
  it('says it runs in the background and offers Stop', () => {
    const onStopTask = vi.fn()
    renderTranscript([shellCall({ isBackground: true, backgroundInitiator: 'user' })], {
      onStopTask,
    })
    expect(screen.getByText('Running in the background')).toBeTruthy()
    const stop = screen.getByRole('button', {
      name: 'Stop: PowerShell Run delayed output command',
    })
    expect(stop).toHaveAttribute('title', UI_TEXT.stopTaskTitle)
    fireEvent.click(stop)
    expect(onStopTask).toHaveBeenCalledWith(SHELL_CALL_STARTED.item.itemId)
  })

  it('reads stopped once stopped, with the host’s reason', () => {
    renderTranscript([
      shellCall({
        isBackground: true,
        status: SHELL_CALL_STOPPED.item.status,
        failureReason: SHELL_CALL_STOPPED.item.failureReason,
        output: SHELL_CALL_STOPPED.item.visibleOutput,
      }),
    ])
    expect(screen.getByText('Stopped: cancelled by runtime client')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull()
    expect(screen.queryByText('Running in the background')).toBeNull()
  })
})

describe('the user’s own command (M46)', () => {
  it('shows what they ran, how it ended and what it printed, opened whole on click', () => {
    const onOpenOutput = vi.fn()
    renderTranscript([userShell({})], { onOpenOutput })
    const row = screen.getByText(UI_TEXT.userShellLabel).closest('li')
    if (row === null) {
      throw new Error('no row')
    }
    expect(within(row).getByText("!Write-Output 'hello-m46'")).toBeTruthy()
    expect(within(row).getByText('Exit code 0 · 1s')).toBeTruthy()
    fireEvent.click(within(row).getByText('hello-m46'))
    expect(onOpenOutput).toHaveBeenCalledWith(
      'u',
      UI_TEXT.userShellLabel,
      'hello-m46\r\n',
      undefined,
    )
    expect(row.querySelector('.tool-dot-ok')).not.toBeNull()
  })

  it('marks a failing one failed, and says a signal and a stop', () => {
    renderTranscript([
      userShell({ id: 'f', status: 'failed', exitCode: 3, output: 'failing-m46' }),
      userShell({
        id: 's',
        status: 'cancelled',
        exitCode: undefined,
        exitSignal: 9,
        durationMs: undefined,
        failureReason: 'stopped by the user',
        output: '',
      }),
    ])
    expect(screen.getByText('Exit code 3 · 1s')).toBeTruthy()
    expect(screen.getByText('Ended by signal 9')).toBeTruthy()
    expect(screen.getByText('Stopped: stopped by the user')).toBeTruthy()
  })

  it('offers Stop on a running one only where the backend can stop it', () => {
    const onStopTask = vi.fn()
    const running = userShell({ status: 'inProgress', exitCode: undefined, output: '' })
    renderTranscript([running], { onStopTask })
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull()
  })

  it('stops a running one on the Model API, and waits once asked', () => {
    const onStopTask = vi.fn()
    renderTranscript(
      [
        userShell({ id: 'a', status: 'inProgress', exitCode: undefined, output: '' }),
        userShell({
          id: 'b',
          command: 'sleep 30',
          status: 'inProgress',
          exitCode: undefined,
          output: '',
          taskRequest: 'stop',
        }),
      ],
      { onStopTask, canStopUserShell: true },
    )
    fireEvent.click(screen.getByRole('button', { name: "Stop: !Write-Output 'hello-m46'" }))
    expect(onStopTask).toHaveBeenCalledWith('a')
    expect(screen.getByRole('button', { name: 'Stop: !sleep 30' })).toBeDisabled()
  })
})

describe('the header pill (M46)', () => {
  it('shows running background tasks when no agent is there, and opens the map', () => {
    const onOpenAgents = vi.fn()
    render(
      <Header
        title="t"
        isFocusView={false}
        onNewConversation={vi.fn()}
        runningTaskCount={1}
        onOpenAgents={onOpenAgents}
      />,
    )
    const pill = screen.getByRole('button', { name: '1 background task' })
    expect(pill).toHaveAttribute('title', UI_TEXT.backgroundTasksPillTitle)
    fireEvent.click(pill)
    expect(onOpenAgents).toHaveBeenCalledOnce()
  })

  it('names agents and running tasks together', () => {
    render(
      <Header
        title="t"
        isFocusView={false}
        onNewConversation={vi.fn()}
        agentCount={2}
        runningTaskCount={3}
        onOpenAgents={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '2 agents · 3 background tasks' })).toHaveAttribute(
      'title',
      UI_TEXT.agentsPillTitle,
    )
  })
})
