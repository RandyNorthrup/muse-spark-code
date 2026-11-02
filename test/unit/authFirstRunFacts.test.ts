// First-run dead-ends leave evidence (RSCH-MUSE-G, muse-spark-code#157): a
// person who reached the not-installed screen filed a report with 0 recent
// events. Every dead-end on the landing/install journey — the screen shown,
// install started, the install re-check failed or timed out, the sign-in
// offered — writes one flight-recorder fact in the existing vocabulary, over
// the real AuthService, the real recorder and journal on temp files, and the
// real builder. Windows run, 0.19.0: extension 0.18.2, vscode 1.141.2, node
// 24.21.0, backend auto, cli not found, no key anywhere, Recent events (0).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthService, type AuthBackendFacts } from '../../src/host/auth/authService'
import { CliAccount } from '../../src/host/auth/cliAccount'
import { CredentialStore, type SecretStore } from '../../src/host/auth/credentialStore'
import type { Logger } from '../../src/host/logger'
import { createWindowJournal } from '../../src/host/support/recorderEntry'
import { ReportRecorder } from '../../src/host/support/reportRecorder'
import {
  buildProblemReportDraft,
  enrichProblemReportFacts,
} from '../../src/core/support/problemReport'
import { reportPanelStateOf } from '../../src/core/support/reportContext'
import type { ReportEventKind } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import type { AuthStatus, HostToWebviewMessage } from '../../src/shared/protocol'

const silent = (): undefined => undefined
const log: Logger = { trace: silent, info: silent, warn: silent, error: silent }

/** The CLI's absence, in words no draft may ever carry (D72). */
const CLI_ABSENT_REASON = 'the-cli-is-absent-for-this-test'

const scratchDirs = new Set<string>()
afterEach(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  scratchDirs.clear()
})

function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  scratchDirs.add(dir)
  return dir
}

interface FirstRun {
  readonly svc: AuthService
  readonly messages: HostToWebviewMessage[]
  readonly reports: { readonly kind: ReportEventKind; readonly code: string }[]
  readonly recorder: ReportRecorder
  readonly unavailable: unknown[]
  /** The journal's entries after the queued writes land. */
  readonly drain: () => Promise<readonly unknown[]>
  /** The status the panel was last shown. */
  readonly shownStatus: () => AuthStatus
  /** The sealed draft's text for these entries and the shown status. */
  readonly draftFor: (entries: readonly unknown[], isCliFound: boolean) => string
}

function firstRun(options: {
  readonly cliPresent: boolean
  readonly promptKey?: string | undefined
  readonly installer?: () => void | Promise<void>
}): FirstRun {
  const clock = { at: 1_760_000_000_000 }
  const home = scratch('firstrun-home-')
  const storage = scratch('firstrun-storage-')
  const credentialFile = path.join(home, 'auth.json')
  const account = new CliAccount({
    platform: 'linux',
    credentialFilePath: () => credentialFile,
    probe: () => Promise.resolve(undefined),
    log,
  })
  const backend: AuthBackendFacts = {
    resolveCli: () =>
      options.cliPresent
        ? { ok: true, cliPath: '/bin/muse' }
        : { ok: false, reason: CLI_ABSENT_REASON },
    cliSignIn: (isUserAction) => account.signIn(isUserAction),
    peekCliSignIn: () => account.peekFile(),
    abandonCliProbe: () => {
      account.abandonProbe()
    },
    forgetCliAnswers: () => {
      account.forgetAnswers()
    },
    credentialFilePath: () => credentialFile,
    credentialFileModifiedAt: () => undefined,
    hasEnvironmentKey: () => false,
    getBackendMode: () => 'auto',
    restartBackend: () => Promise.resolve(),
    logOutCli: () => Promise.resolve(false),
  }
  const secrets: SecretStore = {
    get: () => Promise.resolve(undefined),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
  const messages: HostToWebviewMessage[] = []
  const reports: { kind: ReportEventKind; code: string }[] = []
  const unavailable: unknown[] = []
  const journal = createWindowJournal({
    globalStorageDir: storage,
    instance: randomUUID(),
    ext: '0.19.0',
    host: '1.141.2',
    pid: process.pid,
    log,
    isAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    extensionRoot: storage,
    now: () => clock.at,
  })
  const recorder = new ReportRecorder({
    load: () => Promise.resolve(journal),
    now: () => clock.at,
    onUnavailable: (error) => {
      unavailable.push(error)
    },
  })
  const shownStatus = (): AuthStatus => {
    const states = messages.filter((message) => message.type === 'authState')
    const last = states.at(-1)
    if (last?.type !== 'authState') throw new Error('the panel showed no state')
    return last.status
  }
  const svc = new AuthService({
    backend,
    credentials: new CredentialStore(secrets, silent),
    logoutHold: { get: () => false, set: () => Promise.resolve() },
    runInTerminal: silent,
    installCommand: 'install',
    runInstallerInTerminal: options.installer ?? silent,
    runDeviceSignIn: () => Promise.resolve('timedOut'),
    promptForApiKey: () => Promise.resolve(options.promptKey),
    broadcast: (message) => {
      messages.push(message)
    },
    // Queued writes land before the clock moves, as they do in real use
    // (a disk append against a five-minute wait): the re-check's rows keep
    // the ages the install really gave them.
    sleep: (ms) => {
      return (async () => {
        await recorder.flushWrites(2000)
        clock.at += ms
      })()
    },
    now: () => clock.at,
    log,
    report: (kind, code) => {
      reports.push({ kind, code })
      recorder.record(kind, code)
    },
  })
  return {
    svc,
    messages,
    reports,
    recorder,
    unavailable,
    drain: async () => {
      await recorder.flushWrites(2000)
      expect(unavailable).toEqual([])
      const journalSource = await recorder.readJournal()
      expect(journalSource.recordingUnavailable).toBe(false)
      return journalSource.entries
    },
    shownStatus: () => shownStatus(),
    draftFor: (entries, isCliFound) => {
      const facts = {
        extensionVersion: '0.19.0',
        vscodeVersion: '1.141.2',
        nodeVersion: '24.21.0',
        platform: 'linux',
        backend: 'auto',
        sandbox: 'off',
        cliFound: isCliFound,
        cliSignIn: false,
        hasStoredApiKey: false,
        hasEnvironmentApiKey: false,
        settingNames: [],
      }
      const panelState = reportPanelStateOf({
        status: shownStatus(),
        isRunning: false,
        hasWaitingQuestion: false,
        lastIsErrorNotice: false,
      })
      const enriched = enrichProblemReportFacts(facts, entries, panelState)
      const draft = buildProblemReportDraft({
        description: '',
        includeFacts: true,
        includeEvents: true,
        facts: enriched,
        events: entries,
        recordingUnavailable: false,
        nowMs: Date.now(),
        scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
      })
      return `${draft.title}\n${draft.text}`
    },
  }
}

type AuthStateMessage = Extract<HostToWebviewMessage, { type: 'authState' }>

function authStates(messages: readonly HostToWebviewMessage[]): AuthStateMessage[] {
  return messages.filter((message): message is AuthStateMessage => message.type === 'authState')
}

describe('first-run dead-ends', () => {
  it('shows the not-installed screen with its probe and resolution facts', async () => {
    const run = firstRun({ cliPresent: false })
    const shown = await run.svc.refresh()
    expect(shown.status).toBe('noCli')
    expect(shown.methods).toEqual(['apiKey'])
    expect(run.reports).toEqual([
      { kind: 'cliProbe', code: 'cliMissing' },
      { kind: 'backendResolved', code: 'noneCliMissing' },
    ])
    const entries = await run.drain()
    expect(entries).toHaveLength(2)
    const draft = run.draftFor(entries, false)
    expect(draft).toContain('Problem report: Muse Spark 0.19.0 on linux')
    expect(draft).toContain('panel: landingNoCli')
    expect(draft).toContain('backend resolution: noneCliMissing')
    expect(draft).toMatch(/- \d+s ago cliProbe cliMissing/)
    expect(draft).toMatch(/- \d+s ago backendResolved noneCliMissing/)
    expect(draft).toContain('last sign-in: none')
    expect(draft).not.toContain(CLI_ABSENT_REASON)
  })

  it('leaves the install start and the timed-out re-check as probe rows', async () => {
    const run = firstRun({ cliPresent: false })
    await run.svc.refresh()
    const done = await run.svc.installMuseCode()
    expect(done.installState).toBe('failed')
    expect(done.detail).toBe(EN.installTimedOut)
    expect(run.reports).toEqual([
      { kind: 'cliProbe', code: 'cliMissing' },
      { kind: 'backendResolved', code: 'noneCliMissing' },
      { kind: 'cliProbe', code: 'cliMissing' },
      { kind: 'cliProbe', code: 'cliMissing' },
    ])
    const entries = await run.drain()
    expect(entries).toHaveLength(4)
    const draft = run.draftFor(entries, false)
    // The shown and start rows age together through the five-minute
    // re-check; the re-check's own row just landed still missing.
    expect(draft.match(/- 5m ago cliProbe cliMissing/g)).toHaveLength(2)
    expect(draft).toMatch(/- \d+s ago cliProbe cliMissing/)
    expect(draft).toMatch(/Recent events \(4\):/)
    expect(draft).toContain('panel: landingNoCli')
    expect(authStates(run.messages).at(-1)?.installState).toBe('failed')
  })

  it('records an installer that never starts as an unknown probe outcome', async () => {
    const run = firstRun({
      cliPresent: false,
      installer: () => {
        throw new Error('the terminal never started')
      },
    })
    await run.svc.refresh()
    const done = await run.svc.installMuseCode()
    expect(done.installState).toBe('failed')
    expect(done.detail).toBe(EN.installStartFailed)
    expect(run.reports).toEqual([
      { kind: 'cliProbe', code: 'cliMissing' },
      { kind: 'backendResolved', code: 'noneCliMissing' },
      { kind: 'cliProbe', code: 'cliMissing' },
      { kind: 'cliProbe', code: 'unknown' },
    ])
    const entries = await run.drain()
    expect(entries).toHaveLength(4)
    const draft = run.draftFor(entries, false)
    expect(draft).toMatch(/- \d+s ago cliProbe unknown/)
    expect(draft.match(/- \d+s ago cliProbe cliMissing/g)).toHaveLength(2)
    expect(draft).not.toContain('the terminal never started')
  })

  it('records a dismissed key prompt as the sign-in it cancelled', async () => {
    const run = firstRun({ cliPresent: false, promptKey: undefined })
    await run.svc.refresh()
    const after = await run.svc.signIn('apiKey')
    expect(after.status).toBe('noCli')
    expect(run.reports).toEqual([
      { kind: 'cliProbe', code: 'cliMissing' },
      { kind: 'backendResolved', code: 'noneCliMissing' },
      { kind: 'signInFailed', code: 'cancelled' },
    ])
    const entries = await run.drain()
    expect(entries).toHaveLength(3)
    const draft = run.draftFor(entries, false)
    expect(draft).toMatch(/last sign-in: failed cancelled \(\d+s ago\)/)
    expect(draft).toContain('panel: landingNoCli')
  })

  it('resolves a signed-out CLI to the browser-and-key offer', async () => {
    const run = firstRun({ cliPresent: true })
    const shown = await run.svc.refresh()
    expect(shown.status).toBe('signedOut')
    expect(shown.methods).toEqual(['browser', 'apiKey'])
    expect(run.reports).toEqual([
      { kind: 'cliProbe', code: 'cliSignedOut' },
      { kind: 'backendResolved', code: 'noneCliSignedOut' },
    ])
    const entries = await run.drain()
    expect(entries).toHaveLength(2)
  })
})
