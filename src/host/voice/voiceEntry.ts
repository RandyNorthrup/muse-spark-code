// Voice's shipped CommonJS bundle (M9, M35, PLAN.md D6): the dictation
// driver, Muse Voice's stream to Meta, and the processes and socket behind
// them. esbuild builds this file into dist/voice.js, which `voiceLoader`
// requires on the first recording, so none of it is in the bundle VS Code
// loads at activation; finding the helper (whether the microphone is
// offered at all) stays there. Each driver receives the installed display
// table, since Muse Voice's failures are said in it.

import type { CoreLogger } from '../../core/logging'
import {
  Dictation,
  type DictationHandle,
  type DictationListener,
  type HelperInvocation,
} from '../../core/voice/dictation'
import type { CaptureLocation } from '../../core/voice/helperLocation'
import { MuseVoiceDictation } from '../../core/voice/museVoice'
import { recorderHelper } from '../../core/voice/recorderHelper'
import { MUSE_VOICE_REALTIME_URL } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { openWebSocket, spawnHelper, startRecorder } from './voiceProcesses'

/** The free engine's driver (M9): the OS recogniser behind the helper. */
export function createDictation(
  invocation: HelperInvocation,
  listener: DictationListener,
  log: CoreLogger,
  table: UiText,
  locale: string,
): DictationHandle {
  setUiText(table, locale)
  return new Dictation({ invocation, spawn: spawnHelper, listener, log })
}

/** Where a Muse Voice recording comes from: a capture helper, or Linux's recorder. */
export type CaptureSource = Extract<CaptureLocation, { readonly isAvailable: true }>

export interface MuseVoiceDriverDeps {
  readonly capture: CaptureSource
  /** The Model API key, read per recording. */
  readonly apiKey: () => Promise<string | undefined>
  /** Counts whole seconds of audio sent, for the window's tally. */
  readonly onSeconds: (seconds: number) => void
  readonly log: CoreLogger
}

/** The paid engine's driver (M35): the capture helper's audio streamed to Meta. */
export function createMuseVoice(
  deps: MuseVoiceDriverDeps,
  listener: DictationListener,
  table: UiText,
  locale: string,
): DictationHandle {
  setUiText(table, locale)
  const { capture } = deps
  const invocation: HelperInvocation =
    capture.kind === 'helper'
      ? capture.invocation
      : { command: capture.command, args: capture.args }
  const spawnCapture =
    capture.kind === 'helper'
      ? spawnHelper
      : () => recorderHelper(capture.name, () => startRecorder(capture.command, capture.args))
  return new MuseVoiceDictation(
    {
      createCapture: (captureListener) =>
        new Dictation({
          invocation,
          spawn: spawnCapture,
          listener: captureListener,
          log: deps.log,
        }),
      openSocket: openWebSocket,
      url: MUSE_VOICE_REALTIME_URL,
      apiKey: deps.apiKey,
      onSeconds: deps.onSeconds,
      log: deps.log,
    },
    listener,
  )
}
