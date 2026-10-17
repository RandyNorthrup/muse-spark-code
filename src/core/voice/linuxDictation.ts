import { Dictation, type DictationDeps, type DictationHandle } from './dictation'
import { LinuxDictationHelper, type LinuxHelperDeps } from './linuxHelper'
import { LinuxDictationModel, type LinuxModelDeps } from './linuxModel'
import { LINUX_DICTATION, UI_TEXT } from '../../shared/constants'

export interface LinuxDictationDeps extends DictationDeps {
  readonly model: LinuxModelDeps
  readonly helper: LinuxHelperDeps
  readonly isEnabled: () => boolean
}

/** Consent/acquisition can be cancelled before any capture process exists. */
export class LinuxDictation implements DictationHandle {
  private driver: Dictation | undefined
  private pending: Promise<void> | undefined
  private preparation: AbortController | undefined
  private isActive = false
  private isDisposed = false
  private isStartWanted = false

  public constructor(private readonly deps: LinuxDictationDeps) {}

  public start(): void {
    if (this.isDisposed || this.isActive) return
    if (!this.deps.isEnabled()) {
      // No claim about the files: disabling launches cleanup elsewhere and
      // its outcome is unknown here (RVCM9LNX P3).
      this.deps.listener.onError(UI_TEXT.linuxDictationDisabled)
      return
    }
    if (this.pending !== undefined) {
      if (this.preparation?.signal.aborted) this.isStartWanted = true
      return
    }
    this.isStartWanted = false
    const preparation = new AbortController()
    this.preparation = preparation
    const signal = AbortSignal.any([
      preparation.signal,
      AbortSignal.timeout(LINUX_DICTATION.timeoutMs),
    ])
    this.deps.listener.onStatus('starting')
    this.pending = (async () => {
      try {
        // One card for both downloads: the first consent answer covers the
        // helper and the model for this press (PLAN.md D140).
        let granted: boolean | undefined
        const canDownload = async (child: AbortSignal): Promise<boolean> => {
          granted ??= await this.deps.model.consent(child)
          return granted
        }
        const isCancelled = (): boolean =>
          signal.aborted || this.isDisposed || !this.deps.isEnabled()
        const helper = await new LinuxDictationHelper({
          ...this.deps.helper,
          consent: canDownload,
        }).ensure(signal)
        if (isCancelled()) return
        if (helper === undefined) {
          this.deps.listener.onStatus('idle')
          return
        }
        const model = await new LinuxDictationModel({
          ...this.deps.model,
          consent: canDownload,
        }).ensure(signal)
        if (isCancelled()) return
        if (model === undefined) {
          this.deps.listener.onStatus('idle')
          return
        }
        this.driver ??= new Dictation({
          ...this.deps,
          listener: {
            ...this.deps.listener,
            onStatus: (status) => {
              this.isActive = status !== 'idle'
              this.deps.listener.onStatus(status)
            },
            onText: (text) => {
              this.deps.listener.onText(text.trim())
            },
            onError: (code) => {
              this.deps.listener.onError(`${UI_TEXT.linuxDictationFailed}: ${code}`)
            },
          },
        })
        this.driver.start()
      } catch (error: unknown) {
        this.deps.listener.onStatus('idle')
        if (!preparation.signal.aborted && !this.isDisposed)
          this.deps.listener.onError(
            error instanceof Error &&
              [UI_TEXT.linuxDictationIntegrity, UI_TEXT.linuxDictationBusy].includes(error.message)
              ? error.message
              : UI_TEXT.linuxDictationDownloadFailed,
          )
      } finally {
        this.pending = undefined
        this.preparation = undefined
        if (this.isStartWanted && !this.isDisposed) this.start()
      }
    })()
  }

  public stop(): void {
    this.isStartWanted = false
    if (this.preparation !== undefined) {
      this.preparation.abort()
      this.deps.listener.onStatus('idle')
    }
    this.driver?.stop()
  }

  public async reset(): Promise<void> {
    this.stop()
    await this.driver?.dispose()
    this.driver = undefined
    this.isActive = false
    await this.pending
  }

  public dispose(): void {
    this.isDisposed = true
    this.stop()
    void this.driver?.dispose()
    this.driver = undefined
  }
}
