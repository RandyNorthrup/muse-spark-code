// The uploaded-files binding (M105 lane F, D85.2): the conversation port's
// production supplier over the account ledger, and the Delete Uploaded Files
// command behind it. No VS Code import here: the surfaces (webview post,
// modal confirmation, QuickPick) arrive as callbacks, so tests drive this
// module directly and each host binds it thinly.
import { redactSecrets } from '../../core/redact'
import type { UploadLedger } from '../../core/media/uploadLedger'
import { createUploadedFilesPort, type UploadedFilesPort } from '../../core/media/uploadedFiles'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatDateTime } from '../../shared/l10n/text'
import { uploadedFilesReportSchema, type UploadedFilesReport } from '../../shared/media'
import type { ConversationUploadedFilesPort } from './conversationController'

/** External text for the panel: redacted first, since it can carry secrets. */
function describe(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

export interface UploadedFilesBindingDeps {
  /** The account's ledger over the production storage and Files wire. */
  readonly uploads: (accountId: string) => Promise<UploadLedger>
  /** The key digest in use; undefined while no account backs the ledger. */
  readonly getAccountId: () => Promise<string | undefined>
  /** Shows the report on this surface. */
  readonly post: (report: UploadedFilesReport) => void
  /** Asks whether a file another app may still use may go. */
  readonly confirmForeign: (question: string) => Promise<boolean>
}

export interface UploadedFilesBinding {
  readonly port: ConversationUploadedFilesPort
  /** The validated report the command lists. */
  readonly list: () => Promise<UploadedFilesReport>
  readonly remove: UploadedFilesPort['deleteFile']
}

/** The `ConversationDeps.uploadedFiles` supplier, whichever host binds it. */
export function createUploadedFilesBinding(deps: UploadedFilesBindingDeps): UploadedFilesBinding {
  const ledger = async (): Promise<UploadLedger | undefined> => {
    const accountId = await deps.getAccountId()
    return accountId === undefined ? undefined : await deps.uploads(accountId)
  }
  const port = createUploadedFilesPort({
    ledger,
    post: deps.post,
    confirmForeign: deps.confirmForeign,
  })
  return {
    port,
    list: async () => uploadedFilesReportSchema.parse(await port.read()),
    remove: async (fileId, isForeignDeletionConfirmed) => {
      await port.deleteFile(fileId, isForeignDeletionConfirmed)
    },
  }
}

export interface DeleteUploadedFilesPick {
  readonly fileId: string
  readonly label: string
  readonly description: string
}

export interface DeleteUploadedFilesDialogs {
  /** The chosen file ids; undefined when the picker is dismissed. */
  readonly pick: (
    files: readonly DeleteUploadedFilesPick[],
  ) => Promise<readonly string[] | undefined>
  readonly inform: (message: string) => void
  readonly fail: (message: string) => void
}

export interface DeleteUploadedFilesCommandDeps {
  readonly list: () => Promise<UploadedFilesReport>
  readonly remove: (
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
  ) => Promise<void>
  readonly confirmForeign: (question: string) => Promise<boolean>
  readonly dialogs: DeleteUploadedFilesDialogs
}

function pickDescription(file: UploadedFilesReport['files'][number]): string {
  const expiry =
    file.expiresAt === undefined
      ? UI_TEXT.media.fileNoExpiry
      : fill(UI_TEXT.media.fileExpiry, {
          expiry: formatDateTime(file.expiresAt * MILLISECONDS_PER_SECOND),
        })
  return `${formatBytes(file.bytes)} · ${expiry}`
}

/**
 * Delete Uploaded Files: lists the ledger's files and deletes the chosen
 * ones through the provider. An empty or missing ledger says so and deletes
 * nothing; a failed delete names its reason and the row stays.
 */
export async function runDeleteUploadedFilesCommand(
  deps: DeleteUploadedFilesCommandDeps,
): Promise<void> {
  let report: UploadedFilesReport
  try {
    report = await deps.list()
  } catch (error: unknown) {
    deps.dialogs.fail(`${UI_TEXT.usageUnavailable}: ${describe(error)}`)
    return
  }
  if (report.files.length === 0) {
    deps.dialogs.inform(UI_TEXT.media.filesEmpty)
    return
  }
  const names = new Map(report.files.map((file) => [file.fileId, file.name] as const))
  const chosen = await deps.dialogs.pick(
    report.files.map((file) => ({
      fileId: file.fileId,
      label: file.name,
      description: pickDescription(file),
    })),
  )
  if (chosen === undefined) return
  for (const fileId of chosen) {
    const name = names.get(fileId) ?? fileId
    try {
      await deps.remove(fileId, (fileName) =>
        deps.confirmForeign(fill(UI_TEXT.media.otherAppFileConfirmation, { name: fileName })),
      )
    } catch (error: unknown) {
      deps.dialogs.fail(fill(UI_TEXT.media.uploadDeleteFailed, { name, reason: describe(error) }))
    }
  }
}
