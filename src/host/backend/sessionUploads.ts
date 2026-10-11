// The session store's upload-ledger binding (P1, D85.2/D85.6): sessions
// that reference provider uploads save, reopen and delete against the real
// per-account ledger, and deletion/purge releases that session's uploads.
// Both production hosts (extension.ts, runtime/backends.ts) bind the same
// helper, so VS Code and CLI/ACP sessions share one ownership path.
import type { ModelApiClient } from '../../core/backends/modelapi/client'
import { FilesApi, uploadExpirySeconds } from '../../core/backends/modelapi/files'
import {
  accountLedgerDirectory,
  fileUploadLedgerStorage,
} from '../../core/media/uploadLedgerStorage'
import { UploadLedger } from '../../core/media/uploadLedger'
import { MEDIA_PROVIDER_POOL_BYTES } from '../../shared/constants'

export interface SessionUploadsDeps {
  /** The uploads root; each account keeps its own ledger beneath it. */
  readonly uploadLedgerDir: string
  /** The digest of the key in use, or the subscription account; read per use. */
  readonly currentAccountId: () => Promise<string | undefined>
  /** A Files-capable client with the stored key; read per use, never stored. */
  readonly filesClient: () => Pick<ModelApiClient, 'requestFile'>
  /** `museSpark.mediaUploadExpiryDays`, read per use; absent keeps the default. */
  readonly expiryDays?: () => number
  /** Epoch milliseconds. */
  readonly now?: () => number
}

/**
 * The file session store's `uploads` factory over the real provider ledger.
 * The declared ledger also serves the uploaded-files port: an `UploadLedger`
 * is a `SessionUploadLifecycle`.
 */
export function createSessionUploads(
  deps: SessionUploadsDeps,
): (accountId: string) => Promise<UploadLedger> {
  return (accountId: string) =>
    Promise.resolve(
      new UploadLedger({
        storage: fileUploadLedgerStorage(accountLedgerDirectory(deps.uploadLedgerDir, accountId)),
        files: new FilesApi({
          client: deps.filesClient(),
          provider: 'meta',
          // U6c (D85.6): storage is not billed; the upload asks nothing
          // beyond decision 7, like the replay's own Files binding.
          // The setting is read on every upload, never frozen here.
          authorizeUpload: () => Promise.resolve(),
          expirySeconds: () => uploadExpirySeconds(deps.expiryDays?.()),
        }),
        accountId,
        provider: 'meta',
        poolBytes: MEDIA_PROVIDER_POOL_BYTES,
        currentAccountId: deps.currentAccountId,
        now: deps.now ?? (() => Date.now()),
      }),
    )
}
