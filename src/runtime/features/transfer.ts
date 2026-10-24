// Exporting a conversation and importing one in the runtime panel (M104 lane B;
// M30, M84): the files go through the editor's own dialogs (MHP `ui/saveText`,
// `ui/openFile`), which choose where a file is written and ask the person;
// the runtime reads a file the person picked, whole, from the path the editor
// names. The portable export's preview is a file of the data folder that the
// editor opens before the person decides what to save, so a secret in a
// shape the redactor does not know can still be seen first.
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { handleIdentity, sameFile, statIdentity } from '../../core/fs/fileIdentity'
import type {
  ConversationExports,
  ExportPreviewChoice,
} from '../../host/conversation/exportConversation'
import type { SessionTransferFiles } from '../../host/conversation/sessionImport'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import { unavailable } from './unavailable'

export interface RuntimeTransferDeps {
  readonly host: HostServices
  readonly workspaceRoot: string
  /** The data folder: the preview file is kept under it until the person has chosen. */
  readonly dataFolder: string
  readonly signal: AbortSignal
  readonly log: Logger
}

/** The picked file's text, whole: a regular file, the same one before and after it was opened. */
async function readPickedText(file: string): Promise<string> {
  const canonical = await realpath(file)
  const handle = await open(canonical, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const info = await handleIdentity(handle)
    if (!info.isFile() || !sameFile(await statIdentity(await realpath(file)), info))
      throw new Error(UI_TEXT.transferFileMissing)
    const bytes = await handle.readFile()
    try {
      // Invalid UTF-8 is refused rather than read as replacement characters.
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (error: unknown) {
      // NARROW: bytes that are not UTF-8 are the person's file being wrong; anything else is ours.
      if (error instanceof TypeError) throw new Error(UI_TEXT.textFileInvalid, { cause: error })
      throw error
    }
  } finally {
    await handle.close()
  }
}

export interface RuntimeTransfer {
  readonly exports: ConversationExports
  readonly transferFiles: SessionTransferFiles
  /** Removes the preview files this owner wrote. */
  dispose(): Promise<void>
}

export function createRuntimeTransfer(deps: RuntimeTransferDeps): RuntimeTransfer {
  const { host, log } = deps
  const previewFolder = path.join(deps.dataFolder, 'panel-exports', randomUUID())
  const didSave = async (title: string, suggestedName: string, text: string): Promise<boolean> =>
    await host.request('ui/saveText', { title, suggestedName, text }, deps.signal)
  return {
    exports: {
      saveMarkdown: async (fileName, content) => {
        if (await didSave(UI_TEXT.exportPreviewTitle, fileName, content))
          log.info('Exported the conversation')
      },
      saveJson: async (fileName, content) => {
        if (await didSave(UI_TEXT.exportPreviewTitle, fileName, content))
          log.info('Exported the session as JSON')
      },
      // The session log is written by Muse Code itself to a path; this editor's
      // dialog hands the runtime text, not a path.
      saveSessionLog: () => unavailable(),
      previewExport: async ({ fileName, content, detail }): Promise<ExportPreviewChoice> => {
        const file = path.join(previewFolder, fileName)
        await mkdir(previewFolder, { recursive: true, mode: 0o700 })
        await writeFile(file, content, { mode: 0o600 })
        await host.request('editor/open', { uri: pathToFileURL(file).href }, deps.signal)
        const redacted = 'redacted'
        const full = 'full'
        const choice = await host.request(
          'ui/confirm',
          {
            title: UI_TEXT.exportPreviewTitle,
            message: detail,
            choices: [
              { id: redacted, title: UI_TEXT.exportPreviewRedacted },
              { id: full, title: UI_TEXT.exportPreviewFull },
            ],
          },
          deps.signal,
        )
        await rm(file, { force: true })
        if (choice === full) return 'full'
        return choice === redacted ? 'redacted' : 'dismissed'
      },
      localRoots: () => [deps.workspaceRoot, homedir()],
    },
    transferFiles: {
      pickTransferFile: async (title) => {
        const picked = await host.request('ui/openFile', { title }, deps.signal)
        if (picked === null) return { kind: 'dismissed' }
        if (!picked.startsWith('file:')) throw new Error(UI_TEXT.transferLocalFileOnly)
        return { kind: 'read', content: await readPickedText(fileURLToPath(picked)) }
      },
      confirmImport: async (title, detail) => {
        const accept = 1
        return (
          (await host.request(
            'ui/confirm',
            {
              title,
              message: detail,
              choices: [{ id: accept, title: UI_TEXT.importConfirmAction }],
            },
            deps.signal,
          )) === accept
        )
      },
    },
    dispose: async () => {
      await rm(previewFolder, { recursive: true, force: true })
    },
  }
}
