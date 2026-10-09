import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildEnvironment } from '../../../scripts/package-hosts/manifest.mjs'

const mutations = [
  [
    'file response cancellation',
    'hosts/xcode/App/NativeUi.swift',
    '        token.isActive\n      else { return }',
    '        true\n      else { return }',
    'testCancelledFileDialogCannotWriteOrReplyFromALateChoice',
  ],
  [
    'file response ownership',
    'hosts/xcode/App/NativeUi.swift',
    'self.filePanel === panel, self.fileInvocation == invocation,\n        token.isActive',
    'self.filePanel === panel,\n        token.isActive',
    'testClosedFileChoiceCannotWriteOverAReplacementDialog',
  ],
  [
    'file cancellation ownership',
    'hosts/xcode/App/NativeUi.swift',
    'self.filePanel === panel,\n          self.fileInvocation == invocation',
    'self.filePanel === panel',
    'testClosedFileChoiceCannotWriteOverAReplacementDialog',
  ],
  [
    'permission sheet file admission',
    'hosts/xcode/App/NativeUi.swift',
    'guard filePanel == nil, alert == nil, let window = window',
    'guard alert == nil, let window = window',
    'testFileDialogRejectsOverlappingFileAndPermissionSheets',
  ],
  [
    'file sheet admission',
    'hosts/xcode/App/NativeUi.swift',
    'guard alert == nil, filePanel == nil, let window = window',
    'guard alert == nil, let window = window',
    'testFileDialogRejectsOverlappingFileAndPermissionSheets',
  ],
  [
    'file export actually writes',
    'hosts/xcode/App/NativeUi.swift',
    'try text.write(to: url, atomically: true, encoding: .utf8)',
    'try text.write(to: url.appendingPathExtension("wrong-output"), atomically: true, encoding: .utf8)',
    'testFileServicesChooseOpaqueUrisAndWriteTheApprovedExport',
  ],
  [
    'native package star description',
    'hosts/xcode/description.html',
    'Enjoying Muse Spark Code? A star on GitHub helps other people find it.',
    '',
    'testAppAndEditorExtensionPackageTheLinkedStarDescription',
  ],
  [
    'owning fake CLI entry',
    'test/hosts/xcode/fake-runtime.ts',
    'path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)',
    'path.resolve(process.argv[1]) !== fileURLToPath(import.meta.url)',
    'testAuthenticatedPanelRendersAndStopRemainsAvailable',
  ],
  [
    'four native appearance kinds',
    'hosts/xcode/App/PanelModel.swift',
    'if contrast { return dark ? "highContrastDark" : "highContrastLight" }',
    'if contrast { return dark ? "dark" : "light" }',
    'testNativeAppearanceIncludesBothHighContrastKinds',
  ],
  [
    'pending trust metadata',
    'hosts/xcode/App/PanelModel.swift',
    'guard connected || !launcher.isRunning else {',
    'guard connected || !launcher.isRunning else { trusted = value',
    'testTrustCannotDivergeWhileInitializationIsPending',
  ],
  [
    'opaque picker answer',
    'hosts/xcode/App/NativeUi.swift',
    'reply(.success([id]))',
    'reply(.success([String(describing: id)]))',
    'testSinglePickerReturnsTheSelectedOpaqueNumericId',
  ],
  [
    'connection end notification',
    'hosts/xcode/Shared/RuntimeLauncher.swift',
    'exited?()',
    'if child < 0 { exited?() }',
    'testRuntimeEOFEndsTheOwningConnectionAfterLaunch',
  ],
  [
    'snapshot version',
    'hosts/xcode/Shared/MhpSchema.swift',
    'contract["protocol"] as? String == NativeMhp.version,',
    'contract["protocol"] as? String != nil,',
    'testSnapshotVersionIsPinnedBeforeLaunching',
  ],
  [
    'negotiated result',
    'hosts/xcode/Shared/MhpSession.swift',
    'try schema.check(frame, method: "initialize", result: true)',
    '// Deliberate drill: accept an incompatible initialization result.',
    'testLegacyVersionAndRuntimeInitiationAreRefused',
  ],
  [
    'cancelled correlation',
    'hosts/xcode/Shared/MhpSession.swift',
    'guard !closed, pending[key] === token else { return }',
    'guard !closed else { return }',
    'testCancelledServiceLateReplyCannotAffectAnotherRequest',
  ],
  [
    'native admission bound',
    'hosts/xcode/Shared/MhpSession.swift',
    'pending.count < NativeMhp.maximumQueuedMessages',
    'pending.count <= NativeMhp.maximumQueuedMessages',
    'testRequestFaultsPreserveUnrelatedNativeWork',
  ],
  [
    'fresh same-origin link',
    'hosts/xcode/App/PanelWebView.swift',
    'loadedGeneration != model.launchGeneration',
    'loadedOrigin != launch.origin',
    'testSameOriginFreshLaunchReloadsAndOldClearCannotEraseNewLink',
  ],
]
// --core runs every test in NativeCore, without starting the app/UI scheme.
const core = process.argv.includes('--core')
const coreMutations = [
  [
    'cancelled listener startup',
    'hosts/xcode/Shared/NativeChannel.swift',
    'guard !self.finished else {',
    'guard self.finished || !self.finished else {',
    'testCancelledBeforeStartupNeverCreatesACommandListener',
  ],
  [
    'single command listener owner',
    'hosts/xcode/Shared/NativeChannel.swift',
    'guard self.completion == nil else {',
    'guard self.completion == nil || self.completion != nil else {',
    'testRepeatedListenerStartupPreservesTheFirstOwner',
  ],
  [
    'closed command client',
    'hosts/xcode/Shared/NativeChannel.swift',
    'guard !self.stopped else {',
    'guard self.stopped || !self.stopped else {',
    'testClosedClientCannotRestartAnAuthenticatedCommandExchange',
  ],
  [
    'buffer commit admission',
    'hosts/xcode/Shared/MhpSession.swift',
    'guard alive else { throw NativeFailure.cancelled }',
    'guard alive || !alive else { throw NativeFailure.cancelled }',
    'testRetiredCommandCannotCommitAnApprovedBufferReply',
  ],
  [
    'atomic command transaction',
    'hosts/xcode/Shared/MhpSession.swift',
    'func withActive<T>(_ operation: () throws -> T) throws -> T {\n    lock.lock()\n    defer { lock.unlock() }',
    'func withActive<T>(_ operation: () throws -> T) throws -> T {',
    'testCancellationWaitsForAnAlreadyAdmittedCommandTransaction',
  ],
  [
    'navigation line admission',
    'hosts/xcode/Shared/RuntimeLauncher.swift',
    'line > 0, line <= NativeMhp.maximumInteger,',
    'line >= 0, line <= NativeMhp.maximumInteger,',
    'testNavigationResolvesOnlyRegularWorkspaceFiles',
  ],
  [
    'navigation workspace containment',
    'hosts/xcode/Shared/RuntimeLauncher.swift',
    'target.pathComponents.starts(with: root.pathComponents)',
    '!root.pathComponents.isEmpty',
    'testNavigationResolvesOnlyRegularWorkspaceFiles',
  ],
  [
    'navigation regular file',
    'hosts/xcode/Shared/RuntimeLauncher.swift',
    'values.isRegularFile == true',
    'values.isRegularFile != nil',
    'testNavigationResolvesOnlyRegularWorkspaceFiles',
  ],
  [
    'bound window focus',
    'hosts/xcode/App/NativeUi.swift',
    'window?.isKeyWindow == true && applicationActive()',
    'applicationActive()',
    'testFocusRequiresTheBoundWindowAndApplicationActivity',
  ],
  [
    'retired native UI owner',
    'hosts/xcode/App/NativeUi.swift',
    'guard token.isActive else { return }\n    switch method',
    '// Deliberate drill: admit a retired native UI callback.\n    switch method',
    'testCancelledServiceCannotPublishOrAnswerInAnotherOwner',
  ],
  [
    'voice Tab and editor capability admission',
    'hosts/xcode/Shared/MhpSession.swift',
    '!capabilities.contains(definition["capability"] as? String ?? "")',
    'capabilities.isEmpty',
    'testUnadvertisedServiceRefusesBeforeSideEffect',
  ],
  [
    'union type array',
    'hosts/xcode/Shared/MhpSchema.swift',
    'types.contains(where: { matches(value, type: $0) })',
    '!types.isEmpty',
    'testFrozenUnionTypesAndArrayLimitsAreEnforced',
  ],
  [
    'oneOf exclusive union',
    'hosts/xcode/Shared/MhpSchema.swift',
    'alternatives.filter({ (try? validate(value, schema: $0, root: root)) != nil }).count == 1',
    '!alternatives.isEmpty',
    'testFrozenUnionTypesAndArrayLimitsAreEnforced',
  ],
  [
    'array maximum',
    'hosts/xcode/Shared/MhpSchema.swift',
    'values.count > count',
    'values.count < 0 && values.count > count',
    'testFrozenUnionTypesAndArrayLimitsAreEnforced',
  ],
  [
    'panel header validation',
    'hosts/xcode/Shared/MhpSession.swift',
    'try schema.checkPanel(frame, kind: "envelope", headerOnly: true)',
    'if closed { throw NativeFailure.invalid }',
    'testUnboundPanelFaultsDoNotCloseTheCompanionRelay',
  ],
  [
    'panel lifecycle validation',
    'hosts/xcode/Shared/MhpSession.swift',
    'try schema.checkPanel(frame, kind: "lifecycle")',
    'if closed { throw NativeFailure.invalid }',
    'testUnboundPanelFaultsDoNotCloseTheCompanionRelay',
  ],
  [
    'request fault isolation',
    'hosts/xcode/Shared/MhpSession.swift',
    'try refusal(frame, code: "invalidRequest", message: "MHP_DUPLICATE_ID")',
    'if !closed { throw NativeFailure.invalid }',
    'testRequestFaultsPreserveUnrelatedNativeWork',
  ],
  [
    'request id retirement',
    'hosts/xcode/Shared/MhpSession.swift',
    'if retired.count > NativeMhp.maximumQueuedMessages { retired.removeFirst() }',
    '// Deliberate drill: never retire completed ids.',
    'testRequestIdWindowEvictsOnlyCompletedIdsAndRetainsTypedIdentity',
  ],
  [
    'permission error code',
    'hosts/xcode/Shared/MhpSession.swift',
    'case .denied: failure = ("permissionDenied", "MHP_PERMISSION_DENIED")',
    'case .denied: failure = ("unsupportedCapability", "MHP_UNSUPPORTED_CAPABILITY")',
    'testNativeFailuresAndMalformedResultsUseTheFrozenErrorCodes',
  ],
  [
    'native result validation',
    'hosts/xcode/Shared/MhpSession.swift',
    'do { try schema.check(frame, method: method, result: true) } catch {',
    'do { if method.isEmpty { throw NativeFailure.invalid } } catch {',
    'testNativeFailuresAndMalformedResultsUseTheFrozenErrorCodes',
  ],
]
const candidates = core ? coreMutations : mutations
const record = core
  ? 'docs/certification/m104-pf4-core-drills.json'
  : 'docs/certification/m104-pf-native-drills.json'
const requested = core ? process.argv[3] : process.argv[2]
const selected =
  requested === undefined
    ? candidates
    : candidates.filter(([label]) => requested.split(',').includes(label))
assert.ok(selected.length > 0, 'MHP_DRILL_UNKNOWN')
const previous = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : []
const receipt = previous.filter((item) => selected.every(([label]) => label !== item.label))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function prepare() {
  const result = spawnSync(process.execPath, ['hosts/xcode/Scripts/prepare-tests.mjs'], {
    encoding: 'utf8',
    env: buildEnvironment(process.env),
  })
  assert.equal(result.status, 0, 'NATIVE_FIXTURE_BUILD')
}
mkdirSync('temp/m104pf', { recursive: true })
for (const [label, file, before, after, test] of selected) {
  const original = readFileSync(file)
  assert.equal(original.toString().split(before).length, 2, `MHP_DRILL_TARGET:${label}`)
  try {
    writeFileSync(
      file,
      original.toString().replace(before, () => after),
    )
    prepare()
    const output = spawnSync(
      'xcodebuild',
      [
        '-project',
        'hosts/xcode/MuseSpark.xcodeproj',
        '-scheme',
        core ? 'NativeCore' : 'MuseSpark',
        '-configuration',
        'Debug',
        '-derivedDataPath',
        core ? 'temp/m104pf4/DerivedData' : 'temp/m104x/DerivedData',
        '-destination',
        'platform=macOS',
        'test',
        'CODE_SIGN_IDENTITY=-',
      ],
      { encoding: 'utf8', env: buildEnvironment(process.env), maxBuffer: 16 * 1024 * 1024 },
    )
    const log = (output.stdout ?? '') + (output.stderr ?? '')
    writeFileSync(`temp/m104pf/drill-${receipt.length}.log`, log)
    assert.notEqual(output.status, 0, `MHP_DRILL_DID_NOT_FIRE:${label}`)
    assert.ok(log.includes(test) && log.includes('failed'), `MHP_DRILL_WRONG_FAILURE:${label}`)
    receipt.push({ label, file, test, exit: output.status, sha256: digest(original) })
  } finally {
    writeFileSync(file, original)
    assert.equal(digest(readFileSync(file)), digest(original), `MHP_DRILL_RESTORE:${label}`)
    prepare()
  }
  writeFileSync(record, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`${label}: failed as intended; restored byte-exact`)
}
writeFileSync(record, `${JSON.stringify(receipt, null, 2)}\n`)
