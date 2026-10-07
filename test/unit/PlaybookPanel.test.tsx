// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { PlaybookPanel } from '../../src/webview/playbook/PlaybookPanel'
import {
  PlaybookAgentDetails,
  PlaybookNoteRows,
  PlaybookStrikeBadge,
} from '../../src/webview/playbook/PlaybookRows'
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
  const toggle = screen.getByRole('checkbox', {
    name: new RegExp(UI_TEXT.playbookRules.offload, 'u'),
  })
  fireEvent.click(toggle)
  const form = toggle.closest('form')
  if (form === null) throw new Error('missing offload form')
  return within(form).getByRole('textbox', { name: UI_TEXT.playbookReasonLabel })
}

async function submitOffloadMaintenance(port: ReturnType<typeof surfacePort>) {
  const mounted = await openSettings(port)
  fireEvent.submit(offloadForm('maintenance'))
  return mounted
}

async function openSettings(port: ReturnType<typeof surfacePort>) {
  const mounted = render(<PlaybookPanel port={port} />)
  await screen.findByText(/workspace-panel/u)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.playbookSettings }))
  return mounted
}

function offloadForm(reason: string) {
  const input = offloadReasonInput()
  fireEvent.change(input, { target: { value: reason } })
  const form = input.closest('form')
  if (form === null) throw new Error('missing settings form')
  return form
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
    await openSettings(port)
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
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('restores the submitting control after a rule save and politely announces success', async () => {
    const port = surfacePort()
    const saving = Promise.withResolvers<undefined>()
    const persist = port.change
    const change = vi.spyOn(port, 'change').mockImplementation(async (patch) => {
      const next = await persist(patch)
      await saving.promise
      return next
    })
    await openSettings(port)
    const form = offloadForm('maintenance')
    const save = within(form).getByRole('button', { name: UI_TEXT.playbookSave })
    save.focus()
    fireEvent.submit(form)
    await waitFor(() => {
      expect(save).toBeDisabled()
    })
    // JSDOM keeps disabled controls focused; model the browser's native blur.
    save.blur()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    await act(async () => {
      saving.resolve(undefined)
      await saving.promise
    })
    await waitFor(() => {
      expect(
        within(
          screen.getByRole('form', { name: new RegExp(UI_TEXT.playbookRules.offload, 'u') }),
        ).getByRole('button'),
      ).toHaveFocus()
    })
    expect(save).not.toBeInTheDocument()
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toHaveTextContent(UI_TEXT.playbookSaved)
    const savedForm = screen.getByRole('form', {
      name: new RegExp(UI_TEXT.playbookRules.offload, 'u'),
    })
    fireEvent.submit(savedForm)
    expect(change).toHaveBeenCalledTimes(1)
  })

  it('saves the round limit as a field patch without discarding another rule draft or focus', async () => {
    const port = surfacePort()
    const change = vi.spyOn(port, 'change')
    await openSettings(port)
    const draft = offloadReasonInput()
    fireEvent.change(draft, { target: { value: 'unsaved maintenance' } })
    const limit = screen.getByRole('combobox', { name: UI_TEXT.playbookPatchRoundsLabel })
    fireEvent.change(limit, { target: { value: '1' } })
    const form = limit.closest('form')
    if (form === null) throw new Error('missing limit form')
    const save = within(form).getByRole('button')
    save.focus()
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.playbookSaved)
    })
    expect(change).toHaveBeenCalledWith({ patchRoundsMax: 1 })
    expect(port.snapshot().settings.rules.offload.enabled).toBe(true)
    expect(port.snapshot().settings.patchRoundsMax).toBe(1)
    expect(draft).toBeInTheDocument()
    expect(draft).toHaveValue('unsaved maintenance')
    expect(save).toHaveFocus()
    // A focusable, unchanged Save is announced unavailable and cannot write again.
    expect(save).toHaveAttribute('aria-disabled', 'true')
    fireEvent.submit(form)
    expect(change).toHaveBeenCalledTimes(1)
  })

  it('preserves an unrelated rule draft when another rule is saved', async () => {
    const port = surfacePort()
    await openSettings(port)
    const other = screen.getByRole('form', {
      name: new RegExp(UI_TEXT.playbookRules.smallFirst, 'u'),
    })
    fireEvent.click(within(other).getByRole('checkbox'))
    fireEvent.change(within(other).getByRole('textbox'), { target: { value: 'keep my draft' } })
    const form = offloadForm('maintenance')
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.playbookSaved)
    })
    expect(within(other).getByRole('textbox')).toHaveValue('keep my draft')
    expect(port.snapshot().settings.rules.smallFirst.enabled).toBe(true)
  })

  it('reconciles every changed server field after saving a rule without enabling stale writes', async () => {
    const port = surfacePort()
    await openSettings(port)
    const limit = screen.getByRole('combobox', { name: UI_TEXT.playbookPatchRoundsLabel })
    const limitForm = limit.closest('form')
    if (limitForm === null) throw new Error('missing limit form')
    const limitSave = within(limitForm).getByRole('button')
    expect(limit).toHaveValue('2')
    await port.change({ patchRoundsMax: 1 })
    await port.change({ rule: 'smallFirst', enabled: false, reason: 'concurrent maintenance' })
    const change = vi.spyOn(port, 'change')
    const form = offloadForm('maintenance')
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.playbookSaved)
    })
    expect(limit).toHaveValue('1')
    expect(limitSave).toHaveAttribute('aria-disabled', 'true')
    for (const { rule, reason } of [
      { rule: UI_TEXT.playbookRules.offload, reason: 'maintenance' },
      { rule: UI_TEXT.playbookRules.smallFirst, reason: 'concurrent maintenance' },
    ]) {
      const savedForm = screen.getByRole('form', { name: new RegExp(rule, 'u') })
      expect(within(savedForm).getByRole('checkbox')).not.toBeChecked()
      expect(within(savedForm).getByRole('textbox')).toHaveValue(reason)
      expect(within(savedForm).getByRole('button')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.submit(savedForm)
    }
    fireEvent.click(limitSave)
    fireEvent.submit(limitForm)
    expect(change).toHaveBeenCalledExactlyOnceWith({
      rule: 'offload',
      enabled: false,
      reason: 'maintenance',
    })
    expect(port.snapshot().settings.patchRoundsMax).toBe(1)
  })

  it('preserves an edited round-limit draft when a rule save leaves its server value unchanged', async () => {
    const port = surfacePort()
    const change = vi.spyOn(port, 'change')
    await openSettings(port)
    const limit = screen.getByRole('combobox', { name: UI_TEXT.playbookPatchRoundsLabel })
    const form = limit.closest('form')
    if (form === null) throw new Error('missing limit form')
    fireEvent.change(limit, { target: { value: '1' } })
    fireEvent.submit(offloadForm('maintenance'))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.playbookSaved)
    })
    expect(port.snapshot().settings.patchRoundsMax).toBe(2)
    expect(limit).toHaveValue('1')
    const save = within(form).getByRole('button')
    expect(save).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(save)
    await waitFor(() => {
      expect(port.snapshot().settings.patchRoundsMax).toBe(1)
      expect(save).toHaveAttribute('aria-disabled', 'true')
    })
    expect(change).toHaveBeenLastCalledWith({ patchRoundsMax: 1 })
    expect(change).toHaveBeenCalledTimes(2)
  })

  it('focuses the saved rule heading if the submitting control disappears', async () => {
    const snapshot = surfaceSnapshot()
    snapshot.settings.rules.offload = {
      enabled: false,
      reason: 'maintenance',
      actor: 'owner',
      at: 0,
    }
    const port = surfacePort(snapshot)
    vi.spyOn(port, 'change').mockResolvedValue(surfaceSnapshot())
    await openSettings(port)
    const form = screen.getByRole('form', { name: new RegExp(UI_TEXT.playbookRules.offload, 'u') })
    const reason = within(form).getByRole('textbox')
    fireEvent.change(reason, { target: { value: 'updated maintenance' } })
    reason.focus()
    fireEvent.submit(form)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: new RegExp(UI_TEXT.playbookRules.offload, 'u') }),
      ).toHaveFocus()
    })
    expect(reason).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.playbookSaved)
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

  it.each(['pending', 'caught', 'remains'] as const)(
    'orders combined agent details ahead of statistics for %s redesigns',
    (outcome) => {
      const snapshot = surfaceSnapshot()
      for (const record of snapshot.records)
        if (record.kind === 'design') record.value.outcome = outcome
      snapshot.records.push(
        ...surfacePriorityNotes().map((value) => ({ kind: 'note' as const, value })),
      )
      const { container } = render(<PlaybookAgentDetails records={snapshot.records} />)
      const combined = [...container.querySelectorAll('.playbook-note, .playbook-badge')]
      const owner = combined.findIndex((item) =>
        item.textContent.includes(UI_TEXT.playbookNotes.classifierBlocked),
      )
      const design = combined.findIndex((item) =>
        item.textContent.includes(UI_TEXT.playbookOutcomeLabel),
      )
      const warning = combined.findIndex((item) => item.textContent.includes('round 3'))
      const statistic = combined.findIndex((item) => item.textContent.includes('review rounds'))
      const progress = combined.findIndex((item) =>
        item.textContent.includes(UI_TEXT.playbookNotes.checksPassed),
      )
      for (const index of [owner, design, warning, statistic, progress])
        expect(index).toBeGreaterThanOrEqual(0)
      expect(owner).toBeLessThan(warning)
      expect(design).toBeLessThan(warning)
      expect(warning).toBeLessThan(statistic)
      expect(warning).toBeLessThan(progress)
    },
  )

  it.each(['pending', 'caught', 'remains'] as const)(
    'places unresolved %s redesign badges before statistics',
    (outcome) => {
      const snapshot = surfaceSnapshot()
      for (const record of snapshot.records)
        if (record.kind === 'design') record.value.outcome = outcome
      const { container } = render(<PlaybookStrikeBadge records={snapshot.records} />)
      const badges = container.querySelectorAll('.playbook-badge')
      expect(badges[0]).toHaveTextContent(UI_TEXT.playbookOutcomeLabel)
      expect(badges[1]).toHaveTextContent('review rounds')
    },
  )
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
