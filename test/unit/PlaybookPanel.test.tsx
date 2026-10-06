// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { PlaybookPanel } from '../../src/webview/playbook/PlaybookPanel'
import { PlaybookNoteRows, PlaybookStrikeBadge } from '../../src/webview/playbook/PlaybookRows'
import { createPlaybookBridge, playbookRequestSchema } from '../../src/webview/playbook/bridge'
import {
  surfacePort,
  surfacePriorityNotes,
  surfaceRound,
  surfaceSnapshot,
} from './playbookSurfaceFixtures'
import { playbookNoteText } from '../../src/runtime/playbook/text'
import { ToolRow } from '../../src/webview/components/ToolRow'
import { tool, transcriptProps } from './helpers/transcriptFixtures'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function offloadReasonInput() {
  fireEvent.click(
    screen.getByRole('checkbox', { name: new RegExp(UI_TEXT.playbookRules.offload, 'u') }),
  )
  return screen.getByRole('textbox', { name: UI_TEXT.playbookReasonLabel })
}

async function submitOffloadMaintenance(port: ReturnType<typeof surfacePort>) {
  const mounted = render(<PlaybookPanel port={port} />)
  await screen.findByText(/workspace-panel/u)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.playbookSettings }))
  const input = offloadReasonInput()
  fireEvent.change(input, { target: { value: 'maintenance' } })
  const form = input.closest('form')
  if (form === null) throw new Error('missing settings form')
  fireEvent.submit(form)
  return mounted
}

describe('M116 shared playbook surfaces', () => {
  it('renders the policy note in the tool transcript row through its lazy slot', async () => {
    const notes = surfaceSnapshot().records.flatMap((record) =>
      record.kind === 'note' ? [record.value] : [],
    )
    render(
      <ol>
        <ToolRow
          {...transcriptProps([], {})}
          entry={tool({})}
          patchPage={undefined}
          onRefuseLink={undefined}
          quoteMenu={null}
          playbookNotes={notes}
        />
      </ol>,
    )
    const note = await screen.findByText(UI_TEXT.playbookNotes.classifierBlocked)
    expect(note.closest('[data-role="tool"]')).toBeInTheDocument()
    expect(screen.getAllByRole('note')[0]).toHaveTextContent(
      UI_TEXT.playbookNotes.classifierBlocked,
    )
  })
  it('requires a reason before saving off and shows the persisted actor/time', async () => {
    const port = surfacePort()
    const change = vi.spyOn(port, 'change')
    render(<PlaybookPanel port={port} />)
    await screen.findByText(/workspace-panel/u)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.playbookSettings }))
    const switches = screen.getAllByRole('checkbox')
    expect(switches).toHaveLength(8)
    for (const control of switches) expect(control).toBeChecked()
    expect(screen.getByText(UI_TEXT.playbookSafetyAlwaysOn)).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: new RegExp(UI_TEXT.playbookRules.neverAround, 'u') }),
    ).not.toBeInTheDocument()
    const input = offloadReasonInput()
    fireEvent.change(input, { target: { value: ' '.repeat(3) } })
    const form = input.closest('form')
    if (form === null) throw new Error('missing settings form')
    fireEvent.submit(form)
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.playbookReasonRequired)
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'worker maintenance' } })
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByText(/worker maintenance/u, { selector: 'p' })).toHaveTextContent('owner')
    })
    expect(change).toHaveBeenCalledWith({
      rule: 'offload',
      enabled: false,
      reason: 'worker maintenance',
    })
    expect(port.snapshot().settings.rules.offload.enabled).toBe(false)
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
      '1',
      '2',
    ])
  })

  it('shows failed persistence loudly and leaves the last durable settings unchanged', async () => {
    const port = surfacePort()
    vi.spyOn(port, 'change').mockRejectedValue(new Error('private detail'))
    await submitOffloadMaintenance(port)
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.playbookUnavailable)
    expect(screen.queryByText(/private detail/u)).not.toBeInTheDocument()
    expect(port.snapshot().settings.rules.offload.enabled).toBe(true)
  })

  it('rejects a settings reply scoped to another team', async () => {
    const port = surfacePort()
    vi.spyOn(port, 'change').mockResolvedValue({
      ...surfaceSnapshot(),
      settings: { ...surfaceSnapshot().settings, teamId: 'another-team' },
    })
    await submitOffloadMaintenance(port)
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.playbookUnavailable)
    expect(screen.queryByText(/another-team/u)).not.toBeInTheDocument()
  })

  it('rejects malformed snapshots and ignores late reads after a workspace change', async () => {
    const delayed = Promise.withResolvers<unknown>()
    const first = { read: () => delayed.promise, change: () => delayed.promise }
    const { rerender } = render(<PlaybookPanel port={first} />)
    const second = surfacePort()
    rerender(<PlaybookPanel port={second} />)
    await screen.findByText(/workspace-panel/u)
    await act(async () => {
      delayed.resolve({
        ...surfaceSnapshot(),
        settings: { ...surfaceSnapshot().settings, teamId: 'wrong-team' },
      })
      await delayed.promise
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/wrong-team/u)).not.toBeInTheDocument()
    expect(screen.getByText(/workspace-panel/u)).toBeInTheDocument()
    const invalid = { read: () => Promise.resolve({}), change: () => Promise.resolve({}) }
    rerender(<PlaybookPanel port={invalid} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.playbookUnavailable)
  })

  it('ignores a late settings write after a workspace change', async () => {
    const saving = Promise.withResolvers<unknown>()
    const first = surfacePort()
    vi.spyOn(first, 'change').mockImplementation(() => saving.promise)
    const { rerender } = await submitOffloadMaintenance(first)
    const snapshot = surfaceSnapshot()
    snapshot.settings.teamId = 'next-workspace'
    const second = surfacePort(snapshot)
    rerender(<PlaybookPanel port={second} />)
    await screen.findByText(/next-workspace/u)
    await act(async () => {
      saving.resolve(first.snapshot())
      await saving.promise
    })
    expect(screen.getByText(/next-workspace/u)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps notes and strike outcomes distinguishable as text without colour', () => {
    const snapshot = surfaceSnapshot()
    snapshot.records.push(surfaceRound(1))
    render(
      <>
        <PlaybookNoteRows
          notes={snapshot.records.flatMap((record) =>
            record.kind === 'note' ? [record.value] : [],
          )}
        />
        <PlaybookStrikeBadge records={snapshot.records} />
      </>,
    )
    const notes = screen.getAllByRole('note')
    expect(notes[0]).toHaveTextContent(UI_TEXT.playbookNotes.classifierBlocked)
    expect(notes[1]).toHaveTextContent('round 3')
    expect(
      screen.getByText(/Concurrency: 3 review rounds/u, { selector: 'span' }),
    ).toHaveTextContent('3 review rounds')
    expect(screen.getByText(/Redesign outcome/u)).toHaveTextContent(
      UI_TEXT.playbookResolutions.caught,
    )
    expect(screen.queryByText(/Structurally impossible/u)).not.toBeInTheDocument()
  })

  it('places transcript failure notes before informational progress', () => {
    const notes = surfacePriorityNotes()
    render(<PlaybookNoteRows notes={notes} />)
    expect(screen.getAllByRole('note').map((row) => row.textContent)).toEqual(
      [notes[2], notes[1], notes[0]].map((note) => {
        if (note === undefined) throw new Error('missing priority fixture')
        return playbookNoteText(note)
      }),
    )
  })
})

describe('shared playbook postMessage boundary', () => {
  it('requires a positive integer transport deadline', () => {
    for (const deadline of [0, -1, 1.5, NaN])
      expect(() => createPlaybookBridge(window, vi.fn(), deadline, 'workspace-panel')).toThrow()
  })

  it('requires a positive integer protocol correlation id', () => {
    for (const requestId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        playbookRequestSchema.safeParse({
          type: 'playbookRead',
          bridgeId: 'A'.repeat(22) + '==',
          workspaceId: 'workspace-panel',
          requestId,
        }).success,
      ).toBe(false)
  })

  it('scrubs a failed post and releases its pending request', async () => {
    vi.useFakeTimers()
    const bridge = createPlaybookBridge(
      window,
      () => {
        throw new Error('private transport detail')
      },
      1000,
      'workspace-panel',
    )
    await expect(bridge.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(vi.getTimerCount()).toBe(0)
    bridge.dispose()
  })

  it('validates and correlates replies, rejecting unavailable responses', async () => {
    const sent: unknown[] = []
    const bridge = createPlaybookBridge(
      window,
      (message) => {
        sent.push(message)
      },
      1000,
      'workspace-panel',
    )
    const reading = bridge.read()
    const first = playbookRequestSchema.parse(sent[0])
    expect(first).toEqual({
      type: 'playbookRead',
      bridgeId: expect.any(String),
      workspaceId: 'workspace-panel',
      requestId: 1,
    })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          ...first,
          type: 'playbookState',
          requestId: 2,
          snapshot: {
            ...surfaceSnapshot(),
            settings: { ...surfaceSnapshot().settings, teamId: 'wrong-team' },
          },
        },
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { ...first, type: 'playbookState', requestId: 1, snapshot: {}, extra: true },
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { ...first, type: 'playbookState', requestId: 1, snapshot: surfaceSnapshot() },
      }),
    )
    expect(await reading).toEqual(surfaceSnapshot())
    const changing = bridge.change({ rule: 'offload', enabled: false, reason: 'maintenance' })
    const rejected = expect(changing).rejects.toThrow(UI_TEXT.playbookUnavailable)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { ...first, type: 'playbookUnavailable', requestId: 2 },
      }),
    )
    await rejected
    expect(
      playbookRequestSchema.safeParse({
        type: 'playbookChange',
        bridgeId: first.bridgeId,
        workspaceId: first.workspaceId,
        requestId: 1,
        change: { rule: 'neverAround', enabled: false, reason: 'override' },
      }).success,
    ).toBe(false)
    bridge.dispose()
  })

  it('bounds missing answers and rejects pending requests on dispose', async () => {
    vi.useFakeTimers()
    const bridge = createPlaybookBridge(window, vi.fn(), 1000, 'workspace-panel')
    const reading = bridge.read()
    const rejected = expect(reading).rejects.toThrow(UI_TEXT.playbookUnavailable)
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    const pending = expect(bridge.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    bridge.dispose()
    await pending
    await expect(bridge.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops disposed bridge replies before a new workspace request can resolve', async () => {
    vi.useFakeTimers()
    const sent: unknown[] = []
    const post = (message: unknown) => {
      sent.push(message)
    }
    const old = createPlaybookBridge(window, post, 1000, 'old-workspace')
    const rejected = expect(old.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    const oldRequest = playbookRequestSchema.parse(sent[0])
    old.dispose()
    await rejected
    const next = createPlaybookBridge(window, post, 1000, 'new-workspace')
    const resolved = vi.fn()
    const readNext = async () => {
      resolved(await next.read())
    }
    const reading = readNext()
    const nextRequest = playbookRequestSchema.parse(sent[1])
    expect(nextRequest.bridgeId).not.toBe(oldRequest.bridgeId)
    const snapshot = surfaceSnapshot()
    snapshot.settings.teamId = 'old-workspace'
    for (const correlation of [
      oldRequest,
      { ...nextRequest, workspaceId: 'old-workspace' },
      { ...nextRequest, bridgeId: oldRequest.bridgeId },
    ]) {
      window.dispatchEvent(
        new MessageEvent('message', { data: { ...correlation, type: 'playbookState', snapshot } }),
      )
      await Promise.resolve()
      expect(resolved).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(1)
    }
    snapshot.settings.teamId = 'new-workspace'
    window.dispatchEvent(
      new MessageEvent('message', { data: { ...nextRequest, type: 'playbookState', snapshot } }),
    )
    await reading
    expect(resolved).toHaveBeenCalledWith(snapshot)
    next.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates simultaneous bridge instances even within the same workspace', async () => {
    const sent: unknown[] = []
    const post = (message: unknown) => {
      sent.push(message)
    }
    const first = createPlaybookBridge(window, post, 1000, 'workspace-panel')
    const second = createPlaybookBridge(window, post, 1000, 'workspace-panel')
    const firstRead = first.read()
    const resolved = vi.fn()
    const readSecond = async () => {
      resolved(await second.read())
    }
    const secondRead = readSecond()
    const request = playbookRequestSchema.parse(sent[0])
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { ...request, type: 'playbookState', snapshot: surfaceSnapshot() },
      }),
    )
    await firstRead
    expect(resolved).not.toHaveBeenCalled()
    const rejected = expect(secondRead).rejects.toThrow(UI_TEXT.playbookUnavailable)
    second.dispose()
    await rejected
    first.dispose()
  })
})
