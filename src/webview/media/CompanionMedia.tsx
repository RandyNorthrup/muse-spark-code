import { useEffect, useRef, useState } from 'react'
import {
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  BYTES_PER_MIB,
  SCREEN_RECORDING_DEFAULT_MAX_SECONDS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import { companionMediaUploadSchema, screenRecordingOptionsSchema } from '../../shared/media'
import type { z } from 'zod/mini'
import type { MediaUploadPort } from './transport'
import type {
  BrowserRecorderPort,
  BrowserRecordingPreview,
  BrowserRecordingRun,
} from './recordingPort'
import './media.css'

interface Props {
  readonly attachmentEpoch: number
  readonly transport: MediaUploadPort
  readonly recorder: BrowserRecorderPort
  readonly onAttached: (attachment: z.infer<typeof companionMediaUploadSchema>) => void
  readonly maxBytes?: number
  readonly maxSeconds?: number
}

export default function CompanionMedia(props: Props) {
  return <MediaControls key={props.attachmentEpoch} {...props} />
}

function MediaControls({
  transport,
  recorder,
  onAttached,
  maxBytes = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB,
  maxSeconds = SCREEN_RECORDING_DEFAULT_MAX_SECONDS,
}: Props) {
  const [status, setStatus] = useState('')
  const [isBusy, setBusy] = useState(false)
  const [isRecording, setRecording] = useState(false)
  const [microphone, setMicrophone] = useState(false)
  const [systemAudio, setSystemAudio] = useState(false)
  const [preview, setPreview] = useState<{
    readonly recording: BrowserRecordingPreview
    readonly url: string
  }>()
  const [canStopRecording, setCanStopRecording] = useState(false)
  const upload = useRef<AbortController | undefined>(undefined)
  const run = useRef<BrowserRecordingRun | undefined>(undefined)
  const recordingIntent = useRef(false)
  const currentPreview = useRef<
    { readonly recording: BrowserRecordingPreview; readonly url: string } | undefined
  >(undefined)
  const mountState = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const isLive = () => mountState.current

  useEffect(() => {
    mountState.current = true
    return () => {
      mountState.current = false
      recordingIntent.current = false
      upload.current?.abort()
      run.current?.cancel()
      if (currentPreview.current === undefined) return
      currentPreview.current.recording.dispose()
      URL.revokeObjectURL(currentPreview.current.url)
    }
  }, [])

  const discard = () => {
    if (currentPreview.current !== undefined) {
      currentPreview.current.recording.dispose()
      URL.revokeObjectURL(currentPreview.current.url)
    }
    currentPreview.current = undefined
    setPreview(undefined)
    fileInput.current?.focus()
  }

  const attach = async (file: Blob, name: string, isScreenRecording: boolean) => {
    if (
      upload.current !== undefined ||
      recordingIntent.current ||
      (!isScreenRecording && currentPreview.current !== undefined)
    )
      return
    if (file.size === 0 || file.size > maxBytes) {
      setStatus(fill(UI_TEXT.media.sizeExceeded, { size: formatBytes(maxBytes) }))
      return
    }
    const controller = new AbortController()
    upload.current = controller
    setBusy(true)
    setStatus(UI_TEXT.media.uploadPending)
    try {
      const result = await transport.upload(
        file,
        name,
        isScreenRecording,
        controller.signal,
        (bytes, total) => {
          if (mountState.current && !controller.signal.aborted)
            setStatus(
              fill(UI_TEXT.media.uploadProgress, {
                uploaded: formatBytes(bytes),
                total: formatBytes(total),
              }),
            )
        },
      )
      if (controller.signal.aborted || !isLive()) return
      onAttached(companionMediaUploadSchema.parse(result))
      setStatus('')
      if (isScreenRecording) discard()
    } catch (error) {
      if (isLive()) setStatus(error instanceof Error ? error.message : UI_TEXT.attachmentUnreadable)
    } finally {
      upload.current = undefined
      if (isLive()) setBusy(false)
    }
  }

  const select = (files: FileList | null) => {
    const file = files?.[0]
    if (file !== undefined) void attach(file, file.name, false)
  }

  const record = async () => {
    if (
      upload.current !== undefined ||
      recordingIntent.current ||
      currentPreview.current !== undefined
    )
      return
    const availability = recorder.available()
    if (!availability.ok) {
      setStatus(availability.reason)
      return
    }
    const options = screenRecordingOptionsSchema.safeParse({ maxSeconds, microphone, systemAudio })
    if (!options.success) {
      setStatus(UI_TEXT.media.recordingUserOnly)
      return
    }
    setMicrophone(false)
    setSystemAudio(false)
    recordingIntent.current = true
    setRecording(true)
    try {
      const started = await recorder.start(options.data, (remaining) => {
        if (isLive())
          setStatus(
            fill(UI_TEXT.media.recordingCountdown, {
              remaining: formatUnit(remaining, 'second'),
            }),
          )
      })
      if (!isLive()) {
        started.cancel()
        return
      }
      run.current = started
      setCanStopRecording(true)
      const result = await started.result
      if (!isLive()) {
        result.dispose()
        return
      }
      if (
        result.blob.type.split(';', 1)[0]?.trim().toLowerCase() !== 'video/mp4' ||
        result.blob.size === 0 ||
        result.blob.size > maxBytes
      ) {
        result.dispose()
        setStatus(UI_TEXT.media.converterUnavailable)
        return
      }
      const ready = { recording: result, url: URL.createObjectURL(result.blob) }
      currentPreview.current = ready
      setPreview(ready)
      setStatus('')
    } catch (error) {
      if (isLive())
        setStatus(error instanceof Error ? error.message : UI_TEXT.media.recordingPermissionDenied)
    } finally {
      recordingIntent.current = false
      run.current = undefined
      if (isLive()) setRecording(false)
      if (isLive()) setCanStopRecording(false)
    }
  }

  return (
    <section
      className="companion-media"
      aria-label={UI_TEXT.attachmentsLabel}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        select(event.dataTransfer.files)
      }}
      onPaste={(event) => {
        if (event.clipboardData.files.length === 0) {
          return
        }

        event.preventDefault()
        select(event.clipboardData.files)
      }}
    >
      <label className="companion-media-picker">
        {UI_TEXT.attachFile}
        <input
          ref={fileInput}
          type="file"
          disabled={isBusy || isRecording || preview !== undefined}
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,video/mp4,video/quicktime,audio/wav,audio/mpeg,.mov,.webm,.mkv,.m4a"
          onChange={(event) => {
            select(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
      </label>
      <div className="companion-media-controls">
        <label>
          <input
            type="checkbox"
            checked={microphone}
            disabled={isBusy || isRecording}
            onChange={(event) => {
              setMicrophone(event.currentTarget.checked)
            }}
          />
          {UI_TEXT.media.recordingMicrophone}
        </label>
        <label>
          <input
            type="checkbox"
            checked={systemAudio}
            disabled={isBusy || isRecording}
            onChange={(event) => {
              setSystemAudio(event.currentTarget.checked)
            }}
          />
          {UI_TEXT.media.recordingSystemAudio}
        </label>
        <button
          type="button"
          disabled={isBusy || isRecording || preview !== undefined}
          onClick={() => {
            void record()
          }}
        >
          {UI_TEXT.media.recordingStart}
        </button>
        {isRecording && (
          <button
            type="button"
            disabled={!canStopRecording}
            onClick={() => {
              run.current?.stop()
            }}
          >
            {UI_TEXT.media.recordingStop}
          </button>
        )}
        {isBusy && (
          <button
            type="button"
            onClick={() => {
              upload.current?.abort()
            }}
          >
            {UI_TEXT.media.uploadStop}
          </button>
        )}
      </div>
      {preview !== undefined && (
        <div className="companion-media-preview">
          <p>{UI_TEXT.media.recordingWarning}</p>
          <video
            src={preview.url}
            controls
            preload="metadata"
            aria-label={UI_TEXT.media.recordingPreview}
          />
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              void attach(preview.recording.blob, preview.recording.name, true)
            }}
          >
            {UI_TEXT.media.recordingAttach}
          </button>
          <button type="button" disabled={isBusy} onClick={discard}>
            {UI_TEXT.media.recordingDiscard}
          </button>
        </div>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
