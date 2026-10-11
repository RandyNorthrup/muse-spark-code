// The uploaded-files port's production supplier (M105 lane F, D85.2): one
// core factory over the per-account upload ledger, bound thinly by each
// host. VS Code posts the report to its usage surface and confirms foreign
// deletions with a modal; the runtime answers through ACP. A missing ledger
// (no storage, no account) reads as an empty read-only report and deletes
// nothing; it never throws, so the command says so instead.
import { MEDIA_PROVIDER_POOL_BYTES, MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import { uploadedFilesReportSchema, type UploadedFilesReport } from '../../shared/media'
import type { UploadLedger } from './uploadLedger'

/** The ledger surface the uploaded-files port reads and deletes through. */
export type UploadedFilesLedger = Pick<
  UploadLedger,
  'accountReport' | 'deleteFile' | 'deleteAllOurs'
>

export interface UploadedFilesPortDeps {
  /** The current account's ledger; undefined while there is none. */
  readonly ledger: () => Promise<UploadedFilesLedger | undefined>
  /** Shows the report on this surface; absent drops it (a text surface answers itself). */
  readonly post?: (report: UploadedFilesReport) => void
  /** Asks whether a file another app may still use may go; absent refuses. */
  readonly confirmForeign?: (question: string) => Promise<boolean>
}

export interface UploadedFilesPort {
  read(): Promise<unknown>
  /** Validates before showing: a byte-bearing or extra-key payload throws. */
  post(report: unknown): void
  deleteFile(
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
  ): Promise<void>
  deleteAllOurs(): Promise<void>
  confirmForeign(question: string): Promise<boolean>
}

/** One file's expiry in words, shared by every surface listing the ledger. */
export function uploadExpiryText(expiresAt: number | undefined): string {
  return expiresAt === undefined
    ? UI_TEXT.media.fileNoExpiry
    : fill(UI_TEXT.media.fileExpiry, {
        expiry: formatDateTime(expiresAt * MILLISECONDS_PER_SECOND),
      })
}

/** The empty report a missing ledger reads as: nothing listed, nothing deletable. */
export function emptyUploadedFilesReport(): UploadedFilesReport {
  return uploadedFilesReportSchema.parse({
    provider: 'meta',
    isReadOnly: true,
    poolBytes: MEDIA_PROVIDER_POOL_BYTES,
    usedBytes: 0,
    files: [],
  })
}

/** The ledger behind `ConversationDeps.uploadedFiles`, whichever host binds it. */
export function createUploadedFilesPort(deps: UploadedFilesPortDeps): UploadedFilesPort {
  return {
    async read(): Promise<unknown> {
      const ledger = await deps.ledger()
      return ledger === undefined ? emptyUploadedFilesReport() : await ledger.accountReport()
    },
    post(report: unknown): void {
      deps.post?.(uploadedFilesReportSchema.parse(report))
    },
    async deleteFile(
      fileId: string,
      isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
    ): Promise<void> {
      const ledger = await deps.ledger()
      if (ledger === undefined) return
      await ledger.deleteFile(fileId, isForeignDeletionConfirmed)
    },
    async deleteAllOurs(): Promise<void> {
      const ledger = await deps.ledger()
      if (ledger === undefined) return
      await ledger.deleteAllOurs()
    },
    async confirmForeign(question: string): Promise<boolean> {
      return (await deps.confirmForeign?.(question)) === true
    },
  }
}
