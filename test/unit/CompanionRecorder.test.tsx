// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionRecorder } from '../../src/webview/media/recorder/CompanionRecorder'
import type {
  BrowserRecordingPort,
  BrowserRecordingState,
} from '../../src/webview/media/recorder/browserRecorder'
import { UI_TEXT } from '../../src/shared/constants'

const harness = vi.hoisted(() => ({
  changed: (_state: BrowserRecordingState): void => {
    throw new Error('controller not constructed')
  },
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(),
  discard: vi.fn(),
  attach: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../src/webview/media/recorder/browserRecorder', () => ({
  BrowserRecordingController: class {
    public readonly start = harness.start
    public readonly stop = harness.stop
    public readonly discard = harness.discard
    public readonly attach = harness.attach
    public constructor(
      _port: BrowserRecordingPort,
      changed: (state: BrowserRecordingState) => void,
    ) {
      harness.changed = changed
    }
  },
}))
const PORT: BrowserRecordingPort = {
  browser: 'Test Browser',
  supportsMp4: () => false,
  capture: () => Promise.reject(new Error('no capture in UI-only tests')),
  objectUrl: () => {
    throw new Error('no URL in UI-only tests')
  },
  revokeUrl: vi.fn(),
  attach: vi.fn(() => Promise.resolve()),
}
function expectAudioOff() {
  for (const name of [UI_TEXT.media.recordingMicrophone, UI_TEXT.media.recordingSystemAudio])
    expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('companion recorder surface', () => {
  it('starts only from the user button and leaves both audio boxes unchecked', () => {
    render(<CompanionRecorder port={PORT} />)
    expectAudioOff()
    expect(harness.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    expect(harness.start).toHaveBeenCalledWith(
      { maxSeconds: 120, microphone: false, systemAudio: false },
      false,
    )
  })
  it('forwards per-recording audio choices and the configured maximum', () => {
    render(<CompanionRecorder port={PORT} maxSeconds={30} />)
    fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.media.recordingMicrophone }))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
    expect(harness.start).toHaveBeenCalledWith(
      { maxSeconds: 30, microphone: true, systemAudio: false },
      false,
    )
  })
  it('shows a live countdown, disables sound changes, and gives Stop and Discard', () => {
    render(<CompanionRecorder port={PORT} />)
    act(() => {
      harness.changed({ status: 'recording', remaining: 9 })
    })
    expect(screen.getByRole('status')).toHaveTextContent('Recording: 9s remaining')
    expect(screen.getByRole('checkbox', { name: UI_TEXT.media.recordingMicrophone })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: UI_TEXT.media.recordingStart }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStop }))
    expect(harness.stop).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingDiscard }))
    expect(harness.discard).toHaveBeenCalled()
  })
  it.each(['discard', 'attach', 'error', 'pagehide'])(
    'requires fresh audio opt-ins after %s',
    (exit) => {
      render(<CompanionRecorder port={PORT} />)
      fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.media.recordingMicrophone }))
      fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.media.recordingSystemAudio }))
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
      expect(harness.start).toHaveBeenLastCalledWith(
        { maxSeconds: 120, microphone: true, systemAudio: true },
        false,
      )
      act(() => {
        harness.changed({ status: 'preview', url: 'blob:private' })
      })
      if (exit === 'discard' || exit === 'attach')
        fireEvent.click(
          screen.getByRole('button', {
            name:
              exit === 'discard' ? UI_TEXT.media.recordingDiscard : UI_TEXT.media.recordingAttach,
          }),
        )
      else if (exit === 'pagehide') fireEvent(window, new Event('pagehide'))
      act(() => {
        harness.changed(
          exit === 'error' ? { status: 'error', reason: 'capture failed' } : { status: 'idle' },
        )
      })
      expectAudioOff()
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingStart }))
      expect(harness.start).toHaveBeenLastCalledWith(
        { maxSeconds: 120, microphone: false, systemAudio: false },
        false,
      )
    },
  )
  it('offers play, Attach and Discard only after preview', () => {
    render(<CompanionRecorder port={PORT} />)
    act(() => {
      harness.changed({ status: 'preview', url: 'blob:private' })
    })
    expect(screen.getByLabelText(UI_TEXT.media.recordingPreview)).toHaveAttribute('controls')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingAttach }))
    expect(harness.attach).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingDiscard }))
    expect(harness.discard).toHaveBeenCalled()
  })
  it('allows cancelling the permission picker and cancels on pagehide and unmount', () => {
    const view = render(<CompanionRecorder port={PORT} />)
    act(() => {
      harness.changed({ status: 'requesting' })
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.media.recordingDiscard }))
    fireEvent(window, new Event('pagehide'))
    view.unmount()
    expect(harness.discard).toHaveBeenCalledTimes(3)
  })
  it('clears unused audio opt-ins when the page closes before Start', () => {
    render(<CompanionRecorder port={PORT} />)
    fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.media.recordingMicrophone }))
    fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.media.recordingSystemAudio }))
    fireEvent(window, new Event('pagehide'))
    expectAudioOff()
  })
  it('shows the localized error as an alert', () => {
    render(<CompanionRecorder port={PORT} />)
    act(() => {
      harness.changed({ status: 'error', reason: UI_TEXT.media.recordingPermissionDenied })
    })
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.media.recordingPermissionDenied)
  })
})
