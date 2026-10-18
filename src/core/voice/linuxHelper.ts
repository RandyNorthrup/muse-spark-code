import path from 'node:path'
import { UI_TEXT } from '../../shared/constants'
import { LINUX_DICTATION } from '../../shared/linuxDictationConstants'
import {
  hasLinuxHelperPins,
  linuxHelperPins,
  linuxHelperUrl,
  type LinuxHelperFilePin,
} from '../../shared/linuxHelperPins'
import { PinnedFileDownload } from './linuxModel'

export interface LinuxHelperDeps {
  readonly directory: string
  readonly fetch: typeof fetch
  readonly consent: (signal: AbortSignal) => Promise<boolean>
  readonly arch: string
  /** Injected in tests; the release build's embedded pins otherwise. */
  readonly pins?: readonly LinuxHelperFilePin[]
}

/**
 * The native recogniser helper, downloaded after the same consent as the
 * model (PLAN.md D140): every file travels the shared pinned path, so a
 * digest mismatch, a partial file or a swapped file refuses exactly like a
 * corrupt model. Installed files are re-hashed before every start and the
 * binary keeps owner-only execute permissions; nothing runs unchecked.
 */
export class LinuxDictationHelper {
  private readonly pins: readonly LinuxHelperFilePin[]
  public readonly helperPath: string

  public constructor(private readonly deps: LinuxHelperDeps) {
    this.pins = deps.pins ?? linuxHelperPins(deps.arch) ?? []
    this.helperPath = path.join(deps.directory, LINUX_DICTATION.helperBinary)
  }

  private download(pin: LinuxHelperFilePin): PinnedFileDownload {
    return new PinnedFileDownload(this.deps, {
      file: pin.file,
      partial: `${pin.file}.partial`,
      bytes: pin.bytes,
      sha256: pin.sha256,
      url: linuxHelperUrl(pin),
      mode: pin.isExecutable ? LINUX_DICTATION.helperMode : LINUX_DICTATION.fileMode,
    })
  }

  public async ensure(signal: AbortSignal): Promise<string | undefined> {
    // Unset pins (a build without the release helpers) refuse before the
    // consent card: there is nothing trustworthy to ask about.
    if (!hasLinuxHelperPins(this.pins)) throw new Error(UI_TEXT.linuxDictationDownloadFailed)
    let granted: boolean | undefined
    const canDownload = async (child: AbortSignal): Promise<boolean> => {
      granted ??= await this.deps.consent(child)
      return granted
    }
    for (const pin of this.pins) {
      signal.throwIfAborted()
      if ((await this.download(pin).ensure(canDownload, signal)) === undefined) return undefined
    }
    return this.helperPath
  }

  public async remove(): Promise<void> {
    for (const pin of this.pins) await this.download(pin).remove()
  }
}
