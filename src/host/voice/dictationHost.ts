import type { MuseVoiceDeps } from '../../core/voice/museVoice'
// The host side of voice dictation (M9): finds the helper for this platform,
// so the microphone says at once whether it can record. One setup per
// window; each conversation creates its own driver from it on first use.
// Muse Voice (M35) adds its capture helper, the Linux recorders and the
// WebSocket to Meta. The drivers themselves, with the processes and the
// socket, are dist/voice.js (PLAN.md D6), loaded on the first recording;
// Linux's offline driver and its helper/model acquisition are
// dist/voiceLinux.js, loaded on the first Linux recording.
//
// This module ships in dist/dictation.js, required at the setups' existing
// construction points, so it never touches `vscode`: every host capability
// arrives as a parameter (the M93 precedent), and the deferred-bundle build
// refuses a `vscode` import by design.

import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { CoreLogger } from '../../core/logging'
import type { DictationSetup } from '../../core/voice/dictation'
import {
  type CaptureProbe,
  type HelperProbe,
  locateCaptureHelper,
  locateDictationHelper,
} from '../../core/voice/helperLocation'
import { voiceNetworkRefusal, type VoiceNetworkRefusal } from '../../core/voice/voiceNetwork'
import { hostRouting, type VoiceNetworkPosture } from '../networkPosture'
import { UI_TEXT } from '../../shared/constants'
import { LINUX_DICTATION } from '../../shared/linuxDictationConstants'
import { uiLocale } from '../../shared/l10n/text'
import { deferredDriver, type VoiceBundle, type VoiceLinuxBundle } from './voiceBundle'

/** The window side this setup runs on, read from the host at construction. */
export interface DictationHostNames {
  /**
   * The remote this extension host runs on, or undefined on the user's own
   * machine. `env.remoteName` alone is not enough: it is also set in the
   * local extension host of a remote window, where a user's
   * `remote.extensionKind` override could run this extension; the
   * extension's kind says which side it is on.
   */
  readonly remoteName: string | undefined
  readonly appName: string
}

/**
 * Every host capability the setups touch, read where `vscode` is
 * available and handed in here.
 */
export interface DictationHostCaps extends DictationHostNames {
  /** Whether the Linux model setting is on now. */
  readonly isLinuxModelEnabled: () => boolean
  /**
   * Calls the listener when the Linux model setting changes (the caller
   * filters to that setting); the setup calls back only while it is off.
   */
  readonly registerConfigListener: (listener: () => void) => { dispose(): void }
  /** Shows the user an error. */
  readonly showError: (message: string) => void
  /**
   * Asks once for both downloads, and keeps asking nothing while the wait
   * is cancelled. The sizes are the pins' display approximations; the pins
   * enforce the exact per-file sizes at download.
   */
  readonly askDownloadConsent: (
    sizes: { readonly helperDownloadBytes: number; readonly bytes: number },
    directory: string,
    signal: AbortSignal,
  ) => Promise<boolean>
}

export function createDictationSetup(
  probe: Omit<HelperProbe, 'fileExists' | 'programFiles' | 'remoteName' | 'appName'>,
  log: CoreLogger,
  voice: () => VoiceBundle,
  voiceLinux: () => VoiceLinuxBundle,
  linux:
    | { readonly storageRoot: string; readonly register: (disposable: { dispose(): void }) => void }
    | undefined,
  caps: DictationHostCaps,
): DictationSetup {
  const directory =
    linux === undefined ? undefined : path.join(linux.storageRoot, LINUX_DICTATION.directory)
  if (directory !== undefined && linux !== undefined && probe.platform === 'linux') {
    const remove = async (): Promise<void> => {
      try {
        await voiceLinux().removeLinuxDictationModel(directory)
      } catch (error: unknown) {
        log.warn('Linux dictation model removal failed')
        // The reason is technical (permissions, a live download lock), so it
        // stays spliced onto the translated sentence (RVCM9LNX P3).
        const reason = error instanceof Error && error.message !== '' ? error.message : 'unknown'
        caps.showError(`${UI_TEXT.linuxDictationRemoveFailed}: ${reason}`)
      }
    }
    if (!caps.isLinuxModelEnabled() && existsSync(directory)) void remove()
    linux.register(
      caps.registerConfigListener(() => {
        if (!caps.isLinuxModelEnabled()) void remove()
      }),
    )
  }
  if (directory !== undefined && probe.platform === 'linux' && !caps.isLinuxModelEnabled()) {
    // 'Removed' only when nothing is left to remove; otherwise removal was
    // just launched above and its outcome is still unknown (RVCM9LNX P3).
    return {
      isAvailable: false,
      reason: existsSync(directory)
        ? UI_TEXT.linuxDictationRemovalPending
        : UI_TEXT.linuxDictationRemoved,
    }
  }
  const location = locateDictationHelper({
    ...probe,
    arch: process.arch,
    linuxModelPath:
      directory === undefined ? undefined : path.join(directory, LINUX_DICTATION.modelFile),
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: caps.remoteName,
    appName: caps.appName,
  })
  if (!location.isAvailable) {
    log.info(`Voice dictation unavailable: ${location.reason}`)
    return location
  }
  return {
    isAvailable: true,
    create: (listener) =>
      deferredDriver(
        listener,
        () =>
          directory !== undefined && probe.platform === 'linux'
            ? voiceLinux().createLinuxDictation(
                {
                  invocation: location.invocation,
                  listener,
                  log,
                  isEnabled: caps.isLinuxModelEnabled,
                  model: {
                    directory,
                    fetch,
                    consent: async (signal) =>
                      await caps.askDownloadConsent(
                        {
                          helperDownloadBytes: LINUX_DICTATION.helperDownloadBytes,
                          bytes: LINUX_DICTATION.bytes,
                        },
                        directory,
                        signal,
                      ),
                  },
                  helper: {
                    directory,
                    fetch,
                    consent: async (signal) =>
                      await caps.askDownloadConsent(
                        {
                          helperDownloadBytes: LINUX_DICTATION.helperDownloadBytes,
                          bytes: LINUX_DICTATION.bytes,
                        },
                        directory,
                        signal,
                      ),
                    arch: process.arch,
                  },
                },
                UI_TEXT,
                uiLocale(),
              )
            : voice().createDictation(location.invocation, listener, log, UI_TEXT, uiLocale()),
        log,
      ),
  }
}

export interface MuseVoiceSetupDeps {
  /** The Model API key, read per recording. */
  readonly apiKey: () => Promise<string | undefined>
  /** Counts reported whole seconds, or local seconds without a final. */
  readonly onSeconds: (seconds: number) => void
  readonly reserveDaily: MuseVoiceDeps['reserveDaily']
  readonly log: CoreLogger
  /** dist/voice.js, required on the first recording. */
  readonly voice: () => VoiceBundle
}

/**
 * Muse Voice (M35, PLAN.md D30): the paid engine's recorder for this
 * platform and the stream to Meta, or why it cannot run here. Whether it is
 * the microphone's engine (the setting, the accepted price, the Model API
 * backend) is the caller's to decide. `network` is the live `http`
 * posture (M56, PLAN.md D43): whether `http.proxy` names a proxy
 * (validated, never raw) and the support settings behind the socket, read
 * fresh on every rebuild so a settings change takes effect at once.
 */

/**
 * The microphone's sentence for a network refusal: the old-version text
 * only for a socket no editor version routes, otherwise the setting left
 * off and what to change. Called when the setup runs (never at module
 * load) so the installed language is the one shown.
 */
function reasonForRefusal(refusal: VoiceNetworkRefusal): string {
  switch (refusal) {
    case 'proxy': {
      return UI_TEXT.museVoiceNoProxy
    }
    case 'proxySupportOff': {
      return UI_TEXT.museVoiceProxySupportOff
    }
    case 'proxyWebSocketOff': {
      return UI_TEXT.museVoiceProxyWebSocketOff
    }
    case 'noSocket': {
      return UI_TEXT.museVoiceNoWebSocket
    }
  }
}

export function createMuseVoiceSetup(
  probe: Omit<
    CaptureProbe,
    'fileExists' | 'programFiles' | 'remoteName' | 'appName' | 'pathVariable'
  >,
  deps: MuseVoiceSetupDeps,
  names: DictationHostNames,
  network: VoiceNetworkPosture,
): DictationSetup {
  // The network refusal covers a missing socket too ('noSocket' reads the
  // same sentence PR3 answered here), so one check refuses proxy, settings
  // and socket cases with the installed language's text.
  const refusal = voiceNetworkRefusal(
    hostRouting(globalThis, 'webSocket'),
    network.isProxySet,
    network.support,
  )
  const location =
    refusal === undefined
      ? locateCaptureHelper({
          ...probe,
          fileExists: existsSync,
          programFiles: process.env['ProgramFiles'],
          remoteName: names.remoteName,
          appName: names.appName,
          pathVariable: process.env['PATH'],
          realpath: probe.realpath ?? realpathSync,
        })
      : {
          isAvailable: false as const,
          // The old-version text only for a socket no editor version
          // routes; otherwise the setting left off and what to change.
          // Read here (not at module load) so the installed language is
          // the one shown.
          reason: reasonForRefusal(refusal),
        }
  if (!location.isAvailable) {
    deps.log.info(`Muse Voice unavailable: ${location.reason}`)
    return location
  }
  const { voice, ...driverDeps } = deps
  return {
    isAvailable: true,
    create: (listener) =>
      deferredDriver(
        listener,
        () =>
          voice().createMuseVoice(
            { ...driverDeps, capture: location },
            listener,
            UI_TEXT,
            uiLocale(),
          ),
        deps.log,
      ),
  }
}
