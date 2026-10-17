// The host side of voice dictation (M9): finds the helper for this platform,
// at activation, so the microphone says at once whether it can record. One
// setup per window; each conversation creates its own driver from it on
// first use. Muse Voice (M35) adds its capture helper, the Linux recorders
// and the WebSocket to Meta. The drivers themselves, with the processes and
// the socket, are dist/voice.js (PLAN.md D6), loaded on the first recording.

import { existsSync } from 'node:fs'
import { env, ExtensionKind, extensions } from 'vscode'
import type { CoreLogger } from '../../core/logging'
import type { DictationSetup } from '../../core/voice/dictation'
import {
  type CaptureProbe,
  type HelperProbe,
  locateCaptureHelper,
  locateDictationHelper,
} from '../../core/voice/helperLocation'
import { EXTENSION_QUALIFIED_ID, UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { deferredDriver, type VoiceBundle } from './voiceBundle'

/**
 * The remote this extension host runs on, or undefined on the user's own
 * machine. `env.remoteName` alone is not enough: it is also set in the local
 * extension host of a remote window ("defined in all extension hosts (local
 * and remote) in case a remote extension host exists", vscode.d.ts), where
 * a user's `remote.extensionKind` override could run this extension; the
 * extension's kind says which side it is on.
 */
function remoteHostName(): string | undefined {
  const kind = extensions.getExtension(EXTENSION_QUALIFIED_ID)?.extensionKind
  return kind === ExtensionKind.UI ? undefined : env.remoteName
}

export function createDictationSetup(
  probe: Omit<HelperProbe, 'fileExists' | 'programFiles' | 'remoteName' | 'appName'>,
  log: CoreLogger,
  voice: () => VoiceBundle,
): DictationSetup {
  const location = locateDictationHelper({
    ...probe,
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: remoteHostName(),
    appName: env.appName,
  })
  if (!location.isAvailable) {
    log.info(`Voice dictation unavailable: ${location.reason}`)
    return location
  }
  return {
    isAvailable: true,
    create: (listener) =>
      deferredDriver(listener, () =>
        voice().createDictation(location.invocation, listener, log, UI_TEXT, uiLocale()),
      ),
  }
}

export interface MuseVoiceSetupDeps {
  /** The Model API key, read per recording. */
  readonly apiKey: () => Promise<string | undefined>
  /** Counts whole seconds of audio sent, for the window's tally. */
  readonly onSeconds: (seconds: number) => void
  readonly log: CoreLogger
  /** dist/voice.js, required on the first recording. */
  readonly voice: () => VoiceBundle
}

/**
 * Muse Voice (M35, PLAN.md D30): the paid engine's recorder for this
 * platform and the stream to Meta, or why it cannot run here. Whether it is
 * the microphone's engine (the setting, the accepted price, the Model API
 * backend) is the caller's to decide.
 */
export function createMuseVoiceSetup(
  probe: Omit<
    CaptureProbe,
    'fileExists' | 'programFiles' | 'remoteName' | 'appName' | 'pathVariable'
  >,
  deps: MuseVoiceSetupDeps,
): DictationSetup {
  if (typeof globalThis.WebSocket !== 'function') {
    return { isAvailable: false, reason: UI_TEXT.museVoiceNoWebSocket }
  }
  const location = locateCaptureHelper({
    ...probe,
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: remoteHostName(),
    appName: env.appName,
    pathVariable: process.env['PATH'],
  })
  if (!location.isAvailable) {
    deps.log.info(`Muse Voice unavailable: ${location.reason}`)
    return location
  }
  const { voice, ...driverDeps } = deps
  return {
    isAvailable: true,
    create: (listener) =>
      deferredDriver(listener, () =>
        voice().createMuseVoice(
          { ...driverDeps, capture: location },
          listener,
          UI_TEXT,
          uiLocale(),
        ),
      ),
  }
}
