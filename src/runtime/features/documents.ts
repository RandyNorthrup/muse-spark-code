// Text the editor shows in a tab of its own (M104 lane B): a tool row's full
// output, opened from the chat. MHP opens files, so the text is written to a
// file of the data folder (private to the person, one folder per panel
// connection) and the editor opens it; the folder goes when the connection ends.
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HostServices } from '../../shared/hostApi/methods'

/**
Longest file name stem kept: file systems cap a name at 255 bytes (ext4, NTFS,
APFS), a character takes up to four, and ".txt" follows.
*/
const NAME_STEM_MAX_CHARS = 60

/** A title as a file name: letters, digits and a few marks, anything else an underscore. */
function fileNameOf(title: string): string {
  const stem = title
    .replaceAll(/[^\p{L}\p{N} ._()-]/gu, '_')
    .slice(0, NAME_STEM_MAX_CHARS)
    .replace(/[. ]+$/u, '')
  return `${stem === '' ? 'output' : stem}.txt`
}

export interface RuntimeDocumentsDeps {
  readonly host: HostServices
  /** The data folder: the documents are kept under it until the connection ends. */
  readonly dataFolder: string
  /** Ends with the connection. */
  readonly signal: AbortSignal
}

export interface RuntimeDocuments {
  /** Shows `content` in a tab of the editor, named for `title`. */
  open(title: string, content: string): Promise<void>
  /** Removes the files this connection wrote. */
  dispose(): Promise<void>
}

export function createRuntimeDocuments(deps: RuntimeDocumentsDeps): RuntimeDocuments {
  const folder = path.join(deps.dataFolder, 'panel-documents', randomUUID())
  return {
    open: async (title, content) => {
      const file = path.join(folder, randomUUID(), fileNameOf(title))
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(file, content, { mode: 0o600 })
      await deps.host.request('editor/open', { uri: pathToFileURL(file).href }, deps.signal)
    },
    dispose: async () => {
      await rm(folder, { recursive: true, force: true })
    },
  }
}
