// The uploaded-files binding (M105 lane F, D85.2): the conversation port's
// production supplier over the account ledger, and the Delete Uploaded Files
// command behind it. It ships in dist/modelApiSessions.js, required when the
// host is first built: the account ledger is the sessions bundle's family,
// and activation keeps only the loader and the types (ACTBUD017). No VS Code
// import here: the surfaces (webview post, modal confirmation, QuickPick)
// arrive as callbacks, so tests drive this module directly and each host
// binds it thinly.
import {
  createUploadedFilesPort,
  uploadExpiryText,
  type UploadedFilesLedger,
  type UploadedFilesPort,
} from '../../core/media/uploadedFiles'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatBytes } from '../../shared/l10n/text'
import { describeError } from '../../shared/redact'
import { uploadedFilesReportSchema, type UploadedFilesReport } from '../../shared/media'

/** What the binding shows: the validated report under the read's identity. */
export interface UploadedFilesStamp {
  readonly report: UploadedFilesReport
  /** The account the stamped read served (last-known while the key is gone). */
  readonly accountId: string | undefined
  /** The binding's read generation: a newer read supersedes an older post. */
  readonly generation: number
}

/** The stamp a read carries: posting it later never borrows a newer read's. */
export interface UploadedFilesReadStamp {
  readonly accountId: string | undefined
  readonly generation: number
}

export interface UploadedFilesBindingDeps {
  /** The account's ledger over the production storage and Files wire. */
  readonly uploads: (accountId: string) => Promise<UploadedFilesLedger>
  /** The last account's ledger once the key is gone (and across restarts). */
  readonly openLastUploads?: () => Promise<UploadedFilesLedger | undefined>
  /** The key digest in use; undefined while no account backs the ledger. */
  readonly getAccountId: () => Promise<string | undefined>
  /** Shows the stamped report on this surface. */
  readonly post: (stamped: UploadedFilesStamp) => void
  /** Asks whether a file another app may still use may go. */
  readonly confirmForeign: (question: string) => Promise<boolean>
}

/** The conversation port with its immutable read stamp (finding 5). */
export interface StampedUploadedFilesPort extends UploadedFilesPort {
  /** Reads the validated report with the stamp its post must carry. */
  readonly readStamped: (signal?: AbortSignal) => Promise<UploadedFilesStamp>
  readonly post: (report: unknown, stamp?: UploadedFilesReadStamp) => void
}

export interface UploadedFilesBinding {
  readonly port: StampedUploadedFilesPort
  /** The validated report the command lists; the signal reaches its cleanup. */
  readonly list: (signal?: AbortSignal) => Promise<UploadedFilesReport>
  readonly remove: UploadedFilesPort['deleteFile']
}

/** The `ConversationDeps.uploadedFiles` supplier, whichever host binds it. */
export function createUploadedFilesBinding(deps: UploadedFilesBindingDeps): UploadedFilesBinding {
  let lastResolvedAccountId: string | undefined
  let readSequence = 0
  let lastRead: UploadedFilesReadStamp | undefined
  const ledger = async (): Promise<UploadedFilesLedger | undefined> => {
    // Removing the key keeps the retained list: the core port serves the
    // last account's ledger read-only (PLAN D85.2) until another signs in.
    // Across a restart the opener recovers the last account's persisted
    // ledger, so the list survives more than the port's lifetime.
    const accountId = await deps.getAccountId()
    lastResolvedAccountId = accountId
    return accountId === undefined ? await deps.openLastUploads?.() : await deps.uploads(accountId)
  }
  const inner = createUploadedFilesPort({
    ledger,
    confirmForeign: deps.confirmForeign,
  })
  const readStamped = async (signal?: AbortSignal): Promise<UploadedFilesStamp> => {
    // Stamped at the start and never mutated: an older read that lands
    // later posts its own smaller generation, and the reducer drops it.
    // The account is captured before the read awaits (round 4, P3-5): a
    // read for A that lands after B resolved keeps A's stamp, so the
    // controller's generation check sees the read it started.
    const generation = readSequence + 1
    readSequence = generation
    const accountAtStart = await deps.getAccountId()
    const report = uploadedFilesReportSchema.parse(await inner.read(signal))
    const stamp: UploadedFilesReadStamp = { accountId: accountAtStart, generation }
    lastRead = stamp
    return { report, ...stamp }
  }
  const port: StampedUploadedFilesPort = {
    ...inner,
    readStamped,
    read: async (signal?: AbortSignal) => {
      const stamped = await readStamped(signal)
      return stamped.report
    },
    post: (report: unknown, stamp?: UploadedFilesReadStamp) => {
      const validated = uploadedFilesReportSchema.parse(report)
      deps.post({
        report: validated,
        accountId: stamp?.accountId ?? lastRead?.accountId ?? lastResolvedAccountId,
        generation: stamp?.generation ?? lastRead?.generation ?? 0,
      })
    },
  }
  return {
    port,
    list: async (signal?: AbortSignal) => uploadedFilesReportSchema.parse(await port.read(signal)),
    remove: async (fileId, isForeignDeletionConfirmed, signal) => {
      await port.deleteFile(fileId, isForeignDeletionConfirmed, signal)
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
  /** The listing carries the turn's signal, so its cleanup deletes nothing after a cancel. */
  readonly list: (signal?: AbortSignal) => Promise<UploadedFilesReport>
  readonly remove: (
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
    signal?: AbortSignal,
  ) => Promise<void>
  readonly confirmForeign: (question: string) => Promise<boolean>
  readonly dialogs: DeleteUploadedFilesDialogs
  /** A cancelled pick or turn deletes nothing: checked after every await. */
  readonly signal?: AbortSignal
}

function pickDescription(file: UploadedFilesReport['files'][number]): string {
  return `${formatBytes(file.bytes)} · ${uploadExpiryText(file.expiresAt)}`
}

/**
 * Delete Uploaded Files: lists the ledger's files and deletes the chosen
 * ones through the provider. An empty or missing ledger says so and deletes
 * nothing; a failed delete names its reason and the row stays.
 */
export async function runDeleteUploadedFilesCommand(
  deps: DeleteUploadedFilesCommandDeps,
): Promise<void> {
  deps.signal?.throwIfAborted()
  let report: UploadedFilesReport
  try {
    report = await deps.list(deps.signal)
  } catch (error: unknown) {
    deps.dialogs.fail(`${UI_TEXT.usageUnavailable}: ${describeError(error)}`)
    return
  }
  deps.signal?.throwIfAborted()
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
  deps.signal?.throwIfAborted()
  for (const fileId of chosen) {
    // A cancel that landed during the pick or the previous delete stops here.
    deps.signal?.throwIfAborted()
    const name = names.get(fileId) ?? fileId
    try {
      await deps.remove(
        fileId,
        (fileName) =>
          deps.confirmForeign(fill(UI_TEXT.media.otherAppFileConfirmation, { name: fileName })),
        deps.signal,
      )
    } catch (error: unknown) {
      deps.dialogs.fail(
        fill(UI_TEXT.media.uploadDeleteFailed, { name, reason: describeError(error) }),
      )
    }
  }
}
