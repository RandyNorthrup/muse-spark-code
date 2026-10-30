// M105 R3: portal consent is the only Linux screen source. Editor/runtime
// adapters inject D-Bus, private storage and trusted bounded process launch.
import path from 'node:path'
import * as z from 'zod/mini'
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_MAX_UPLOAD_MIB,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { mediaInfoSchema, screenRecordingOptionsSchema } from '../../../shared/media'
import type {
  ScreenRecordingDriver,
  ScreenRecordingOptions,
  ScreenRecordingPreview,
  ScreenRecordingResult,
  ScreenRecordingRun,
} from './driver'

/**
The portal's video source: its PipeWire descriptor with the node it names.
Sound does not come from the portal (it governs no microphone): the audio
elements connect to the default PipeWire daemon themselves, so the gate for
sound is the person's explicit per-recording selection.
*/
const sourceSchema = z.strictObject({
  fd: z.int().check(z.gte(0)),
  nodeId: z.int().check(z.gt(0)),
})
type PipeWireSource = z.infer<typeof sourceSchema>

/** The native helper's own output bound (RLF-RECORDING's portal recorder). */
export const LINUX_RECORDING_HELPER_MAX_BYTES = MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES

interface PortalSession {
  /** D-Bus adapter returns untrusted identities; the driver validates them. */
  readonly video: unknown
  /** Resolves on permission revocation, portal closure or compositor exit. */
  readonly closed: Promise<void>
  readonly close: () => Promise<void>
}

interface PrivateRecording {
  /** Created in an owner-only directory; precreated file mode is owner-only. */
  readonly path: string
  readonly remove: () => Promise<void>
}

interface EncoderRun {
  /** EOS, bounded grace then kill; settles result only after every writer exits. */
  readonly stop: () => Promise<void>
  readonly cancel: () => Promise<void>
  readonly result: Promise<boolean>
}

export interface LinuxRecordingPort {
  /** Only an explicit user entry gets true; remote/headless/tool entries do not. */
  readonly userInitiated: () => boolean
  readonly localScreen: () => boolean
  /** Owner aborts on close, disconnect and sleep, including during the picker. */
  readonly signal: AbortSignal
  /**
  Absolute gst-launch-1.0 path, with pipewiresrc/H.264/mp4 probed, plus the
  AAC audio plugins when sound is selected (a video-only recording never
  refuses for a missing audio codec).
  */
  readonly findEncoder: (audio: {
    readonly microphone: boolean
    readonly systemAudio: boolean
  }) => Promise<string | undefined>
  /**
  Runs the portal flow: the desktop shows its picker and the person answers
  it. A refusal rejects with an Error named for it: NotAllowedError when
  the desktop or the person's policy refuses, NotFoundError when there is
  no screen-cast portal, AbortError when the person ends the picker;
  anything else keeps its own identity.
  */
  readonly openPortal: (
    options: ScreenRecordingOptions,
    signal: AbortSignal,
  ) => Promise<PortalSession>
  /** True when the desktop's portal answers with a ScreenCast interface (no picker, no session). */
  readonly hasPortal: () => Promise<boolean>
  readonly createPrivateRecording: () => Promise<PrivateRecording>
  /** Verify trusted path at launch; no shell or credentials. Inherit exactly
  these fds, enforce hard output size and lifetime, and kill on parent exit.
  maxSeconds 0 enforces no lifetime: the run ends only at Stop, cancel or
  parent exit (D121). */
  readonly launchVerified: (request: {
    readonly command: string
    readonly args: readonly string[]
    readonly sources: readonly PipeWireSource[]
    readonly output: string
    readonly maxBytes: number
    readonly maxSeconds: number
    readonly signal: AbortSignal
  }) => Promise<EncoderRun>
  /** M1's bounded byte sniffer, never metadata inferred from the filename. */
  readonly sniff: (file: string) => Promise<unknown>
  /**
  The recording file's byte bound: the person's upload cap when set, else
  the helper's own bound. Refused unless a whole number from 1 to the
  helper's bound.
  */
  readonly maxBytes: number
}

function unavailable(reason: string): string {
  return fill(UI_TEXT.media.recordingUnavailable, { reason })
}

function refused(reason: string): ScreenRecordingRun {
  return {
    stop: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    result: Promise.resolve({ ok: false, reason }),
  }
}

/** The portal's video: its descriptor and the node it names. */
function videoArgs(source: PipeWireSource): string[] {
  return [
    'pipewiresrc',
    `fd=${String(source.fd)}`,
    `path=${String(source.nodeId)}`,
    'do-timestamp=true',
  ]
}

/**
Sound connects to the default daemon: no descriptor and no node, so the
default microphone is the daemon's own default source, and the system's
sound is the default output's monitor (PipeWire's `stream.capture.sink`).
*/
function audioArgs(isSystemAudio: boolean): string[] {
  return [
    'pipewiresrc',
    ...(isSystemAudio ? ['stream-properties="props,stream.capture.sink=true"'] : []),
    'do-timestamp=true',
  ]
}

function pipeline(
  output: string,
  video: PipeWireSource,
  options: ScreenRecordingOptions,
): string[] {
  // GStreamer's parser receives quoted properties, even for paths with spaces.
  // The native helper runs gst-launch-1.0 with -e: its stop is EOS.
  const args = [
    'mp4mux',
    'name=mux',
    '!',
    'filesink',
    `location=${JSON.stringify(output)}`,
    ...videoArgs(video),
    '!',
    'videoconvert',
    '!',
    'x264enc',
    '!',
    'h264parse',
    '!',
    'queue',
    '!',
    'mux.video_0',
  ]
  if (options.microphone || options.systemAudio) {
    args.push(
      'audiomixer',
      'name=mix',
      '!',
      'audioconvert',
      '!',
      'avenc_aac',
      '!',
      'aacparse',
      '!',
      'queue',
      '!',
      'mux.audio_0',
    )
    for (const isSystemAudio of [false, true])
      if (isSystemAudio ? options.systemAudio : options.microphone)
        args.push(
          ...audioArgs(isSystemAudio),
          '!',
          'audioconvert',
          '!',
          'audioresample',
          '!',
          'mix.',
        )
  }
  return args
}

/** No process or permission request occurs until the interactive start call. */
export function linuxRecordingDriver(port: LinuxRecordingPort): ScreenRecordingDriver {
  let isBusy = false
  const available: ScreenRecordingDriver['available'] = async () => {
    if (!port.localScreen()) return { ok: false, reason: UI_TEXT.media.recordingRemote }
    let command: string | undefined
    try {
      command = await port.findEncoder({ microphone: false, systemAudio: false })
    } catch {
      return { ok: false, reason: unavailable('GStreamer / pipewiresrc') }
    }
    if (command === undefined || !path.posix.isAbsolute(command.replaceAll('\\', '/')))
      return { ok: false, reason: unavailable('GStreamer / pipewiresrc / H.264 / AAC') }
    return (await port.hasPortal())
      ? { ok: true }
      : { ok: false, reason: unavailable('xdg-desktop-portal ScreenCast') }
  }
  return {
    available,
    async start(input, onCountdown) {
      if (!port.userInitiated()) return refused(UI_TEXT.media.recordingUserOnly)
      const options = screenRecordingOptionsSchema.safeParse(input)
      if (isBusy || port.signal.aborted || !options.success)
        return refused(UI_TEXT.execStatus.cancelled)
      if (
        !Number.isSafeInteger(port.maxBytes) ||
        port.maxBytes <= 0 ||
        port.maxBytes > LINUX_RECORDING_HELPER_MAX_BYTES
      )
        return refused(UI_TEXT.media.recordingFailed)
      isBusy = true
      let isHandedOff = false
      const lifecycle = new AbortController()
      const isAborted = () => lifecycle.signal.aborted
      const abortSetup = () => {
        lifecycle.abort()
      }
      port.signal.addEventListener('abort', abortSetup, { once: true })
      const activePort = { ...port, signal: lifecycle.signal }
      let session: PortalSession | undefined
      let file: PrivateRecording | undefined
      try {
        if (!port.localScreen()) return refused(UI_TEXT.media.recordingRemote)
        const command = await port.findEncoder({
          microphone: options.data.microphone,
          systemAudio: options.data.systemAudio,
        })
        if (command === undefined || !path.posix.isAbsolute(command.replaceAll('\\', '/'))) {
          return refused(unavailable('GStreamer / pipewiresrc / H.264 / AAC'))
        }
        if (isAborted()) return refused(UI_TEXT.execStatus.cancelled)
        try {
          session = await port.openPortal(options.data, lifecycle.signal)
        } catch (error) {
          if (error instanceof Error && error.name === 'NotAllowedError')
            return refused(UI_TEXT.media.recordingPermissionDenied)
          if (error instanceof Error && error.name === 'NotFoundError')
            return refused(unavailable('xdg-desktop-portal ScreenCast'))
          // The person ended the picker: a cancelled recording, not a failure.
          if (error instanceof Error && error.name === 'AbortError')
            return refused(UI_TEXT.execStatus.cancelled)
          throw error
        }
        const closeSetup = () => {
          if (!isHandedOff) abortSetup()
        }
        void session.closed.then(closeSetup).catch(closeSetup)
        if (isAborted()) return refused(UI_TEXT.execStatus.cancelled)
        const video = sourceSchema.parse(session.video)
        file = await port.createPrivateRecording()
        if (isAborted()) return refused(UI_TEXT.execStatus.cancelled)
        if (
          !path.posix.isAbsolute(file.path.replaceAll('\\', '/')) ||
          file.path.includes(String.fromCodePoint(0))
        ) {
          return refused(unavailable('mp4'))
        }
        const recording = await port.launchVerified({
          command,
          args: pipeline(file.path, video, options.data),
          sources: [video],
          output: file.path,
          maxBytes: port.maxBytes,
          maxSeconds: options.data.maxSeconds,
          signal: lifecycle.signal,
        })
        // The run now owns both resources; finally only cleans failed setup.
        const run = recordingRun(
          activePort,
          recording,
          session,
          file,
          options.data,
          onCountdown,
          () => {
            port.signal.removeEventListener('abort', abortSetup)
          },
        )
        isHandedOff = true
        const releaseRun = () => {
          isBusy = false
        }
        void run.result.finally(releaseRun).catch(() => {
          /* Ownership is released in finally, including a failed result. */
        })
        session = undefined
        file = undefined
        return run
      } catch {
        return refused(UI_TEXT.media.recordingFailed)
      } finally {
        try {
          try {
            await session?.close()
          } finally {
            await file?.remove()
          }
        } catch {
          /* Setup already returned a refusal; cleanup cannot retain ownership. */
        } finally {
          if (!isHandedOff) isBusy = false
          if (!isHandedOff) port.signal.removeEventListener('abort', abortSetup)
        }
      }
    },
  }
}

function recordingRun(
  port: LinuxRecordingPort,
  recording: EncoderRun,
  session: PortalSession,
  file: PrivateRecording,
  options: ScreenRecordingOptions,
  onCountdown: (seconds: number) => void,
  releaseOwner: () => void,
): ScreenRecordingRun {
  let isCancelled = false
  const wasCancelled = () => isCancelled
  let isFinished = false
  let isPublished = false
  let stopTask: Promise<void> | undefined
  let cancelTask: Promise<void> | undefined
  const stop = () => (isFinished ? Promise.resolve() : (stopTask ??= recording.stop()))
  const cancel = () => {
    isCancelled = true
    if (!isFinished) return (cancelTask ??= recording.cancel())
    // Before publication the result's finally owns disposal and cancellation.
    return isPublished ? dispose() : Promise.resolve()
  }
  let disposeTask: Promise<void> | undefined
  const dispose = () =>
    (disposeTask ??= (async () => {
      port.signal.removeEventListener('abort', abort)
      releaseOwner()
      await file.remove()
    })())
  const abort = () => {
    void cancel().catch(() => {
      /* The result owns cleanup even if cancel fails. */
    })
  }
  port.signal.addEventListener('abort', abort, { once: true })
  void session.closed
    .then(() => {
      if (!isFinished) abort()
    })
    .catch(abort)
  const started = performance.now()
  let previous = Date.now()
  // D121: maxSeconds 0 records until stopped — no automatic stop of ours.
  // The tick then reports seconds recorded; otherwise seconds remaining.
  const isUncapped = options.maxSeconds === 0
  const update = () => {
    const now = Date.now()
    if (now < previous || now - previous > 2 * MILLISECONDS_PER_SECOND) {
      abort()
      return
    }
    previous = now
    const elapsed = Math.floor((performance.now() - started) / MILLISECONDS_PER_SECOND)
    if (isUncapped) {
      onCountdown(elapsed)
      return
    }
    const remaining = Math.max(0, options.maxSeconds - elapsed)
    onCountdown(remaining)
    if (remaining === 0)
      void stop().catch(async () => {
        // A failed automatic stop escalates to cancel; the encoder result
        // owns cleanup however termination settles.
        try {
          // A failed automatic Stop terminates the writer, not the user's consent.
          await recording.cancel()
        } catch {
          /* The encoder result still owns cleanup after termination fails. */
        }
      })
  }
  const timer = setInterval(update, MILLISECONDS_PER_SECOND)
  const result: Promise<ScreenRecordingResult> = (async () => {
    let preview: ScreenRecordingPreview | undefined
    let reason = UI_TEXT.media.recordingFailed
    try {
      update()
      if (port.signal.aborted) abort()
      const isSuccess = await recording.result
      if (wasCancelled()) reason = UI_TEXT.execStatus.cancelled
      else if (isSuccess) {
        const info = mediaInfoSchema.parse(await port.sniff(file.path))
        if (
          wasCancelled() ||
          info.kind !== 'video' ||
          info.mediaType !== 'video/mp4' ||
          info.sizeBytes === 0 ||
          info.sizeBytes > port.maxBytes ||
          info.durationSeconds === null ||
          (options.maxSeconds > 0 && info.durationSeconds > options.maxSeconds) ||
          info.hasSoundtrack !== (options.microphone || options.systemAudio)
        )
          reason = unavailable('mp4')
        else preview = { path: file.path, info, dispose }
      }
    } catch {
      // A failed result attempt cancels the writer; the finally below still
      // closes the session and disposes the file.
      try {
        await recording.cancel()
      } catch {
        // The failed encoder result still owns cleanup.
      }
    } finally {
      isFinished = true
      clearInterval(timer)
      try {
        await session.close()
      } catch {
        // A close failure after a result keeps no preview: the file is
        // disposed below, so nothing unverified is delivered.
        preview = undefined
        reason = UI_TEXT.media.recordingFailed
      } finally {
        if (wasCancelled()) {
          preview = undefined
          reason = UI_TEXT.execStatus.cancelled
        }
        if (preview === undefined)
          try {
            await dispose()
          } catch {
            // A failed private-file removal still reports failure; the
            // owner-only directory bounds what stays behind.
            reason = UI_TEXT.media.recordingFailed
          }
      }
    }
    if (preview === undefined) return { ok: false, reason }
    isPublished = true
    return { ok: true, preview }
  })()
  return {
    stop: async () => {
      await stop()
      await result
    },
    cancel: async () => {
      await cancel()
      await result
    },
    result,
  }
}
