/** @vitest-environment jsdom */
import { Suspense } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanionMedia } from '../../src/webview/media/entry'
import type {
  BrowserRecorderPort,
  BrowserRecordingPreview,
} from '../../src/webview/media/recordingPort'
import type { MediaUploadPort } from '../../src/webview/media/transport'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const revoke = vi.fn()
beforeEach(() => {
  Object.defineProperties(URL, {
    createObjectURL: {
      configurable: true,
      value: vi.fn(() => 'blob:preview'),
    },
    revokeObjectURL: { configurable: true, value: revoke },
  })
  revoke.mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function setup(maxBytes?: number) {
  const preview = Promise.withResolvers<BrowserRecordingPreview>()
  const stop = vi.fn()
  const cancel = vi.fn()
  const dispose = vi.fn()
  const record: BrowserRecorderPort = {
    available: vi.fn<BrowserRecorderPort['available']>(() => ({ ok: true })),
    start: vi.fn<BrowserRecorderPort['start']>((_options, countdown) => {
      countdown(10)
      return Promise.resolve({ stop, cancel, result: preview.promise })
    }),
  }
  const upload = vi.fn<MediaUploadPort['upload']>((file, name) =>
    Promise.resolve({
      requestId: 'request-1',
      uploadToken: 'opaque-token',
      name,
      info: {
        kind: 'video',
        mediaType: 'video/mp4',
        sizeBytes: file.size,
        durationSeconds: 10,
        hasSoundtrack: false,
      },
    }),
  )
  const attached = vi.fn()
  const view = render(
    <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
      <CompanionMedia
        attachmentEpoch={0}
        transport={{ upload }}
        recorder={record}
        onAttached={attached}
        {...(maxBytes === undefined ? {} : { maxBytes })}
      />
    </Suspense>,
  )
  const picker = await screen.findByLabelText(UI_TEXT.attachFile)
  const file = new File(['file-canary'], 'clip.mp4', { type: 'video/mp4' })
  function finish(type = 'video/mp4') {
    act(() => {
      preview.resolve({
        name: 'recording.mp4',
        blob: new Blob(['record-canary'], { type }),
        dispose,
      })
    })
  }
  return { record, preview, stop, cancel, dispose, upload, attached, picker, file, view, finish }
}

describe('lazy companion media UI', () => {
  it('picker passes the File directly to upload; attaching reports only token/metadata', async () => {
    const rig = await setup()
    fireEvent.change(rig.picker, { target: { files: [rig.file] } })
    await waitFor(() => {
      expect(rig.attached).toHaveBeenCalledOnce()
    })
    expect(rig.upload).toHaveBeenCalledWith(
      rig.file,
      'clip.mp4',
      false,
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(JSON.stringify(rig.attached.mock.calls)).not.toContain('file-canary')
    expect(rig.record.start).not.toHaveBeenCalled()
  })
  it.each(['drop', 'paste'])('%s uses the same HTTP path', async (event) => {
    const rig = await setup()
    const target = screen.getByRole('region', { name: UI_TEXT.attachmentsLabel })
    if (event === 'drop') fireEvent.drop(target, { dataTransfer: { files: [rig.file] } })
    else fireEvent.paste(target, { clipboardData: { files: [rig.file] } })
    await waitFor(() => {
      expect(rig.upload).toHaveBeenCalledOnce()
    })
  })
  it('refuses over-cap media before HTTP', async () => {
    const rig = await setup(1)
    fireEvent.change(rig.picker, { target: { files: [rig.file] } })
    expect(rig.upload).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('exceeds')
  })
  it.each([
    { name: 'Stop cancels upload and never attaches a late result', epoch: false },
    {
      name: 'a session epoch change cancels the old upload and refuses its late attachment',
      epoch: true,
    },
  ])('$name', async ({ epoch }) => {
    const rig = await setup()
    const response = Promise.withResolvers<Awaited<ReturnType<MediaUploadPort['upload']>>>()
    rig.upload.mockReturnValue(response.promise)
    fireEvent.change(rig.picker, { target: { files: [rig.file] } })
    if (epoch) {
      rig.view.rerender(
        <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
          <CompanionMedia
            attachmentEpoch={1}
            transport={{ upload: rig.upload }}
            recorder={rig.record}
            onAttached={rig.attached}
          />
        </Suspense>,
      )
    } else fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.uploadStop }))
    expect(rig.upload.mock.calls[0]?.[3]?.aborted).toBe(true)
    await act(async () => {
      response.resolve({
        requestId: 'late',
        uploadToken: 'late',
        name: 'clip.mp4',
        info: {
          kind: 'video',
          mediaType: 'video/mp4',
          sizeBytes: rig.file.size,
          durationSeconds: 1,
          hasSoundtrack: false,
        },
      })
      await response.promise
    })
    expect(rig.attached).not.toHaveBeenCalled()
  })
  it('starts only on user click with audio off, shows countdown and requires preview Attach', async () => {
    const rig = await setup()
    expect(rig.record.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    expect(rig.record.start).toHaveBeenCalledWith(
      { maxSeconds: 120, microphone: false, systemAudio: false },
      expect.any(Function),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Recording:')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_TEXT.media.recordingStop })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStop }))
    expect(rig.stop).toHaveBeenCalledOnce()
    rig.finish()
    await screen.findByLabelText(UI_TEXT.media.recordingPreview)
    expect(rig.upload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingAttach }))
    await waitFor(() => {
      expect(rig.attached).toHaveBeenCalledOnce()
    })
    expect(rig.upload.mock.calls[0]?.[2]).toBe(true)
    expect(rig.dispose).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })
  it('explicit microphone/system audio options reach the recorder', async () => {
    const rig = await setup()
    fireEvent.click(screen.getByLabelText(UI_TEXT.media.recordingMicrophone))
    fireEvent.click(screen.getByLabelText(UI_TEXT.media.recordingSystemAudio))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    expect(rig.record.start).toHaveBeenCalledWith(
      { maxSeconds: 120, microphone: true, systemAudio: true },
      expect.any(Function),
    )
    rig.finish()
    await screen.findByLabelText(UI_TEXT.media.recordingPreview)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingDiscard }))
    expect(rig.dispose).toHaveBeenCalledOnce()
    expect(rig.upload).not.toHaveBeenCalled()
    expect(screen.getByLabelText(UI_TEXT.media.recordingMicrophone)).not.toBeChecked()
    expect(screen.getByLabelText(UI_TEXT.media.recordingSystemAudio)).not.toBeChecked()
  })
  it('shows browser-specific refusal before capture', async () => {
    const rig = await setup()
    const reason = fill(UI_TEXT.media.recordingBrowserUnsupported, { browser: 'Test browser' })
    vi.mocked(rig.record.available).mockReturnValue({ ok: false, reason })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    expect(screen.getByRole('status')).toHaveTextContent(reason)
    expect(rig.record.start).not.toHaveBeenCalled()
  })
  it('accepts MP4 codec parameters in the recorder blob type', async () => {
    const rig = await setup()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    rig.finish('video/mp4;codecs=avc1.424028')
    await screen.findByLabelText(UI_TEXT.media.recordingPreview)
    expect(rig.dispose).not.toHaveBeenCalled()
    expect(rig.upload).not.toHaveBeenCalled()
  })
  it('disposes unsupported recording output and never uploads it', async () => {
    const rig = await setup()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    rig.finish('video/webm')
    await waitFor(() => {
      expect(rig.dispose).toHaveBeenCalledOnce()
    })
    expect(rig.upload).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(UI_TEXT.media.recordingPreview)).toBeNull()
  })
  it('unmount cancels capture and deletes a late preview', async () => {
    const rig = await setup()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_TEXT.media.recordingStop })).toBeEnabled()
    })
    rig.view.unmount()
    expect(rig.cancel).toHaveBeenCalledOnce()
    rig.finish()
    await waitFor(() => {
      expect(rig.dispose).toHaveBeenCalledOnce()
    })
    expect(rig.upload).not.toHaveBeenCalled()
  })
})
