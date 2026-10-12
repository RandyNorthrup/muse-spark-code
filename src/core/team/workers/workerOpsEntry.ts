// First-use worker operations beside the file adapter. Grant authority remains in teamHost.js.
export {
  cleanupCreated,
  countMissingFolders,
  forgetCreated,
  installSweepText,
  mapNativeError,
  nativeOperation,
  parseWorkerReceipt,
  processTeamGit,
  recordCreated,
  sweepAbandonedReservations,
  trackCreated,
  typedCreateError,
  CREATE_ERRNOS,
} from './workerOps'
