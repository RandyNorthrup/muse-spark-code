// @vitest-environment jsdom
// M88 lane C (PLAN.md D67, item 15): a timed send's user card is marked
// "Sent on schedule" in the live transcript, so it never reads as sent
// by hand. A card the host did not mark stays unmarked.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { TranscriptEntry } from '../../src/webview/state/transcriptEntries'
import { Transcript } from '../../src/webview/components/Transcript'

function userCard(scheduled: boolean | undefined): TranscriptEntry {
  return {
    kind: 'user',
    id: 'run-1',
    seq: 1,
    text: 'Water the plants',
    status: 'sent',
    attachments: [],
    ...(scheduled !== undefined && { scheduled }),
  }
}

function renderRows(entries: readonly TranscriptEntry[]): void {
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
    />,
  )
}

describe('scheduled send mark', () => {
  it('marks a timed send’s card, and only a timed send’s card', () => {
    renderRows([userCard(true)])
    expect(screen.getByText(UI_TEXT.sentOnSchedule)).not.toBeNull()
  })

  it('leaves an unmarked card unmarked', () => {
    renderRows([userCard(undefined)])
    expect(screen.queryByText(UI_TEXT.sentOnSchedule)).toBeNull()
  })
})
