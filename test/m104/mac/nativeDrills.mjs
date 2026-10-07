import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildEnvironment } from '../../../scripts/package-hosts/manifest.mjs'

const mutations = [
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
    'testDuplicateIdsInvalidCallsAndQueueOverflowCancelNativeWork',
  ],
  [
    'fresh same-origin link',
    'hosts/xcode/App/PanelWebView.swift',
    'loadedGeneration != model.launchGeneration',
    'loadedOrigin != launch.origin',
    'testSameOriginFreshLaunchReloadsAndOldClearCannotEraseNewLink',
  ],
]
const record = 'docs/certification/m104-pf-native-drills.json'
const selected =
  process.argv[2] === undefined
    ? mutations
    : mutations.filter(([label]) => label === process.argv[2])
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
        'MuseSpark',
        '-configuration',
        'Debug',
        '-derivedDataPath',
        'temp/m104x/DerivedData',
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
  console.log(`${label}: failed as intended; restored byte-exact`)
}
writeFileSync(record, `${JSON.stringify(receipt, null, 2)}\n`)
