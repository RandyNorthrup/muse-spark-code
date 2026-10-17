// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentChips } from '../../src/webview/components/AttachmentChips'
import { AttachmentSound } from '../../src/webview/components/AttachmentSound'
import AudioAttachmentActions from '../../src/webview/components/AudioAttachmentActions'
import { UI_TEXT } from '../../src/shared/constants'
import type { AttachmentSummary } from '../../src/shared/protocol'
import type { AudioRouteOptions } from '../../src/shared/audioRouting'
import { audioLabels } from './helpers/audioLabels'

const attachment: AttachmentSummary = {
  id: 'a',
  name: 'clip.mp4',
  mediaType: 'video/mp4',
  sizeBytes: 1000,
  media: {
    info: {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: 1000,
      durationSeconds: 10,
      hasSoundtrack: true,
    },
  },
}
const options: AudioRouteOptions = {
  actions: ['transcribe', 'useSoundtrackModel', 'sendWithoutSound'],
  labels: audioLabels,
  defaultAction: 'transcribe',
  soundtrackModelId: 'muse-spark-1.2',
  warning: '1.3 does not hear this video’s sound.',
}

describe('M105-A lazy chip sound controls', () => {
  it('shows the paid transcription price and selected default, and emits metadata-only choices', async () => {
    const onAction = vi.fn()
    const onRemove = vi.fn()
    await act(() => {
      render(
        <AttachmentChips
          attachments={[attachment]}
          onRemove={onRemove}
          renderAudio={(chip) => (
            <AttachmentSound attachment={chip} options={options} onAction={onAction} />
          )}
        />,
      )
      return Promise.resolve()
    })
    const transcribe = await screen.findByRole('button', {
      name: /Transcribe the sound.*paid.*\$0.18/,
    })
    expect(transcribe).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Use muse-spark-1.2 for this message' }))
    expect(onAction).toHaveBeenCalledWith('a', 'useSoundtrackModel')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.sendWithoutSound }))
    expect(onAction).toHaveBeenLastCalledWith('a', 'sendWithoutSound')
    fireEvent.click(screen.getByRole('button', { name: /Remove clip/ }))
    expect(onRemove).toHaveBeenCalledWith('a')
  })

  it('leaves existing chips unchanged when capability options are absent', () => {
    render(
      <AttachmentChips attachments={[{ ...attachment, media: undefined }]} onRemove={vi.fn()} />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByText(/Transcribe/)).not.toBeInTheDocument()
  })

  it('offers wrapping for audio only when the host provides that capability choice', () => {
    const onAction = vi.fn()
    const { rerender } = render(
      <AudioAttachmentActions
        options={{ actions: ['transcribe'], labels: audioLabels, defaultAction: 'transcribe' }}
        selected={undefined}
        onAction={onAction}
      />,
    )
    expect(screen.queryByRole('button', { name: /as a video/ })).not.toBeInTheDocument()
    rerender(
      <AudioAttachmentActions
        options={{
          actions: ['transcribe', 'wrapAsVideo'],
          labels: audioLabels,
          soundtrackModelId: 'muse-spark-1.2',
        }}
        selected="wrapAsVideo"
        onAction={onAction}
      />,
    )
    const wrap = screen.getByRole('button', { name: 'Send to muse-spark-1.2 as a video' })
    expect(wrap).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(wrap)
    expect(onAction).toHaveBeenCalledWith('wrapAsVideo')
  })

  it('renders a refusal without actionable buttons when capabilities permit nothing', () => {
    if (attachment.media === undefined) throw new Error('Expected media fixture')
    render(
      <AttachmentChips
        attachments={[attachment]}
        onRemove={vi.fn()}
        renderAudio={(chip) => (
          <AttachmentSound
            attachment={chip}
            options={{ actions: [], labels: audioLabels, warning: UI_TEXT.media.museCodeRefusal }}
            onAction={vi.fn()}
          />
        )}
      />,
    )
    expect(screen.getByRole('note')).toHaveTextContent(UI_TEXT.media.museCodeRefusal)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
