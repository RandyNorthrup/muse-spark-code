import { afterAll, beforeAll, describe, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { DICTATION_HELPER_DIR, darwinDictationHelperSegments } from '../../../src/shared/constants'
import { shouldSkipPosixBrokerSuite } from '../helpers/vault/socketFit'
import { vaultPeerExecutable } from '../../../src/runtime/vault/posixNative'
import { startPosixPanelFixture, type PosixPanelFixture } from '../helpers/vault/posixPanelFixture'
import { drivePanelFlow } from '../helpers/vault/panelFlowDriver'

// The vault exactly as the Models & Agents panel drives it on macOS and
// Linux (the flow itself lives in the shared panel-flow driver): the real
// broker the real client platform launches, set up, unlocked, added to
// through the native editor's own code, written and read back as a
// first-party row, locked, unlocked and read again. One variant runs with
// the working folder at the filesystem root: VS Code started from the Dock
// keeps `/` as the extension host's working folder, so the governed
// launches behind the broker must work with it. The client gets the
// environment an editor host really has (HOME, TMPDIR, XDG_RUNTIME_DIR
// where set): the suite inherits them, and the broker inherits them from
// the client platform the way the extension host hands them down.
const fixture = { current: undefined as PosixPanelFixture | undefined }
// A genuinely long operation keeps its named timeout with its reason: the
// repository's default is 5 s per test, while the whole flow (broker
// launch, keychain wrap, first use of each fresh helper through the
// governor) takes minutes on a busy rig.
const TEST_TIMEOUT_MS = 300_000

describe.skipIf(shouldSkipPosixBrokerSuite())('POSIX vault through the panel', () => {
  // The native helper builds and broker starts take as long as the machine
  // needs (a slow hosted Windows runner passed the 30 s hook budget, PR #258):
  // no time limit of ours on this setup (owner 2026-10-16).
  beforeAll(async () => {
    fixture.current = await startPosixPanelFixture('vs-ppanel-')
    // One-time OS costs belong in hooks, never in a case: the first exec
    // of each fresh helper binary pays macOS trust evaluation, so warm
    // both here without the governor (raw exec, like the session suites)
    // so no case races that cost against the test timeout.
    execFileSync(vaultPeerExecutable(fixture.current.root), ['identity', String(process.pid)], {
      stdio: 'ignore',
    })
    if (process.platform === 'darwin')
      execFileSync(
        path.join(
          fixture.current.root,
          DICTATION_HELPER_DIR,
          ...darwinDictationHelperSegments(process.arch),
        ),
        ['proc-identity', String(process.pid)],
        { stdio: 'ignore' },
      )
  }, 0)
  afterAll(async () => {
    await fixture.current?.dispose()
  })

  it(
    'sets up, unlocks, adds, reads back, locks and unlocks again through the real broker',
    async () => {
      const current = fixture.current
      if (!current) throw new Error('the client platform did not build')
      const client = await current.startClient('panel')
      try {
        await drivePanelFlow(
          { home: path.join(client.dataDir, 'home'), connect: client.connect },
          process.cwd(),
          'panel',
        )
      } finally {
        await client.dispose()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'works with the extension host working folder at the filesystem root',
    async () => {
      const current = fixture.current
      if (!current) throw new Error('the client platform did not build')
      const client = await current.startClient('panel-root')
      try {
        await drivePanelFlow(
          { home: path.join(client.dataDir, 'home'), connect: client.connect },
          '/',
          'panel-root',
        )
      } finally {
        await client.dispose()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
