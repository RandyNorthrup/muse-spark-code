// The CLI's sign-in against a real child process (PLAN.md D26): the real
// backend manager spawns the fake CLI (fake-muse/serve.mjs) as a short-lived
// experimental host, asks it `account/read` about a credential file whose
// structure cannot say, and signs out through `account/logout`, which leaves
// the file behind, emptied, as Muse Code does. The device sign-in runs
// against the same fake replaying the frames captured live on 1.4.0-R4302.1.
// No token is in any file.

import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { connectAccountSession, logOutAccount, probeAccount } from '../../src/host/auth/accountHost'
import { CliAccount, readCredentialFile } from '../../src/host/auth/cliAccount'
import { runDeviceSignIn } from '../../src/host/auth/deviceSignIn'
import { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import { CAPTURES_FOLDER } from '../unit/helpers/accountLoginCapture'
import {
  AUTH_SET_FILE,
  capturedInlineVerdict,
  DEVICE_LOGIN_FILE,
  LOGOUT_SHELL,
  SHIPPED_PLATFORMS,
  SLACK_CONNECTOR_ONLY,
} from '../unit/helpers/credentialShapes'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import {
  fakeCredentialFile,
  installFakeCredential,
  installFakeMuse,
  removeTestFolders,
  writeFakeCredential,
} from './fakeMuse'

const TEST_TIMEOUT_MS = 30_000
// When the fake CLI sends its captured ending after loginStart.
const ENDING_AFTER_MS = 300
// "At once": well under the 30 s an unanswered account/read would take.
const PROMPT_MS = 5000
// Synthetic: a `meta` entry in a `storage` lane no build was seen writing,
// beside a captured credential key. The structure cannot place it; the fake
// CLI, which starts with any version-1 file, answers from its key.
const UNPLACEABLE = JSON.stringify({
  schema_version: 1,
  providers: { meta: { storage: 'elsewhere', access_token: '<placeholder>' } },
})
// Synthetic: a schema no build has written. Muse Code exits 3 at startup with
// a schema it does not know, as captured for version 2 off macOS.
const FUTURE_SCHEMA = '{"schema_version": 9, "providers": {"meta": {}}}'
// A signal nothing aborts: the window stays open.
const OPEN = new AbortController().signal

const fake = installFakeMuse()
const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'fake-muse-ws-'))
const configHome = installFakeCredential(UNPLACEABLE)
const managers: MuseCodeBackendManager[] = []

function setup(fakeEnvironment: readonly { name: string; value: string }[] = []) {
  const log = new FakeLogOutputChannel()
  const backend = new MuseCodeBackendManager({
    log,
    extensionVersion: '0.0.0-e2e',
    getConfiguredBinaryPath: () => fake.binaryPath,
    // The config home reaches both the CLI and the extension's own look at
    // the file through the documented setting, as a user's would.
    getEnvironmentVariables: () => [
      { name: 'MUSE_FAKE_NODE', value: process.execPath },
      { name: 'MUSE_FAKE_FINGERPRINT', value: EXPECTED_SCHEMA_FINGERPRINT },
      { name: 'XDG_CONFIG_HOME', value: configHome },
      ...fakeEnvironment,
    ],
    workspaceRoot,
    getShellSandbox: () => 'off',
    getSandboxNetwork: () => 'default',
    userProfileDir: undefined,
    isWorkspaceTrusted: () => true,
    getProxySettings: () => ({ proxy: '', noProxy: [] }),
  })
  managers.push(backend)
  const connect = (signal: AbortSignal) =>
    connectAccountSession(backend, '0.0.0-e2e', log, workspaceRoot, signal)
  const probe = vi.fn(() => probeAccount(connect, log, OPEN))
  const account = new CliAccount({
    platform: process.platform,
    credentialFilePath: () => backend.credentialFilePath(),
    probe,
    log,
  })
  return { backend, log, connect, probe, account }
}

function everythingLogged(log: FakeLogOutputChannel): string {
  return [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().join('\n')
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((created) => created.dispose()))
})

afterAll(() => {
  removeTestFolders([fake.installDir, workspaceRoot, configHome])
})

describe('The CLI’s sign-in against a real child process', { timeout: TEST_TIMEOUT_MS }, () => {
  it('asks the CLI once about a file it cannot place, then signs out through account/logout', async () => {
    writeFakeCredential(configHome, UNPLACEABLE)
    const t = setup()
    expect(t.backend.credentialFilePath()).toBe(fakeCredentialFile(configHome))
    await expect(t.account.signIn(true)).resolves.toBe('signedIn')
    await expect(t.account.signIn(false)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledOnce()

    await expect(logOutAccount(t.connect, t.log, OPEN)).resolves.toBe('confirmed')
    // The file stays, emptied, as `muse logout` leaves it; its structure alone
    // now says signed out, and no host is started to say so.
    expect(readFileSync(fakeCredentialFile(configHome), 'utf8')).toBe(LOGOUT_SHELL)
    expect(readCredentialFile(t.backend.credentialFilePath(), process.platform)?.verdict).toBe(
      'empty',
    )
    await expect(t.account.signIn(true)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledOnce()
    expect(everythingLogged(t.log)).not.toContain('person@example.com')
  })

  // Off macOS the captured shape settles it; on macOS, where no such file was
  // captured, the CLI is asked (the review of PR #49).
  it('reads a stored sign-in from the file alone off macOS', async () => {
    writeFakeCredential(configHome, DEVICE_LOGIN_FILE)
    const t = setup()
    await expect(t.account.signIn(true)).resolves.toBe('signedIn')
    expect(t.probe).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 0)
  })

  // The host exits 3 before `initialize`, as Muse Code does with a schema it
  // cannot read: the CLI could not say (the review of PR #49).
  it('answers unknown when the host exits at startup', async () => {
    writeFakeCredential(configHome, FUTURE_SCHEMA)
    const t = setup()
    await expect(t.account.signIn(true)).resolves.toBe('unknown')
    expect(t.probe).toHaveBeenCalledOnce()
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^The Muse Code account host could not start: /),
    )
  })

  // What the fake answers is what the captures answered for each shape.
  it.each([
    ['the muse auth set file', AUTH_SET_FILE, 'apiKey'],
    ['the browser sign-in file', DEVICE_LOGIN_FILE, 'accountLogin'],
    ['the file a sign-out leaves', LOGOUT_SHELL, 'loggedOut'],
  ])('answers account/read about %s as captured', async (_name, contents, state) => {
    writeFakeCredential(configHome, contents)
    const t = setup()
    await expect(probeAccount(t.connect, t.log, OPEN)).resolves.toEqual({
      state,
      credentialRequired: true,
    })
  })

  // Only `meta` speaks for the sign-in (the review of PR #49).
  it('asks the CLI about a file naming another provider alone', async () => {
    writeFakeCredential(configHome, SLACK_CONNECTOR_ONLY)
    const t = setup()
    // A user action, so the CLI is asked on every OS (macOS asks only then).
    await expect(t.account.signIn(true)).resolves.toBe('signedOut')
    expect(t.probe).toHaveBeenCalledOnce()
  })
})

/** A device sign-in from a signed-out home; `fakeEnvironment` scripts the fake CLI. */
function signIn(fakeEnvironment: readonly { name: string; value: string }[], signal: AbortSignal) {
  writeFakeCredential(configHome, LOGOUT_SHELL)
  const t = setup([{ name: 'MUSE_FAKE_CAPTURES', value: CAPTURES_FOLDER }, ...fakeEnvironment])
  // When the code was shown: "at once" is timed from here, not from the
  // spawn, which a slow machine may take seconds over (the review of PR #49).
  const shown = { at: NaN }
  const onCode = vi.fn(() => {
    shown.at = Date.now()
  })
  const outcome = runDeviceSignIn({
    connect: (flowSignal) =>
      connectAccountSession(t.backend, '0.0.0-e2e', t.log, workspaceRoot, flowSignal),
    credentialFileModifiedAt: () => statSync(t.backend.credentialFilePath()).mtimeMs,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    now: Date.now,
    signal,
    onCode,
    log: t.log,
  })
  return { ...t, onCode, outcome, shown }
}

/** The fake sends the named capture's ending, and what came with it, after loginStart. */
function endingAfterStart(name: string): { name: string; value: string }[] {
  return [
    { name: 'MUSE_FAKE_LOGIN_ENDING', value: name },
    { name: 'MUSE_FAKE_LOGIN_ENDING_MS', value: String(ENDING_AFTER_MS) },
  ]
}

// The device sign-in against the fake CLI replaying the frames captured on
// 1.4.0-R4302.1 (test/fixtures/msp; PR #49 P1 and P2).
describe('The device sign-in against a real child process', { timeout: TEST_TIMEOUT_MS }, () => {
  it('ends on the captured expired ending, shown the code as captured', async () => {
    const t = signIn(endingAfterStart('expired'), OPEN)
    await expect(t.outcome).resolves.toBe('expired')
    expect(t.onCode).toHaveBeenCalledWith(
      'https://auth.meta.com/oauth/device/?code=AAAA-AAAA',
      'AAAA-AAAA',
    )
    expect(t.log.info).toHaveBeenCalledWith(
      'Muse Code sign-in ended: expired: the code expired before it was approved',
    )
  })

  it('ends at once on the host’s ending while account/read goes unanswered', async () => {
    const t = signIn(
      [
        { name: 'MUSE_FAKE_ACCOUNT_READ', value: 'silentAfterStart' },
        ...endingAfterStart('expired'),
      ],
      OPEN,
    )
    await expect(t.outcome).resolves.toBe('expired')
    expect(Date.now() - t.shown.at).toBeLessThan(PROMPT_MS)
  })

  // The captured success: the file written, `account/changed`, then
  // `granted` (the review of PR #49).
  it('signs in on the captured granted sequence', async () => {
    const t = signIn(endingAfterStart('granted'), OPEN)
    await expect(t.outcome).resolves.toBe('signedIn')
    // The file the sign-in left, read as each OS reads it: held in it off
    // macOS, the CLI's to say on macOS, where no such file was captured.
    // Every runner checks every OS (the review of PR #49).
    for (const platform of SHIPPED_PLATFORMS) {
      expect(readCredentialFile(t.backend.credentialFilePath(), platform)?.verdict).toBe(
        capturedInlineVerdict(platform),
      )
    }
    expect(t.log.info).toHaveBeenCalledWith('Muse Code sign-in ended: granted')
    expect(everythingLogged(t.log)).not.toContain('person@example.com')
  })

  // The log keeps fixed words; `failed`'s captured message names the
  // credential file's path.
  it.each([
    ['denied', 'the sign-in was denied in the browser'],
    ['failed', 'saving the credential failed'],
  ])('ends on the captured %s, and logs no path', async (outcome, logged) => {
    const t = signIn(endingAfterStart(outcome), OPEN)
    await expect(t.outcome).resolves.toBe(outcome)
    expect(t.log.info).toHaveBeenCalledWith(`Muse Code sign-in ended: ${outcome}: ${logged}`)
    expect(everythingLogged(t.log)).not.toContain('<throwaway>')
  })

  // A host that dies mid-flow fails the sign-in at once (the review of PR #49).
  it('fails at once when the host exits during the flow', async () => {
    const t = signIn([{ name: 'MUSE_FAKE_LOGIN_EXIT_MS', value: String(ENDING_AFTER_MS) }], OPEN)
    await expect(t.outcome).rejects.toThrow('exited')
    expect(Date.now() - t.shown.at).toBeLessThan(PROMPT_MS)
  })

  it('cancels at once while account/read goes unanswered, and the CLI ends its flow', async () => {
    const abort = new AbortController()
    const t = signIn([{ name: 'MUSE_FAKE_ACCOUNT_READ', value: 'silentAfterStart' }], abort.signal)
    await vi.waitFor(
      () => {
        expect(t.onCode).toHaveBeenCalledOnce()
      },
      { timeout: TEST_TIMEOUT_MS },
    )
    const cancelled = Date.now()
    abort.abort()
    await expect(t.outcome).resolves.toBe('cancelled')
    expect(Date.now() - cancelled).toBeLessThan(PROMPT_MS)
    // The captured `cancelled` ending the fake sends before its answer.
    await vi.waitFor(() => {
      expect(t.log.info).toHaveBeenCalledWith('Muse Code sign-in ended: cancelled')
    })
  })
})
