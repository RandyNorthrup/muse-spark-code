// A tool row entry and the transcript's props, for the tests that render the
// conversation (Transcript, the tool rows of M43).
import { fireEvent, render } from '@testing-library/react'
import { vi } from 'vitest'
import { AgentMap, type AgentMapProps } from '../../../src/webview/components/AgentMap'
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
    elicitation: undefined,
    questionOutcome: undefined,
    completedSeq: undefined,
    ...overrides,
  }
}

/** The user's own `!` command's row (M46), as a completed `hello` by default. */
export function userShell(overrides: Partial<Extract<TranscriptEntry, { kind: 'userShell' }>>) {
  return {
    kind: 'userShell' as const,
    id: 'u',
    command: "Write-Output 'hello-m46'",
    status: 'completed',
    output: 'hello-m46\r\n',
    exitCode: 0,
    exitSignal: undefined,
    durationMs: 563,
    outputRef: undefined,
    failureReason: undefined,
    taskRequest: undefined,
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
    onAnswer: vi.fn(),
    onCancelQuestion: vi.fn(),
    onClarifyQuestion: vi.fn(),
    onAcceptElicitation: vi.fn(),
    onDeclineElicitation: vi.fn(),
    onCancelElicitation: vi.fn(),
    onMoveToBackground: vi.fn(),
    onStopTask: vi.fn(),
    canStopUserShell: false,
    onApply: vi.fn(),
    onOpenEditDiff: vi.fn(),
    onOpenFile: vi.fn(),
    showReplyUsage: false,
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

/** The Agent map's props with an empty map, for the tests that open it. */
export function agentMapProps(overrides: Partial<AgentMapProps> = {}): AgentMapProps {
  return {
    backend: 'museCode',
    title: 'Chrome control update',
    modelId: 'muse-spark-1.3',
    contextUsedTokens: undefined,
    agents: [],
    backgroundTasks: [],
    delegationMode: undefined,
    isDelegationEnabled: false,
    childTranscripts: {},
    selectedAgentId: undefined,
    onSelectAgent: vi.fn(),
    onReadChild: vi.fn(),
    onControl: vi.fn(),
    onMessage: vi.fn(),
    onStopTask: vi.fn(),
    onStopAllTasks: vi.fn(),
    onOpenMuseSettings: vi.fn(),
    onClose: vi.fn(),
    workflows: [],
    workflowTriggerMode: undefined,
    team: undefined,
    teamActions: undefined,
    ...overrides,
  }
}

export function renderAgentMap(overrides: Partial<AgentMapProps> = {}) {
  const props = agentMapProps(overrides)
  render(<AgentMap {...props} />)
  return props
}

/**
 * Opens every run of steps folded under its summary (M87, PLAN.md D66): two
 * or more finished steps fold by default, so a test about the rows
 * themselves opens them first, as the user would.
 */
export function openStepGroups(): void {
  for (const summary of document.querySelectorAll<HTMLButtonElement>(
    '.steps-toggle[aria-expanded="false"]',
  )) {
    fireEvent.click(summary)
  }
}

/** The transcript with every folded run of steps opened (M87). */
export function renderSteps(
  entries: readonly TranscriptEntry[],
  overrides: Partial<TranscriptProps> = {},
) {
  const props = renderTranscript(entries, overrides)
  openStepGroups()
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

/** Select a real DOM passage; return cleanup so tests cannot leak a selection. */
export function selectPassage(element: HTMLElement): () => void {
  const selection = globalThis.getSelection()
  if (selection === null) throw new Error('DOM selection unavailable')
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  return () => {
    selection.removeAllRanges()
  }
}
