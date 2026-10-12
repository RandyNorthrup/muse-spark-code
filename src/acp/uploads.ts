// The ACP side of uploaded files (M105 lane F, D85.2): the local `/uploads`
// command over the account ledger. Listing reads; deletion goes through the
// provider's delete call. A foreign file is confirmed through the ACP
// permission request exactly where VS Code asks with its modal dialog, and
// kept with its reason when refused.
import { RequestError } from '@agentclientprotocol/sdk'
import { uploadExpiryText } from '../core/media/uploadedFiles'
import { UI_TEXT } from '../shared/constants'
import { describeError } from '../shared/redact'
import { fill, formatBytes, formatList } from '../shared/l10n/text'
import { uploadedFilesReportSchema, type UploadedFilesReport } from '../shared/media'

export interface AcpUploadsPort {
  read(): Promise<unknown>
  deleteFile(
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<void>
  deleteAllOurs(signal?: AbortSignal): Promise<void>
}

/**
 * One listed file: its number and id are both accepted by
 * `/uploads delete`, so the listing shows what the delete needs.
 */
function rowLine(file: UploadedFilesReport['files'][number], index: number): string {
  const expiry = uploadExpiryText(file.expiresAt)
  const ownership = file.ours ? UI_TEXT.media.filesOurs : UI_TEXT.media.filesOtherApp
  const sessions =
    file.sessions.length === 0
      ? ''
      : ` ${fill(UI_TEXT.media.fileSessions, { sessions: formatList(file.sessions) })}`
  return `- ${String(index + 1)}. ${file.name} (${file.fileId}, ${formatBytes(file.bytes)}, ${ownership}, ${expiry})${sessions}`
}

/** The ledger's files as session text; empty says so. */
export function uploadsText(report: UploadedFilesReport): string {
  return report.files.length === 0
    ? UI_TEXT.media.filesEmpty
    : `${UI_TEXT.media.uploadedFiles}\n${report.files.map((file, index) => rowLine(file, index)).join('\n')}`
}

async function readReport(files: AcpUploadsPort): Promise<UploadedFilesReport> {
  try {
    return uploadedFilesReportSchema.parse(await files.read())
  } catch (error: unknown) {
    throw RequestError.internalError(undefined, describeError(error))
  }
}

/**
 * Runs `/uploads`, `/uploads delete <file>` and `/uploads delete-all`,
 * where `<file>` is the listed file's id or its number. Anything else is
 * ignored for the model turn. With no ledger it says so and deletes
 * nothing; a failed provider delete names its reason and the row stays.
 * A cancelled turn deletes nothing: the signal is checked before the read
 * and again immediately before every destructive dispatch, and it travels
 * into the delete sequence itself.
 */
export async function runUploadsCommand(
  text: string,
  input: {
    readonly files: AcpUploadsPort | undefined
    readonly send: (text: string) => void
    readonly signal?: AbortSignal
    /** Asks whether a file another app may still use may go; absent refuses. */
    readonly confirmForeign?: (name: string) => Promise<boolean>
  },
): Promise<'handled' | 'ignored'> {
  const args = /^\/uploads(?:\s+(.+))?$/su.exec(text.trim())
  if (args === null) return 'ignored'
  const files = input.files
  if (files === undefined) throw RequestError.invalidParams(undefined, UI_TEXT.media.filesEmpty)
  input.signal?.throwIfAborted()
  const rest = args[1]?.trim() ?? ''
  if (rest === '') {
    input.send(uploadsText(await readReport(files)))
    return 'handled'
  }
  if (rest === 'delete-all') {
    input.signal?.throwIfAborted()
    try {
      await files.deleteAllOurs(input.signal)
    } catch (error: unknown) {
      throw RequestError.internalError(undefined, describeError(error))
    }
    input.send(uploadsText(await readReport(files)))
    return 'handled'
  }
  const single = /^delete\s+(\S+)$/su.exec(rest)
  if (single?.[1] === undefined)
    throw RequestError.invalidParams(undefined, UI_TEXT.media.uploadsUsage)
  const selector = single[1]
  const report = await readReport(files)
  // The read awaited above; a cancel that landed during it deletes nothing.
  input.signal?.throwIfAborted()
  // The listing numbers files from one: an id or its listed number deletes.
  const file =
    report.files.find((entry) => entry.fileId === selector) ??
    (/^\d+$/u.test(selector) ? report.files.at(Number(selector) - 1) : undefined)
  if (file === undefined)
    throw RequestError.invalidParams(
      undefined,
      fill(UI_TEXT.media.uploadNotFound, { id: selector }),
    )
  if (!file.ours && !(await (input.confirmForeign?.(file.name) ?? false))) {
    input.send(fill(UI_TEXT.media.uploadForeignKept, { name: file.name }))
    return 'handled'
  }
  // Confirmed above when foreign; a cancel that landed while asking deletes
  // nothing.
  input.signal?.throwIfAborted()
  try {
    await files.deleteFile(file.fileId, () => Promise.resolve(true), input.signal)
  } catch (error: unknown) {
    throw RequestError.invalidParams(
      undefined,
      fill(UI_TEXT.media.uploadDeleteFailed, { name: file.name, reason: describeError(error) }),
    )
  }
  input.send(uploadsText(await readReport(files)))
  return 'handled'
}
