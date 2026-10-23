// M105 RLF-RECORDING: the recording drivers' shared file inspector. The
// Windows, macOS and Linux factories inspect their finished file with M1's
// bounded sniffer, never inferred from the filename or helper output. The
// caller's language is installed before the sniff, so the refusal it reads
// is the installed one (PLAN.md D33).
import { open } from 'node:fs/promises'
import { sniffMedia } from '../../core/media/limits'
import type { MediaInfo } from '../../shared/media'
import { setUiText } from '../../shared/l10n/text'
import type { UiTable } from '../l10n'

/** M1's bounded byte sniffer over a finished recording file. */
export async function inspectRecordingFile(file: string, l10n: UiTable): Promise<MediaInfo> {
  setUiText(l10n.table, l10n.locale)
  const handle = await open(file, 'r')
  try {
    const fileInfo = await handle.stat()
    const sniffed = await sniffMedia({
      sizeBytes: fileInfo.size,
      read: async (offset, length) => {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
      },
    })
    if (!sniffed.ok) throw new Error(sniffed.reason)
    return sniffed.info
  } finally {
    await handle.close()
  }
}
