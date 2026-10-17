// M105 R3: portal consent is the only Linux screen source. Editor/runtime
// adapters inject D-Bus, private storage and trusted bounded process launch.
import path from 'node:path'
import * as z from 'zod/mini'
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MILLISECONDS_PER_SECOND,
  SCREEN_RECORDING_RECENT_MAX_AGE_MS,
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

const sourceSchema = z.strictObject({
  fd: z.int().check(z.gte(0)),
  nodeId: z.int().check(z.gt(0)),
})
type PipeWireSource = z.infer<typeof sourceSchema>

interface PortalSession {
  /** D-Bus adapter returns untrusted identities; the driver validates them. */
  readonly video: unknown
  readonly microphone?: unknown
  readonly systemAudio?: unknown
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
  /** Absolute gst-launch-1.0 path, with pipewiresrc/H.264/mp4/AAC plugins probed. */
  readonly findEncoder: () => Promise<string | undefined>
  /** A user/OS permission refusal rejects with an Error named NotAllowedError;
   * transport, compositor and other portal failures keep their own identity. */
  readonly openPortal: (
    options: ScreenRecordingOptions,
    signal: AbortSignal,
  ) => Promise<PortalSession>
  readonly createPrivateRecording: () => Promise<PrivateRecording>
  /** Verify trusted path at launch; no shell or credentials. Inherit exactly
   * these fds, enforce hard output size and lifetime, and kill on parent exit. */
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

function sourceArgs(source: PipeWireSource): string[] {
  return [
    'pipewiresrc',
    `fd=${String(source.fd)}`,
    `path=${String(source.nodeId)}`,
    'do-timestamp=true',
  ]
}

function pipeline(
  output: string,
  video: PipeWireSource,
  audio: readonly PipeWireSource[],
): string[] {
  // GStreamer's parser receives quoted properties, even for paths with spaces.
  const args = [
    '-e',
    'mp4mux',
    'name=mux',
    '!',
    'filesink',
    `location=${JSON.stringify(output)}`,
    ...sourceArgs(video),
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
  if (audio.length > 0) {
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
    for (const source of audio)
      args.push(...sourceArgs(source), '!', 'audioconvert', '!', 'audioresample', '!', 'mix.')
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
      command = await port.findEncoder()
    } catch {
      return { ok: false, reason: unavailable('GStreamer / pipewiresrc') }
    }
    return command !== undefined && path.posix.isAbsolute(command.replaceAll('\\', '/'))
      ? { ok: true }
      : { ok: false, reason: unavailable('GStreamer / pipewiresrc / H.264 / AAC') }
  }
  return {
    available,
    async start(input, onCountdown) {
      if (!port.userInitiated()) return refused(UI_TEXT.media.recordingUserOnly)
      const options = screenRecordingOptionsSchema.safeParse(input)
      if (isBusy || port.signal.aborted || !options.success)
        return refused(UI_TEXT.execStatus.cancelled)
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
        const command = await port.findEncoder()
        if (command === undefined || !path.posix.isAbsolute(command.replaceAll('\\', '/'))) {
          return refused(unavailable('GStreamer / pipewiresrc / H.264 / AAC'))
        }
        if (isAborted()) return refused(UI_TEXT.execStatus.cancelled)
        try {
          session = await port.openPortal(options.data, lifecycle.signal)
        } catch (error) {
          if (error instanceof Error && error.name === 'NotAllowedError')
            return refused(UI_TEXT.media.recordingPermissionDenied)
          throw error
        }
        const closeSetup = () => {
          if (!isHandedOff) abortSetup()
        }
        void session.closed.then(closeSetup).catch(closeSetup)
        const video = sourceSchema.parse(session.video)
        const audio: PipeWireSource[] = []
        if (options.data.microphone) audio.push(sourceSchema.parse(session.microphone))
        if (options.data.systemAudio) audio.push(sourceSchema.parse(session.systemAudio))
        if (isAborted()) return refused(UI_TEXT.execStatus.cancelled)
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
          args: pipeline(file.path, video, audio),
          sources: [video, ...audio],
          output: file.path,
          maxBytes: MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES,
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
  const update = () => {
    const now = Date.now()
    if (now < previous || now - previous > 2 * MILLISECONDS_PER_SECOND) {
      abort()
      return
    }
    previous = now
    const remaining = Math.max(
      0,
      options.maxSeconds - Math.floor((performance.now() - started) / MILLISECONDS_PER_SECOND),
    )
    onCountdown(remaining)
    if (remaining === 0)
      void stop().catch(async () => {
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
          info.sizeBytes > MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES ||
          info.durationSeconds === null ||
          info.durationSeconds > options.maxSeconds ||
          info.hasSoundtrack !== (options.microphone || options.systemAudio)
        )
          reason = unavailable('mp4')
        else preview = { path: file.path, info, dispose }
      }
    } catch {
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

export interface LinuxLatestRecordingPort {
  /** XDG Videos/Screencasts and Spectacle's user-configured recording directory. */
  readonly roots: readonly string[]
  /** Nonrecursive, confined regular files only; reject symlinks/special files. */
  readonly list: (
    root: string,
  ) => Promise<readonly { readonly path: string; readonly modifiedAt: number }[]>
  /** Copy privately under a hard byte cap, then sniff; source is never deleted.
   * WebM is retained as WebM for M1's explicit conversion offer. */
  readonly copyForPreview: (source: string, maxBytes: number) => Promise<ScreenRecordingPreview>
}

/** Explicit Attach latest action; never walks arbitrary home/workspace trees. */
export async function latestLinuxRecording(
  port: LinuxLatestRecordingPort,
  now = Date.now(),
): Promise<ScreenRecordingResult> {
  const candidates: { readonly path: string; readonly modifiedAt: number }[] = []
  for (const root of port.roots) {
    try {
      const normalRoot = root.replaceAll('\\', '/').replace(/\/$/u, '')
      const files = await port.list(root)
      for (const file of files) {
        const normalFile = file.path.replaceAll('\\', '/')
        if (
          path.posix.isAbsolute(normalRoot) &&
          path.posix.dirname(normalFile) === normalRoot &&
          /\.(?:mp4|mov|webm)$/iu.test(normalFile) &&
          file.modifiedAt <= now &&
          now - file.modifiedAt <= SCREEN_RECORDING_RECENT_MAX_AGE_MS
        )
          candidates.push(file)
      }
    } catch {
      /* A missing GNOME/Spectacle directory does not hide the other one. */
    }
  }
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
  const latest = candidates[0]
  if (latest === undefined) return { ok: false, reason: UI_TEXT.media.recordingNoRecent }
  try {
    const preview = await port.copyForPreview(
      latest.path,
      MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES,
    )
    const parsed = mediaInfoSchema.safeParse(preview.info)
    if (
      !parsed.success ||
      parsed.data.kind !== 'video' ||
      parsed.data.sizeBytes === 0 ||
      parsed.data.sizeBytes > MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES
    ) {
      await preview.dispose()
      return { ok: false, reason: unavailable('mp4 / WebM') }
    }
    return { ok: true, preview }
  } catch {
    return { ok: false, reason: unavailable('mp4 / WebM') }
  }
}
