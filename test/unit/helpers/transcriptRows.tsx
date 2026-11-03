// One Transcript render for the error-row suites: the entries under test
// with every uninvolved callback quiet, so no suite repeats the prop
// block. The options are the row presses each suite drives.
import { render } from '@testing-library/react'
import { Transcript, type TranscriptProps } from '../../../src/webview/components/Transcript'
import type {
  ErrorResumeOffer,
  TranscriptEntry,
} from '../../../src/webview/state/transcriptEntries'

export interface TranscriptRowOptions {
  readonly onRetryTurn?: TranscriptProps['onRetryTurn']
  readonly onStopRetry?: TranscriptProps['onStopRetry']
  readonly onResumeLater?: TranscriptProps['onResumeLater']
  readonly onContinueTurn?: TranscriptProps['onContinueTurn']
  readonly onOpenBudgetSetting?: TranscriptProps['onOpenBudgetSetting']
  readonly resendableTurnIds?: TranscriptProps['resendableTurnIds']
  readonly activeTurnId?: TranscriptProps['activeTurnId']
}

export function renderTranscriptRows(
  entries: readonly TranscriptEntry[],
  options?: TranscriptRowOptions,
): void {
  const noop = () => undefined
  render(
    <Transcript
      entries={entries}
      isRunning={false}
      isFocusView={false}
      outputPages={{}}
      toolImages={{}}
      onReadImage={noop}
      onOpenLink={noop}
      onCopy={noop}
      onInsert={undefined}
      onReadOutput={noop}
      onOpenOutput={noop}
      onAnswer={noop}
      onCancelQuestion={noop}
      onClarifyQuestion={noop}
      onAcceptElicitation={noop}
      onDeclineElicitation={noop}
      onCancelElicitation={noop}
      onMoveToBackground={noop}
      onStopTask={noop}
      canStopUserShell={false}
      onApply={undefined}
      onOpenEditDiff={noop}
      onOpenFile={noop}
      showReplyUsage={false}
      onRetryTurn={options?.onRetryTurn}
      onStopRetry={options?.onStopRetry}
      onResumeLater={options?.onResumeLater}
      onContinueTurn={options?.onContinueTurn}
      onOpenBudgetSetting={options?.onOpenBudgetSetting}
      resendableTurnIds={options?.resendableTurnIds}
      activeTurnId={options?.activeTurnId}
    />,
  )
}

/** A failed turn's error entry, carrying a resume offer when it has one. */
export function failedTurnWithResume(resume: ErrorResumeOffer | undefined): TranscriptEntry {
  return {
    kind: 'error',
    id: 'error:t1',
    text: 'broke',
    ...(resume !== undefined && { resume }),
  }
}
