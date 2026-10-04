// Voice's drivers as the activation bundle sees them (M9, M35, PLAN.md D6):
// dist/voice.js, built from voiceEntry.ts and required on the first
// recording. Only types come from the drivers' side here: a value imported
// from there would carry them back into dist/extension.js, which the
// bundle-split gate refuses.
//
// There is no fallback without it: a recording that cannot load it fails as
// any recording fails, through the listener's `onError` ("Voice dictation
// failed: …", the log has the cause), and the next press tries again.

import type { DictationHandle, DictationListener } from '../../core/voice/dictation'
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as VoiceEntry from './voiceEntry'

/** The bundle's two drivers, shipped and loaded together. */
export interface VoiceBundle {
  readonly createDictation: typeof VoiceEntry.createDictation
  readonly createMuseVoice: typeof VoiceEntry.createMuseVoice
}

/** Whether a required module exports both drivers. */
export function isVoiceBundle(value: unknown): value is VoiceBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createDictation' in value &&
    typeof value.createDictation === 'function' &&
    'createMuseVoice' in value &&
    typeof value.createMuseVoice === 'function'
  )
}

export interface VoiceLoaderDeps {
  /** dist/voice.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first recording and kept from then on. */
export function voiceLoader(deps: VoiceLoaderDeps): () => VoiceBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isVoiceBundle,
    label: 'voice bundle',
    unavailable: () => UI_TEXT.dictationNotLoaded,
  })
}

/**
 * A driver whose implementation is made on the first `start`, so the bundle
 * loads with the first recording rather than with the panel. A load that
 * fails is the listener's `onError` (the status is still idle), and the next
 * `start` tries again; `stop` and `dispose` reach the driver once there is one.
 */
export function deferredDriver(
  listener: DictationListener,
  make: () => DictationHandle,
): DictationHandle {
  let driver: DictationHandle | undefined
  let isDisposed = false
  return {
    start() {
      if (isDisposed) {
        return
      }
      if (driver === undefined) {
        try {
          driver = make()
        } catch (error: unknown) {
          listener.onError(error instanceof Error ? error.message : String(error))
          return
        }
      }
      driver.start()
    },
    stop() {
      driver?.stop()
    },
    dispose() {
      isDisposed = true
      driver?.dispose()
    },
  }
}
