// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeferredReportActionEditor } from '../../src/webview/schedules/DeferredReportActionEditor'
import {
  ReportActionEditor,
  type ScheduleDestinationPickerProps,
  type ScheduleReportKindChoice,
} from '../../src/webview/schedules/ReportActionEditor'
import { UI_TEXT } from '../../src/shared/constants'
import { type ScheduleDraft, type ScheduleReportAction } from '../../src/shared/scheduleV2'
import { fakeScheduleDraft } from './helpers/schedules/runtimeFixtures'

const report: ScheduleReportAction = {
  kind: 'report',
  reportKind: 'project',
  args: { scope: 'workspace', full: true, count: 2 },
  format: 'markdown',
  destinations: [{ id: 'browser', kind: 'browser', location: 'local', whenInactive: 'wait' }],
}
const kinds: ScheduleReportKindChoice[] = [
  {
    id: 'project',
    label: 'Project',
    capability: { available: true },
    arguments: [
      { key: 'scope', label: 'Scope', type: 'string' },
      { key: 'full', label: 'Full report', type: 'boolean' },
      { key: 'count', label: 'Count', type: 'number' },
    ],
  },
  { id: 'session', label: 'Session', capability: { available: true }, arguments: [] },
  {
    id: 'fleet',
    label: 'Fleet',
    capability: { available: false, reason: 'No node configured' },
    arguments: [],
  },
]
function Picker({ value, onChange }: ScheduleDestinationPickerProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onChange([
          {
            id: 'save',
            kind: 'save',
            rootId: 'approved',
            directory: '.',
            nameTemplate: '{kind}.{ext}',
            retention: 30,
          },
        ])
      }}
    >
      {value.map((item) => item.id).join(', ')}
    </button>
  )
}
function setup(isReport = false, isDeferred = false, choices = kinds) {
  const changed = vi.fn()
  const initial: ScheduleDraft = {
    ...fakeScheduleDraft(),
    action: isReport ? report : { kind: 'prompt', prompt: 'Read the build result' },
    grant: { rules: [], destinationIds: isReport ? ['browser'] : [], paidCapUsd: isReport ? 0 : 1 },
    paidCapUsd: isReport ? 0 : 1,
  }
  function App() {
    const [value, setValue] = useState(initial)
    const Field = isDeferred ? DeferredReportActionEditor : ReportActionEditor
    return (
      <Field
        value={value}
        initialReport={report}
        initialPrompt="Read the build result"
        kinds={choices}
        DestinationPicker={Picker}
        onChange={(next) => {
          changed(next)
          setValue(next)
        }}
      />
    )
  }
  return { changed, initial, ...render(<App />) }
}
describe('shared report action editor', () => {
  it('switches to Report with zero budget and clears destination consent without changing scheduler fields', () => {
    const f = setup()
    fireEvent.change(screen.getByLabelText(UI_TEXT.scheduleV2.labels.action), {
      target: { value: 'report' },
    })
    expect(f.changed).toHaveBeenLastCalledWith({
      ...f.initial,
      action: report,
      grant: { ...f.initial.grant, destinationIds: [], paidCapUsd: 0 },
      paidCapUsd: 0,
    })
    expect(screen.getByLabelText(UI_TEXT.scheduleV2.reportAction.kind)).toHaveValue('project')
    expect(
      screen.getByRole('group', { name: UI_TEXT.scheduleV2.reportAction.destinations }),
    ).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Fleet: No node configured' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(UI_TEXT.scheduleV2.labels.action), {
      target: { value: 'prompt' },
    })
    expect(screen.getByLabelText(UI_TEXT.scheduleV2.labels.prompt)).toHaveValue(
      'Read the build result',
    )
  })
  it('edits typed arguments, format and configured destinations and renews consent on every change', () => {
    const f = setup(true)
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'another-scope' } })
    fireEvent.click(screen.getByLabelText('Full report'))
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.scheduleV2.reportAction.format), {
      target: { value: 'json' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'browser' }))
    expect(f.changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: {
          ...report,
          args: { scope: 'another-scope', full: false, count: 5 },
          format: 'json',
          destinations: [
            {
              id: 'save',
              kind: 'save',
              rootId: 'approved',
              directory: '.',
              nameTemplate: '{kind}.{ext}',
              retention: 30,
            },
          ],
        },
      }),
    )
    for (const [draft] of f.changed.mock.calls) {
      expect(draft).toMatchObject({ grant: { destinationIds: [], paidCapUsd: 0 }, paidCapUsd: 0 })
    }
    fireEvent.change(screen.getByLabelText(UI_TEXT.scheduleV2.reportAction.kind), {
      target: { value: 'session' },
    })
    expect(f.changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ reportKind: 'session', args: {} }),
      }),
    )
  })
  it('shows unavailable kinds and never silently changes an unsupported stored report', () => {
    const f = setup(true, false, [
      { ...kinds[0]!, capability: { available: false, reason: 'No report source' } },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('No report source')
    fireEvent.change(screen.getByLabelText(UI_TEXT.scheduleV2.reportAction.kind), {
      target: { value: 'project' },
    })
    expect(f.changed).not.toHaveBeenCalled()
    f.unmount()
    setup(false, false, [])
    expect(screen.getByRole('option', { name: UI_TEXT.scheduleV2.labels.report })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      UI_TEXT.scheduleV2.reportAction.unavailable,
    )
  })
  it('waits for the lazy field to load and gives every control a label', async () => {
    setup(true, true)
    const selector = await screen.findByLabelText(UI_TEXT.scheduleV2.reportAction.kind)
    expect(selector).toHaveValue('project')
    for (const element of screen.getAllByRole('combobox')) expect(element).toHaveAccessibleName()
    for (const element of screen.getAllByRole('textbox')) expect(element).toHaveAccessibleName()
    expect(screen.getByRole('checkbox')).toHaveAccessibleName('Full report')
  })
})
