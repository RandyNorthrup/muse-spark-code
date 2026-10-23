import type { DictationHandle, DictationListener, DictationSetup } from '../../core/voice/dictation'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeVoiceDeps {
  readonly setup: DictationSetup
  readonly assertCurrent: () => void
  /** Free OS availability, or verified paid capability/consent/ledger/key admission. */
  readonly canStart: () => boolean
  readonly cancelNative: () => void
  readonly drainNative: () => Promise<void>
}

/** Existing native/paid drivers, owned by the same profile as their listener and consent fence. */
export function createRuntimeVoice(deps: RuntimeVoiceDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, deps.cancelNative)
  const handles = new Set<DictationHandle>()
  const check = () => {
    lifetime.check()
    if (!deps.canStart()) throw new Error(UI_TEXT.dictationNotLoaded)
  }
  const deliver = (work: () => void) => {
    try {
      check()
    } catch {
      return
    }
    work()
  }
  const setup = deps.setup
  const dictation: DictationSetup = setup.isAvailable
    ? {
        isAvailable: true,
        create: (listener) => {
          check()
          let isDisposed = false
          const publish = (work: () => void) => {
            if (!isDisposed) deliver(work)
          }
          const owned: DictationListener = {
            onStatus: (status) => {
              publish(() => {
                listener.onStatus(status)
              })
            },
            onText: (text) => {
              publish(() => {
                listener.onText(text)
              })
            },
            onError: (reason) => {
              publish(() => {
                listener.onError(reason)
              })
            },
            onAudio: (pcm) => {
              publish(() => listener.onAudio?.(pcm))
            },
            onStopped: () => {
              publish(() => listener.onStopped?.())
            },
            ...(listener.ownedBudgetScope !== undefined && {
              ownedBudgetScope: () =>
                lifetime.track(async () => await listener.ownedBudgetScope?.()),
            }),
            voiceConsentFence: () => {
              check()
              const fence = listener.voiceConsentFence?.()
              return (digest, isSending) => {
                check()
                fence?.(digest, isSending)
              }
            },
          }
          const driver = setup.create(owned)
          handles.add(driver)
          return {
            start: () => {
              check()
              if (isDisposed) throw new Error(UI_TEXT.dictationNotLoaded)
              driver.start()
            },
            stop: () => {
              driver.stop()
            },
            dispose: () => {
              isDisposed = true
              return driver.dispose()
            },
          }
        },
      }
    : setup
  let closing: Promise<void> | undefined
  return {
    dictation,
    dispose: () => {
      closing ??= (async () => {
        const stopped = lifetime.dispose()
        try {
          const disposing = Array.from(handles, async (driver) => {
            await driver.dispose()
          })
          await stopped
          await Promise.all(disposing)
        } finally {
          handles.clear()
          await deps.drainNative()
        }
      })()
      return closing
    },
  }
}
