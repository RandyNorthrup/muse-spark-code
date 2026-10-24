// Node consumers share the existing boundary schemas. Browser and integration
// bundles retain their own copy; no protocol shape or parser is changed.
// protocol.ts is shared by name, every export of it: the MHP panel's raw
// message schemas (`webviewToHostMessageSchema`, `hostToWebviewMessageSchema`,
// D226) joined when the runtime panel (dist/runtimePanel.js, M104 lane B)
// became the first Node bundle to read them through src/shared/hostApi/panel.ts.
// test/unit/wireEntry.test.ts pins this list against protocol.ts.
export {
  BACKEND_KINDS,
  HOST_ACTIONS,
  NOTICE_ACTIONS,
  NOTICE_LEVELS,
  SIGN_IN_METHODS,
  bookmarkRecordSchema,
  chatReferenceSchema,
  hostToWebviewMessageSchema,
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
  webviewToHostMessageSchema,
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
