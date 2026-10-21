// Close-time background reconciliation outcomes against the real native OS
// entry, inside the real Extension Development Host: the coordinator, the
// consent store and the production entry
// (test/unit/helpers/schedules/realBackgroundEntry.ts) are all the real
// modules; the recorder forwards every call and only observes it. The
// suite binds the real resource governor in its own bundle through the
// real configureResources, with the same settings shape activation uses:
// admission state is per bundle, so activating the extension alone leaves
// this bundle's copy of the entry's process runner unbound.
//
// These tests need a machine user bus (launchd on macOS, systemd --user on
// Linux, the Task Scheduler on Windows): entry.remove() really asks the OS
// whether our entry exists. The register row never creates a genuine OS
// entry anywhere: on darwin/linux the real entry refuses the unverified
// launcher before any OS write (no POSIX verifier is wired in engine.ts),
// and on Windows the same call would create a real scheduled task, so that
// row is gated out there.
import * as assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { configureResources } from '../../src/core/resources/admission'
import { jobSourceReader } from '../../src/host/backend/jobSource'
import { sealedMcpJobExecutable } from '../../src/host/backend/mcpJobExecutable'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { createLogger } from '../../src/host/logger'
import {
  EXTENSION_QUALIFIED_ID,
  SETTINGS_SECTION,
  darwinDictationHelperSegments,
} from '../../src/shared/constants'
import {
  realBackgroundHarness,
  saveBackgroundConsent,
} from '../unit/helpers/schedules/realBackgroundEntry'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const NOW = 1_700_000_000_000
const WAKE = 1_700_000_100_000

async function coordinator(nextWake: number | undefined) {
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-background-host-'))
  return { ...realBackgroundHarness(folder, nextWake), folder }
}

// The entry's real OS calls (the Windows Task Scheduler through PowerShell)
// take as long as the machine needs: a slow hosted Windows runner ran past
// the integration runs' 20 s budget twice (PR #255, PR #257) where a warm run
// takes 7 to 11 s. No limit of ours here (owner 2026-10-16): each test below
// is `.timeout(0)` (mocha copies a suite's timeout into a test when the test
// is added); the other suites keep the repository's budget.
suite('schedule background entry in the real host', () => {
  let disposeGovernor: (() => void) | undefined
  let governorChannel: vscode.LogOutputChannel | undefined
  let governorDir: string | undefined
  let stagedHelper: string | undefined

  suiteSetup(async function () {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension)
    await extension.activate()
    // The real governor binding for this bundle, mirroring activation: the
    // same inspect input, the same error reporting, and on Windows the same
    // job-helper assembly the governed spawn needs. History stays out: test
    // samples must never reach the machine journal.
    governorDir = await mkdtemp(path.join(tmpdir(), 'schedule-background-governor-'))
    const storageDir = governorDir
    governorChannel = vscode.window.createOutputChannel('schedule background test', { log: true })
    const log = createLogger(governorChannel)
    const warn = (message: string): void => {
      log.warn(message)
    }
    const systemRoot = process.env['SystemRoot']
    const extensionPath = extension.extensionPath
    // The resource registry shells out to a platform helper it resolves
    // beside its own bundle (resourceGovernorEntry.ts). This bundle sits one
    // level deeper than the product bundles, so the suite stages the real
    // helper binary where the registry resolves it. Windows needs no staged
    // file: its directory reader runs PowerShell with the job assembly
    // above. The CI jobs that run these tests build the helper first.
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const helperDir = process.platform === 'linux' ? path.join('linux', process.arch) : 'darwin'
      // One thin signed .app per Mac architecture (D209): this Mac's own.
      const helperName =
        process.platform === 'linux'
          ? 'muse-created'
          : path.join(...darwinDictationHelperSegments(process.arch).slice(1))
      const staged = path.join(__dirname, '..', 'native', helperDir, helperName)
      await mkdir(path.dirname(staged), { recursive: true })
      await copyFile(path.join(extensionPath, 'native', helperDir, helperName), staged)
      if (process.platform === 'linux') await chmod(staged, 0o755)
      stagedHelper = staged
    }
    disposeGovernor = configureResources({
      inspect: (key) => vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect(key),
      onError: () => {
        warn('Resource tree or sampler reading is unavailable')
      },
      windowsJob:
        systemRoot !== undefined && process.platform === 'win32'
          ? async () => {
              const readJobSource = jobSourceReader(extensionPath)
              const assembly = shellJobAssembly({
                storageDir,
                systemRoot,
                readJobSource,
                log: warn,
              })
              const sealed = sealedMcpJobExecutable({
                storageDir,
                systemRoot,
                readJobSource,
                log: warn,
              })
              const assemblyPath = await assembly()
              const helper = await sealed()
              return assemblyPath === undefined || helper === undefined
                ? undefined
                : { assemblyPath, executablePath: helper.path, verify: helper.verify }
            }
          : undefined,
    })
  })

  suiteTeardown(async function () {
    if (stagedHelper !== undefined) await rm(stagedHelper, { force: true })
    stagedHelper = undefined
    disposeGovernor?.()
    disposeGovernor = undefined
    governorChannel?.dispose()
    governorChannel = undefined
    if (governorDir !== undefined) await removeFolder(governorDir)
    governorDir = undefined
  })

  test('reconcile retires a stale entry while consent says yes and nothing is due', async () => {
    const { background, consent, entry, folder } = await coordinator(undefined)
    try {
      await saveBackgroundConsent(consent, { choice: 'yes', decidedAtMs: NOW })
      await background.reconcile()
      assert.equal(entry.removed, 1)
      assert.deepEqual(entry.registered, [])
      assert.deepEqual(await entry.status(), { registered: false })
    } finally {
      await removeFolder(folder)
    }
  }).timeout(0)

  const registerTest = process.platform === 'win32' ? test.skip : test
  registerTest(
    'a due wake reaches entry.register, which really refuses the unverified launcher',
    async () => {
      const { background, consent, entry, folder } = await coordinator(WAKE)
      try {
        await saveBackgroundConsent(consent, { choice: 'yes', decidedAtMs: NOW })
        let failure: unknown
        try {
          await background.reconcile()
        } catch (error: unknown) {
          failure = error
        }
        assert.deepEqual(entry.registered, [{ nextWakeAtMs: WAKE }])
        assert.equal(entry.removed, 0)
        assert.ok(failure instanceof Error)
        assert.equal(failure.name, 'UnsafeScheduleLauncherError')
        assert.deepEqual(await entry.status(), { registered: false })
      } finally {
        await removeFolder(folder)
      }
    },
  ).timeout(0)

  test('an explicit removal retires the entry with no consent record', async () => {
    const { background, entry, folder } = await coordinator(undefined)
    try {
      await background.remove()
      assert.equal(entry.removed, 1)
      assert.deepEqual(await entry.status(), { registered: false })
    } finally {
      await removeFolder(folder)
    }
  }).timeout(0)
})
