// @vitest-environment jsdom
// M88 lane A: the sequence dialog, start confirmation and run row as the
// person works them: listed, edited with steps, confirmed with the
// conversation and its mode, and stopped mid-run.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { SavedSequence, SequenceRunView } from '../../src/shared/sequences'
import { SequenceRunRow } from '../../src/webview/prompts/SequenceRunRow'
import {
  SequencesDialog,
  type SequencesDialogProps,
  type SequencesPort,
} from '../../src/webview/prompts/SequencesDialog'

function sequence(overrides: Partial<SavedSequence> = {}): SavedSequence {
  return {
    schemaVersion: 1,
    id: 'seq-1',
    name: 'Morning review',
    steps: ['First', 'Second'],
    scope: 'user',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  }
}

function dialogProps(overrides: Partial<SequencesDialogProps> = {}): {
  readonly props: SequencesDialogProps
  readonly calls: {
    readonly saved: SavedSequence[]
    readonly removed: SavedSequence[]
    readonly started: SavedSequence[]
    closed: number
  }
} {
  const calls = { saved: [], removed: [], started: [], closed: 0 } as unknown as {
    readonly saved: SavedSequence[]
    readonly removed: SavedSequence[]
    readonly started: SavedSequence[]
    closed: number
  }
  const port: SequencesPort = {
    save: (row) => void calls.saved.push(row),
    remove: (row) => void calls.removed.push(row),
    start: (row) => void calls.started.push(row),
  }
  return {
    props: {
      sequences: [sequence()],
      hasWorkspace: true,
      conversationTitle: 'Parser fix',
      permissionMode: 'manual',
      backend: 'modelApi',
      port,
      onClose: () => {
        calls.closed += 1
      },
      ...overrides,
    },
    calls,
  }
}

describe('sequences dialog', () => {
  it('lists the library with scope and step counts', () => {
    const { props } = dialogProps({
      sequences: [
        sequence(),
        sequence({ id: 'seq-2', name: 'Solo', steps: ['Only'], scope: 'workspace' }),
      ],
    })
    render(<SequencesDialog {...props} />)
    expect(screen.getByRole('heading', { name: 'Morning review' })).toBeDefined()
    expect(screen.getByText(/2 steps/)).toBeDefined()
    expect(screen.getByText(/1 step/)).toBeDefined()
    expect(screen.getByText(UI_TEXT.promptScopeWorkspace, { exact: false })).toBeDefined()
  })

  it('says empty with no sequences', () => {
    const { props } = dialogProps({ sequences: [] })
    render(<SequencesDialog {...props} />)
    expect(screen.getByText(UI_TEXT.sequenceEmpty)).toBeDefined()
  })

  it('saves a new sequence with its steps', () => {
    const { props, calls } = dialogProps({ sequences: [] })
    render(<SequencesDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceNew }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.promptTitle), {
      target: { value: 'Evening review' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceAddStep }))
    const areas = screen.getAllByRole('textbox')
    fireEvent.change(areas[1]!, { target: { value: 'First' } })
    fireEvent.change(areas[2]!, { target: { value: 'Second' } })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceSave }))
    expect(calls.saved).toHaveLength(1)
    expect(calls.saved[0]).toMatchObject({
      name: 'Evening review',
      steps: ['First', 'Second'],
      scope: 'user',
    })
    expect(calls.saved[0]!.id).not.toBe('')
  })

  it('edits and deletes through their confirmations', () => {
    const { props, calls } = dialogProps()
    render(<SequencesDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceEdit }))
    const areas = screen.getAllByRole('textbox')
    fireEvent.change(areas[1]!, { target: { value: 'First, revised' } })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceSave }))
    expect(calls.saved[0]).toMatchObject({ id: 'seq-1', steps: ['First, revised', 'Second'] })

    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceDelete }))
    expect(screen.getByText(UI_TEXT.sequenceDeleteConfirm, { exact: false })).toBeDefined()
    // The confirmation renders above the list: its Delete comes first.
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.sequenceDelete })[0]!)
    expect(calls.removed.map((row) => row.id)).toEqual(['seq-1'])
  })

  it('confirms the run with the steps, the conversation and its mode', () => {
    const { props, calls } = dialogProps({ permissionMode: 'auto' })
    render(<SequencesDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceRun }))
    expect(screen.getByRole('heading', { name: 'Run “Morning review”?' })).toBeDefined()
    expect(screen.getByText('Parser fix')).toBeDefined()
    expect(screen.getByText(UI_TEXT.sequenceStartBilled)).toBeDefined()
    expect(screen.getByRole('note')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.sequenceRun })[0]!)
    expect(calls.started.map((row) => row.id)).toEqual(['seq-1'])
  })

  it('hides the billing note and the mode warning where neither applies', () => {
    const { props } = dialogProps({ permissionMode: 'manual', backend: 'museCode' })
    render(<SequencesDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceRun }))
    expect(screen.queryByText(UI_TEXT.sequenceStartBilled)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('closes through the dialog button', () => {
    const { props, calls } = dialogProps()
    render(<SequencesDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.usageClose }))
    expect(calls.closed).toBe(1)
  })
})

describe('sequence run row', () => {
  it('names the sequence and its step, with Stop', () => {
    const run: SequenceRunView = {
      sequenceId: 'seq-1',
      scope: 'user',
      name: 'Morning review',
      step: 2,
      total: 4,
    }
    let stops = 0
    render(<SequenceRunRow run={run} onStop={() => void (stops += 1)} />)
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Sequence “Morning review”: step 2 of 4')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sequenceStop }))
    expect(stops).toBe(1)
  })
})
