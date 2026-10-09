// The production media bundle's entry (M105 W, D85.13): dist/productionMedia.js.
// The Model API bundle loads it once per host when a storage directory, a
// Files-capable client and an account are all present; activation and the
// runtime load it on a session's first upload save or delete. Neither the
// activation bundle nor dist/modelApi.js carries the replay, the estimator,
// the calibration seeds, the captured codec or the upload ledger. The
// conversion root's lease and crash reclaim (RVMEDIAV3 3) ride here too:
// the audio bundle loads only after this one, and requires it.
export {
  attachedOrWorkspaceSource,
  createProductionMediaReplay,
  workspaceMediaSource,
} from '../../core/media/productionMedia'
export { createSessionUploads } from './sessionUploads'
export { setUiText } from '../../shared/l10n/text'
export { leasePrivateRoot } from '../../runtime/privateRootLease'
