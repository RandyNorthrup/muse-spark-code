// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import type { HostServices } from '../../src/shared/hostApi/methods'
import { Confirm } from '../../src/webview/fallbacks/Confirm'
import { Picker } from '../../src/webview/fallbacks/Picker'
import { Input } from '../../src/webview/fallbacks/Input'
import { Toasts } from '../../src/webview/fallbacks/Toasts'
import { StatusStrip } from '../../src/webview/fallbacks/StatusStrip'
import { SettingsPage } from '../../src/webview/fallbacks/SettingsPage'
import { Walkthrough } from '../../src/webview/fallbacks/Walkthrough'
import { DiffPage } from '../../src/webview/fallbacks/DiffPage'
import { TerminalOutput } from '../../src/webview/fallbacks/TerminalOutput'
import { ManagerPage } from '../../src/webview/fallbacks/ManagerPage'
import { createFallbackUi } from '../../src/webview/fallbacks/services'
import { panelBridgeRig, disposePanelRigs } from './helpers/panelBridgeRig'

afterEach(() => {
  cleanup()
  disposePanelRigs()
  vi.restoreAllMocks()
})
const hunk = {
  id: 'hunk',
  uri: 'file:///repo/a.ts',
  expectedVersion: 1,
  range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
  before: '<script>old()</script>',
  after: '<script>new()</script>',
}

describe.each(['vscode', 'native', 'companion'] as const)('%s shared fallbacks', (kind) => {
  it('Confirm returns the opaque choice id and Escape cancels', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {
      /* React warnings are asserted below. */
    })
    const result = vi.fn()
    render(
      <Confirm
        params={{
          title: 'Permission',
          message: 'Allow?',
          choices: [
            { id: 1, title: 'Allow once' },
            { id: '1', title: 'Deny' },
          ],
        }}
        onResult={result}
      />,
    )
    fireEvent.click(screen.getByText('Allow once'))
    expect(result).toHaveBeenCalledWith(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(result).toHaveBeenLastCalledWith(null)
    expect(errors).not.toHaveBeenCalled()
  })
  it('Picker filters and preserves multiple selected opaque ids', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {
      /* React warnings are asserted below. */
    })
    const result = vi.fn()
    render(
      <Picker
        params={{
          title: 'Pick',
          multiple: true,
          items: [
            { id: '2', title: 'Alpha' },
            { id: 2, title: 'Beta' },
          ],
        }}
        onResult={result}
      />,
    )
    fireEvent.click(screen.getByLabelText('Alpha'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Beta' } })
    fireEvent.click(screen.getByLabelText('Beta'))
    fireEvent.click(screen.getByText(UI_TEXT.fallbackContinue))
    expect(result).toHaveBeenCalledWith(['2', 2])
    expect(errors).not.toHaveBeenCalled()
  })
  it('Input submits an edited value by Enter and does not parse it as markup', () => {
    const result = vi.fn()
    render(<Input params={{ title: 'Name', prompt: 'Value', value: 'old' }} onResult={result} />)
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '<b>new</b>' } })
    fireEvent.submit(screen.getByLabelText('Value').closest('form') ?? document.body)
    expect(result).toHaveBeenCalledWith('<b>new</b>')
    expect(document.querySelector('b')).toBeNull()
  })
  it('Toasts announce errors and dismiss the requested notification', () => {
    const dismiss = vi.fn()
    render(
      <Toasts
        items={[{ id: 'notice', severity: 'error', message: 'Failure' }]}
        onDismiss={dismiss}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Failure')
    fireEvent.click(screen.getByRole('button'))
    expect(dismiss).toHaveBeenCalledWith('notice')
  })
  it('StatusStrip hides invisible entries, updates progress and invokes commands', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {
      /* React warnings are asserted below. */
    })
    const command = vi.fn()
    render(
      <StatusStrip
        items={[
          { id: 'hidden', text: 'Hidden', visible: false },
          { id: 1, text: 'Ready', visible: true, command: 'logs' },
          { id: '1', text: 'Second', visible: true },
        ]}
        progress={[
          { id: 1, title: 'Building', fraction: 1, done: false },
          { id: '1', title: 'Checking', fraction: 1, done: false },
        ]}
        onCommand={command}
      />,
    )
    expect(screen.queryByText('Hidden')).toBeNull()
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
    for (const progress of screen.getAllByRole('progressbar'))
      expect(progress).toHaveAttribute('value', '1')
    fireEvent.click(screen.getByText('Ready'))
    expect(command).toHaveBeenCalledWith('logs')
    expect(errors).not.toHaveBeenCalled()
  })
  it('SettingsPage waits for the real settings/update and keeps the saved value', async () => {
    const calls: unknown[] = []
    const services: HostServices = {
      async request(method, params) {
        calls.push({ method, params })
        await Promise.resolve()
        return parseMhpResult(method, { jsonrpc: '2.0', id: 1, result: null }).result
      },
      notify: vi.fn(),
    }
    render(
      <SettingsPage
        entries={[
          {
            key: 'museSpark.autosave',
            title: 'Autosave',
            description: 'Save edited files',
            value: false,
          },
        ]}
        scope="workspace"
        services={services}
      />,
    )
    fireEvent.click(screen.getByLabelText('Autosave'))
    fireEvent.click(screen.getByText(UI_TEXT.goalEditSave))
    await waitFor(() => {
      expect(screen.getByText(UI_TEXT.goalEditSave)).toBeDisabled()
    })
    expect(calls).toEqual([
      {
        method: 'settings/update',
        params: { key: 'museSpark.autosave', value: true, scope: 'workspace' },
      },
    ])
    expect(screen.getByLabelText('Autosave')).toBeChecked()
  })
  it('SettingsPage refuses a nonfinite number and reports a rejected update', async () => {
    const request = vi.fn(() => Promise.reject(new Error('refused')))
    render(
      <SettingsPage
        entries={[{ key: 'museSpark.limit', title: 'Limit', description: 'Maximum', value: 1 }]}
        scope="workspace"
        services={{ request, notify: vi.fn() }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '' } })
    expect(screen.getByText(UI_TEXT.goalEditSave)).toBeDisabled()
    expect(request).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '2' } })
    fireEvent.click(screen.getByText(UI_TEXT.goalEditSave))
    await screen.findByRole('alert')
    expect(request).toHaveBeenCalledExactlyOnceWith('settings/update', {
      key: 'museSpark.limit',
      value: 2,
      scope: 'workspace',
    })
  })
  it('Walkthrough runs an existing panel action through the selected bridge', async () => {
    const { bridge, posts } = panelBridgeRig(kind)
    render(
      <Walkthrough
        steps={[
          {
            id: 'settings',
            title: 'Configure',
            description: 'Choose preferences',
            actionTitle: 'Open preferences',
            action: { type: 'hostAction', action: 'openSettings' },
          },
        ]}
        post={(message) => {
          bridge.post(message)
        }}
      />,
    )
    fireEvent.click(screen.getByText('Open preferences'))
    await waitFor(() => {
      expect(JSON.stringify(posts)).toContain('openSettings')
    })
  })
  it('DiffPage escapes both versions and settles an accepted hunk once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {
      /* React warnings are asserted below. */
    })
    const decide = vi.fn(() => Promise.resolve())
    render(
      <DiffPage
        title="Review"
        hunks={[
          { ...hunk, id: 1 },
          { ...hunk, id: '1' },
        ]}
        onDecide={decide}
      />,
    )
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getAllByText(UI_TEXT.reviewAccept)[0] ?? document.body)
    await screen.findByText(UI_TEXT.reviewAccepted)
    expect(decide).toHaveBeenCalledExactlyOnceWith(1, 'accept')
    expect(screen.getAllByText(UI_TEXT.reviewAccept)).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
  })
  it('TerminalOutput displays untrusted output as text and stops a running command', () => {
    const stop = vi.fn()
    render(
      <TerminalOutput
        title="Check"
        output="<img src=x onerror=alert(1)>"
        isRunning
        onStop={stop}
      />,
    )
    expect(screen.getByLabelText(UI_TEXT.fallbackTerminal)).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    )
    expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByText(UI_TEXT.stopTitle))
    expect(stop).toHaveBeenCalledOnce()
  })
  it.each(['skills', 'mcp', 'hooks', 'memory', 'worktrees'] as const)(
    '%s manager executes a real row action and reports failure',
    async (manager) => {
      const action = vi.fn(() => Promise.reject(new Error('failed')))
      render(
        <ManagerPage
          kind={manager}
          entries={[
            {
              id: 'row',
              title: 'Entry',
              detail: 'Current configuration',
              actions: [{ id: 'edit', title: 'Edit', run: action }],
            },
          ]}
          actions={[]}
        />,
      )
      fireEvent.click(screen.getByText('Edit'))
      await screen.findByRole('alert')
      expect(action).toHaveBeenCalledOnce()
    },
  )
})

it('starts each consecutive input from its own value and rejects all disposed prompts', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const ui = createFallbackUi(container, vi.fn())
  try {
    const first = ui.request('ui/input', { title: 'First', prompt: 'Value', value: 'first' })
    const second = ui.request('ui/input', { title: 'Second', prompt: 'Value', value: 'second' })
    await screen.findByText('First')
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'edited' } })
    fireEvent.submit(screen.getByLabelText('Value').closest('form') ?? document.body)
    await expect(first).resolves.toBe('edited')
    await screen.findByText('Second')
    expect(screen.getByLabelText('Value')).toHaveValue('second')
    const third = ui.request('ui/input', { title: 'Third', prompt: 'Value' })
    const fourth = ui.request('ui/input', { title: 'Fourth', prompt: 'Value' })
    const rejected = [second, third, fourth].map((pending) =>
      expect(pending).rejects.toThrow('MHP_CANCELLED'),
    )
    ui.dispose()
    await Promise.all(rejected)
    await expect(
      ui.request('ui/notify', { severity: 'information', message: 'late' }),
    ).rejects.toThrow('MHP_UI_DISPOSED')
  } finally {
    container.remove()
  }
})

it('serializes prompts, supports cancellation, and restores opener focus', async () => {
  const opener = document.createElement('button')
  opener.textContent = 'Opener'
  opener.inert = false
  const container = document.createElement('div')
  document.body.append(opener, container)
  opener.focus()
  const ui = createFallbackUi(container, vi.fn())
  try {
    const first = ui.request('ui/confirm', {
      title: 'First',
      message: 'Confirm',
      choices: [{ id: 'yes', title: 'Yes' }],
    })
    const abort = new AbortController()
    const second = ui.request('ui/input', { title: 'Second', prompt: 'Value' }, abort.signal)
    const refused = expect(second).rejects.toThrow('MHP_CANCELLED')
    await screen.findByText('First')
    expect(opener.inert).toBe(true)
    expect(screen.queryByText('Second')).toBeNull()
    abort.abort()
    await refused
    fireEvent.click(screen.getByText('Yes'))
    await expect(first).resolves.toBe('yes')
    await waitFor(() => {
      expect(document.activeElement).toBe(opener)
    })
    expect(opener.inert).toBe(false)
    await expect(
      ui.request('ui/progress', { id: 'invalid', title: 'Bad', done: false, fraction: 2 }),
    ).rejects.toThrow()
  } finally {
    ui.dispose()
    container.remove()
    opener.remove()
  }
})
