// The ACP side of uploaded files (M105 lane F, D85.2): the local `/uploads`
// command over the account ledger. Listing reads; deletion goes through the
// provider's delete call. A foreign file is kept with its reason: this
// single-shot command cannot ask the modal question VS Code asks.
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
  ): Promise<void>
  deleteAllOurs(): Promise<void>
}

function rowLine(file: UploadedFilesReport['files'][number]): string {
  const expiry = uploadExpiryText(file.expiresAt)
  const ownership = file.ours ? UI_TEXT.media.filesOurs : UI_TEXT.media.filesOtherApp
  const sessions =
    file.sessions.length === 0
      ? ''
      : ` ${fill(UI_TEXT.media.fileSessions, { sessions: formatList(file.sessions) })}`
  return `- ${file.name} (${formatBytes(file.bytes)}, ${ownership}, ${expiry})${sessions}`
}

/** The ledger's files as session text; empty says so. */
export function uploadsText(report: UploadedFilesReport): string {
  return report.files.length === 0
    ? UI_TEXT.media.filesEmpty
    : `${UI_TEXT.media.uploadedFiles}\n${report.files.map((file) => rowLine(file)).join('\n')}`
}

async function readReport(files: AcpUploadsPort): Promise<UploadedFilesReport> {
  try {
    return uploadedFilesReportSchema.parse(await files.read())
  } catch (error: unknown) {
    throw RequestError.internalError(undefined, describeError(error))
  }
}

/**
 * Runs `/uploads`, `/uploads delete <file>` and `/uploads delete-all`.
 * Anything else is ignored for the model turn. With no ledger it says so
 * and deletes nothing; a failed provider delete names its reason and the
 * row stays.
 */
export async function runUploadsCommand(
  text: string,
  input: { readonly files: AcpUploadsPort | undefined; readonly send: (text: string) => void },
): Promise<'handled' | 'ignored'> {
  const args = /^\/uploads(?:\s+(.+))?$/su.exec(text.trim())
  if (args === null) return 'ignored'
  const files = input.files
  if (files === undefined) throw RequestError.invalidParams(undefined, UI_TEXT.media.filesEmpty)
  const rest = args[1]?.trim() ?? ''
  if (rest === '') {
    input.send(uploadsText(await readReport(files)))
    return 'handled'
  }
  if (rest === 'delete-all') {
    try {
      await files.deleteAllOurs()
    } catch (error: unknown) {
      throw RequestError.internalError(undefined, describeError(error))
    }
    input.send(uploadsText(await readReport(files)))
    return 'handled'
  }
  const single = /^delete\s+(\S+)$/su.exec(rest)
  if (single?.[1] === undefined)
    throw RequestError.invalidParams(undefined, UI_TEXT.media.uploadsUsage)
  const fileId = single[1]
  const report = await readReport(files)
  const file = report.files.find((entry) => entry.fileId === fileId)
  if (file === undefined)
    throw RequestError.invalidParams(undefined, fill(UI_TEXT.media.uploadNotFound, { id: fileId }))
  if (!file.ours) {
    input.send(fill(UI_TEXT.media.uploadForeignKept, { name: file.name }))
    return 'handled'
  }
  try {
    await files.deleteFile(fileId, () => Promise.resolve(false))
  } catch (error: unknown) {
    throw RequestError.invalidParams(
      undefined,
      fill(UI_TEXT.media.uploadDeleteFailed, { name: file.name, reason: describeError(error) }),
    )
  }
  input.send(uploadsText(await readReport(files)))
  return 'handled'
}
