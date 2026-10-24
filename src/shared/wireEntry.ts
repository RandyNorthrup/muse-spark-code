// Node consumers share the existing boundary schemas. Browser and integration
// bundles retain their own copy; no protocol shape or parser is changed.
// protocol.ts is shared by name: the MHP panel's raw message schemas
// (`webviewToHostMessageSchema`, `hostToWebviewMessageSchema`, M104 D226)
// stay out of dist/wire.js until a Node bundle reads them, so the shared
// bundle does not grow for the native-host JSON Schema generator alone.
// test/unit/wireEntry.test.ts pins this list against protocol.ts.
export {
  BACKEND_KINDS,
  HOST_ACTIONS,
  NOTICE_ACTIONS,
  NOTICE_LEVELS,
  SIGN_IN_METHODS,
  bookmarkRecordSchema,
  chatReferenceSchema,
  installTeamProtocolSchemas,
  isEstimatorHostMessage,
  isEstimatorWebviewMessage,
  parseHostToWebviewMessage,
  parsePersistedState,
  parseWebviewToHostMessage,
  parseWith,
  reportEventRefSchema,
  reportWebviewErrorSchema,
  settingsSnapshotShape,
} from './protocol'
export * from './agentEvents'
export * from './scheduleProtocol'
// CAPS017: schemas the protocol above already carries; every lazy Node bundle
// required its own copy (scheduleV2 alone, 9.4 KiB, in six bundles).
export * from './scheduleV2'
export * from './scheduleEvents'
export * from './schedule'
export * from './media'
export * from './questions'
