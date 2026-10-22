// The prompt family's secure file read, shared by the prompt store and the
// sequence store (M88): link-rejecting and identity-checked, so neither
// store drags the other into its bundle.
import { open } from 'node:fs/promises'
import { BOUNDED_FILE_READ_CHUNK_BYTES, UI_TEXT } from '../../shared/constants'
import { lstatIdentity, sameFile } from '../fs/fileIdentity'

/**
Read through one handle at any size; refuse links/directories and never
read credentials. NOLIMITS1FIX: the removed 128 KiB bound was invented —
chunks stream to the end of the file instead.
*/
export async function readPromptFile(file: string): Promise<string> {
  const before = await lstatIdentity(file)
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(UI_TEXT.promptFileInvalid)
  }
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat({ bigint: true })
    if (!sameFile(before, stat)) throw new Error(UI_TEXT.promptFileInvalid)
    const parts: Buffer[] = []
    let position = 0
    for (;;) {
      const chunk = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      position += bytesRead
      parts.push(chunk.subarray(0, bytesRead))
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))
  } finally {
    await handle.close()
  }
}
