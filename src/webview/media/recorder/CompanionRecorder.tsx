import { useEffect, useState } from 'react'
import './recorder.css'
import { SCREEN_RECORDING_DEFAULT_MAX_SECONDS, UI_TEXT } from '../../../shared/constants'
import { fill, formatUnit } from '../../../shared/l10n/text'
import {
  BrowserRecordingController,
  type BrowserRecordingPort,
  type BrowserRecordingState,
} from './browserRecorder'

/** Mounted only by E3's lazy companion page, never by a VS Code webview. */
export function CompanionRecorder({
  port,
  maxSeconds = SCREEN_RECORDING_DEFAULT_MAX_SECONDS,
}: {
  readonly port: BrowserRecordingPort
  readonly maxSeconds?: number
}) {
  const [state, setState] = useState<BrowserRecordingState>({ status: 'idle' })
  const [controller] = useState(() => new BrowserRecordingController(port, setState))
  const [microphone, setMicrophone] = useState(false)
  const [systemAudio, setSystemAudio] = useState(false)
  useEffect(() => {
    const close = () => {
      controller.discard()
    }
    window.addEventListener('pagehide', close)
    return () => {
      window.removeEventListener('pagehide', close)
      controller.discard()
    }
  }, [controller])
  const canStart = state.status === 'idle' || state.status === 'error'
  let statusText = ''
  switch (state.status) {
    case 'recording': {
      statusText = fill(UI_TEXT.media.recordingCountdown, {
        remaining: formatUnit(state.remaining, 'second'),
      })
      break
    }
    case 'requesting': {
      statusText = UI_TEXT.media.recordingPreview
      break
    }
    case 'stopping': {
      statusText = UI_TEXT.media.recordingStop
      break
    }
    case 'uploading': {
      statusText = UI_TEXT.media.uploadPending
      break
    }
    default: {
      break
    }
  }
  return (
    <section className="companion-recorder" aria-label={UI_TEXT.media.attachRecording}>
      <p>{UI_TEXT.media.recordingWarning}</p>
      <label>
        <input
          type="checkbox"
          checked={microphone}
          disabled={!canStart}
          onChange={(event) => {
            setMicrophone(event.target.checked)
          }}
        />
        {UI_TEXT.media.recordingMicrophone}
      </label>
      <label>
        <input
          type="checkbox"
          checked={systemAudio}
          disabled={!canStart}
          onChange={(event) => {
            setSystemAudio(event.target.checked)
          }}
        />
        {UI_TEXT.media.recordingSystemAudio}
      </label>
      {canStart && (
        <button
          type="button"
          onClick={(event) => {
            void controller.start(
              { maxSeconds, microphone, systemAudio },
              event.nativeEvent.isTrusted,
            )
          }}
        >
          {UI_TEXT.media.recordingStart}
        </button>
      )}
      <p role="status" aria-live="polite">
        {statusText}
      </p>
      {state.status === 'recording' && (
        <button
          type="button"
          onClick={() => {
            controller.stop()
          }}
        >
          {UI_TEXT.media.recordingStop}
        </button>
      )}
      {state.status === 'preview' && (
        <>
          <video controls src={state.url} aria-label={UI_TEXT.media.recordingPreview} />
          <button
            type="button"
            onClick={() => {
              void controller.attach()
            }}
          >
            {UI_TEXT.media.recordingAttach}
          </button>
        </>
      )}
      {!canStart && (
        <button
          type="button"
          onClick={() => {
            controller.discard()
          }}
        >
          {UI_TEXT.media.recordingDiscard}
        </button>
      )}
      {state.status === 'error' && <p role="alert">{state.reason}</p>}
    </section>
  )
}
