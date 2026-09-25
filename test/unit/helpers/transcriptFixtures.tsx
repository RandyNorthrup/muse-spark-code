// A tool row entry and the transcript's props, for the tests that render the
// conversation (Transcript, the tool rows of M43).
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { Transcript, type TranscriptProps } from '../../../src/webview/components/Transcript'
import type { TranscriptEntry } from '../../../src/webview/state/uiState'

export function tool(overrides: Partial<Extract<TranscriptEntry, { kind: 'tool' }>>) {
  return {
    kind: 'tool' as const,
    id: 't',
    tool: 'read_file',
    args: '{"path":"a.ts"}',
    status: 'completed',
    output: '',
    failureReason: undefined,
    patchSummary: undefined,
    patchRef: undefined,
    outputRef: undefined,
    isBackground: false,
    backgroundInitiator: undefined,
    approval: undefined,
    approvalOutcome: undefined,
    question: undefined,
    questionOutcome: undefined,
    completedSeq: undefined,
    ...overrides,
  }
}

export function transcriptProps(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps>,
): TranscriptProps {
  return {
    entries,
    isRunning: false,
    isFocusView: false,
    outputPages: {},
    toolImages: {},
    onReadImage: vi.fn(),
    onOpenLink: vi.fn(),
    onCopy: vi.fn(),
    onInsert: vi.fn(),
    onReadOutput: vi.fn(),
    onOpenOutput: vi.fn(),
    onDecide: vi.fn(),
    onAnswer: vi.fn(),
    onCancelQuestion: vi.fn(),
    onApply: vi.fn(),
    onOpenEditDiff: vi.fn(),
    onOpenFile: vi.fn(),
    ...overrides,
  }
}

export function renderTranscript(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps> = {},
) {
  const props = transcriptProps(entries, overrides)
  render(<Transcript {...props} />)
  return props
}

/** A transcript that can be rendered again with changed props, as the app does. */
export function mountTranscript(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps> = {},
) {
  const props = transcriptProps(entries, overrides)
  const view = render(<Transcript {...props} />)
  return {
    props,
    rerender: (changes: Partial<TranscriptProps>) => {
      view.rerender(<Transcript {...props} {...changes} />)
    },
  }
}
