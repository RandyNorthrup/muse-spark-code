// The production media bundle's entry (M105 W, D85.13): dist/productionMedia.js.
// The Model API bundle loads it once per host when a storage directory, a
// Files-capable client and an account are all present; activation and the
// runtime load it on a session's first upload save or delete. Neither the
// activation bundle nor dist/modelApi.js carries the replay, the estimator,
// the calibration seeds, the captured codec or the upload ledger. The
// conversion root's lease and crash reclaim (RVMEDIAV3 3) ride here too:
// the audio bundle loads only after this one, and requires it.
//
// The replay assembly below lives here for the same reason (C-M105-8 diet):
// the expiry forwarding resolves on demand inside this bundle, so
// dist/modelApi.js keeps only the one call.
import type { ModelApiClient } from '../../core/backends/modelapi/client'
import type { ModelApiHostDeps } from '../../core/backends/modelapi/ModelApiHost'
import type { MediaReplaySession, ReplayMedia } from '../../core/media/replayMedia'
import {
  attachedOrWorkspaceSource,
  createProductionMediaReplay,
  workspaceMediaSource,
} from '../../core/media/productionMedia'
export {
  attachedOrWorkspaceSource,
  createProductionMediaReplay,
  workspaceMediaSource,
} from '../../core/media/productionMedia'
export { createSessionUploads, openLastAccountUploads } from './sessionUploads'
export { setUiText } from '../../shared/l10n/text'
export { leasePrivateRoot } from '../../runtime/privateRootLease'

/** The host seam the replay assembly reads: everything else stays out. */
export type HostMediaReplayHost = Pick<
  ModelApiHostDeps,
  'getAccountId' | 'log' | 'uploadExpiryDays' | 'workspaceRoot' | 'platform' | 'io'
>

/**
The Model API bundle's `createMediaReplay` over the host seam: the Files
client, the account, the storage directory and the session's replay. The
upload-expiry setting resolves here, on demand, read per upload.
*/
export function createHostMediaReplay(
  host: HostMediaReplayHost,
  filesClient: Pick<ModelApiClient, 'requestFile'>,
  accountId: string,
  directory: string,
  attached: ModelApiHostDeps['attachedMedia'],
  sessionId: string,
  session: MediaReplaySession,
): ReplayMedia {
  return createProductionMediaReplay({
    sessionId,
    client: filesClient,
    accountId,
    currentAccountId: host.getAccountId,
    directory,
    log: host.log,
    ...(host.uploadExpiryDays !== undefined && { expiryDays: host.uploadExpiryDays }),
    ...session,
    source: attachedOrWorkspaceSource(
      attached,
      workspaceMediaSource({
        workspaceRoot: host.workspaceRoot,
        platform: host.platform,
        io: host.io,
      }),
    ),
    ...(attached !== undefined && { attachment: (part) => attached.resolve(part) }),
  })
}
