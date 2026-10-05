// Report a problem (M93, PLAN.md D72): the window's recorder in
// src/host/support/reportRecorder.ts and the dialog's local facts in
// src/host/support/reportFacts.ts. The recorder writes facts only (a fixed
// kind, a known code, frames inside the installed package), bounds how many
// failures a minute become disk writes, and answers sanitized references;
// the facts come from structure and presence, never a value.

import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ReportJournal } from '../../src/host/support/reportJournal'
import {
  hostFramesOf,
  hostPackagePath,
  ReportRecorder,
} from '../../src/host/support/reportRecorder'
import {
  changedSettingNames,
  extensionReportFacts,
  manifestSettingNames,
  reportScrubContext,
} from '../../src/host/support/reportFacts'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'
import {
  REPORT_RECORD_LIMIT,
  REPORT_RECORD_WINDOW_MS,
  REPORT_STORAGE_DIR,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const NOW = 1_769_000_000_000
const ROOT = path.resolve(import.meta.dirname, '../..')
const INSTALLED = path.join(ROOT, 'temp', 'installed', 'randynorthrup.muse-spark-code-0.12.1')

/** A window's global storage under the repository's ignored temp/, removed after the test. */
async function storage(): Promise<string> {
  await mkdir(path.join(ROOT, 'temp'), { recursive: true })
  const dir = await mkdtemp(path.join(ROOT, 'temp', 'report-recorder-'))
  onTestFinished(() => removeFolder(dir))
  return dir
}

function recorderOver(dir: string, clock: { now: number }): ReportRecorder {
  return new ReportRecorder({
    journal: new ReportJournal({
      globalStorageDir: dir,
      instance: 'window-a',
      ext: '0.12.1',
      host: '1.99.0',
      pid: 1001,
      log: new FakeLogOutputChannel(),
      now: () => clock.now,
      isAlive: () => true,
    }),
    extensionRoot: INSTALLED,
    now: () => clock.now,
  })
}

/** Waits for the journal's queued writes: a read goes through the same queue. */
async function journalText(dir: string): Promise<string> {
  const reports = path.join(dir, REPORT_STORAGE_DIR)
  const entries = await readdir(reports)
  const names = entries.filter((name) => name.startsWith('journal-'))
  const texts = await Promise.all(names.map((name) => readFile(path.join(reports, name), 'utf8')))
  return texts.join('')
}

describe('hostPackagePath', () => {
  it('names a shipped bundle under the install folder by its package path', () => {
    const file = path.join(INSTALLED, 'dist', 'extension.js')
    expect(hostPackagePath(file, INSTALLED)).toBe('dist/extension.js')
    expect(hostPackagePath(pathToFileURL(file).href, INSTALLED)).toBe('dist/extension.js')
  })

  it('keeps drive-letter case variants and CRLF stack frames inside the package', () => {
    const file = path.join(INSTALLED, 'dist', 'extension.js')
    const variant = file.replace(/^[a-z]:/i, (drive) => drive.toLowerCase())
    expect(hostPackagePath(variant, INSTALLED)).toBe('dist/extension.js')
    const error = new Error('PRIVATE Windows path')
    Object.defineProperty(error, 'stack', {
      value: `Error: PRIVATE Windows path\r\n    at activate (${variant}:12:4)\r\n    at outside (C:\\Users\\Other\\secret.js:1:2)`,
    })
    expect(hostFramesOf(error, INSTALLED)).toEqual([
      { path: 'dist/extension.js', line: 12, column: 4 },
    ])
  })

  it('maps extended native paths to the same package frame', () => {
    const file = path.join(INSTALLED, 'dist', 'extension.js')
    expect(hostPackagePath(path.toNamespacedPath(file), INSTALLED)).toBe('dist/extension.js')
    expect(hostPackagePath(file, path.toNamespacedPath(INSTALLED))).toBe('dist/extension.js')
  })

  it('maps UNC package frames and rejects external UNC and extended frames', () => {
    const root = process.platform === 'win32' ? String.raw`\\server\share\installed` : '/installed'
    const file = path.join(root, 'dist', 'extension.js')
    expect(hostPackagePath(file, root)).toBe('dist/extension.js')
    expect(hostPackagePath(path.toNamespacedPath(file), root)).toBe('dist/extension.js')
    expect(hostPackagePath(String.raw`\\other\share\dist\extension.js`, INSTALLED)).toBeUndefined()
    expect(
      hostPackagePath(path.toNamespacedPath(path.join(ROOT, 'dist', 'extension.js')), INSTALLED),
    ).toBeUndefined()
  })

  it('drops everything else: other files, other folders, relative and odd locations', () => {
    for (const location of [
      path.join(INSTALLED, 'dist', 'notShipped.js'),
      path.join(INSTALLED, '..', 'other-extension', 'dist', 'extension.js'),
      path.join(ROOT, 'src', 'extension.ts'),
      'dist/extension.js',
      'node:internal/process/task_queues',
      'file://%zz',
      'native',
    ]) {
      expect(hostPackagePath(location, INSTALLED), location).toBeUndefined()
    }
  })

  it('keeps only package frames from a host stack, never its message or names', () => {
    const error = new TypeError('PRIVATE /home/someone/secret.ts')
    Object.defineProperty(error, 'stack', {
      value: [
        'TypeError: PRIVATE /home/someone/secret.ts',
        `    at activate (${path.join(INSTALLED, 'dist', 'extension.js')}:2:345)`,
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
        `    at PRIVATE_NAME (${path.join(ROOT, 'src', 'x.ts')}:1:1)`,
      ].join('\n'),
    })
    expect(hostFramesOf(error, INSTALLED)).toEqual([
      { path: 'dist/extension.js', line: 2, column: 345 },
    ])
  })
})

describe('ReportRecorder', () => {
  it('records facts with package frames and answers references in order', async () => {
    const dir = await storage()
    const clock = { now: NOW }
    const recorder = recorderOver(dir, clock)
    expect(await recorder.startup()).toBe(false)
    const error = new RangeError('PRIVATE prompt text')
    Object.defineProperty(error, 'stack', {
      value: `RangeError: PRIVATE prompt text\n    at f (${path.join(INSTALLED, 'dist', 'report.js')}:1:2)`,
    })
    expect(recorder.recordError('activationFailed', error)).toEqual({
      kind: 'activationFailed',
      entryIndex: 0,
    })
    expect(recorder.record('backendExit', 'SIGKILL', { backend: 'museCode' })).toEqual({
      kind: 'backendExit',
      entryIndex: 1,
    })
    recorder.recordWebviewError({
      kind: 'windowError',
      source: 'window',
      code: 'TypeError',
      frames: [{ path: 'dist/webview/main.js', line: 3, column: 4 }],
    })
    const read = await recorder.readJournal()
    expect(read).toEqual({
      entries: [
        {
          kind: 'activationFailed',
          code: 'RangeError',
          frames: [{ path: 'dist/report.js', line: 1, column: 2 }],
          ageMs: 0,
        },
        { kind: 'backendExit', code: 'SIGKILL', frames: [], ageMs: 0 },
        {
          kind: 'windowError',
          code: 'TypeError',
          frames: [{ path: 'dist/webview/main.js', line: 3, column: 4 }],
          ageMs: 0,
        },
      ],
      recordingUnavailable: false,
    })
    expect(await journalText(dir)).not.toContain('PRIVATE')
    await recorder.shutdown()
  })

  it('writes at most REPORT_RECORD_LIMIT failures a minute, then nothing until it moves on', async () => {
    const dir = await storage()
    const clock = { now: NOW }
    const recorder = recorderOver(dir, clock)
    await recorder.startup()
    for (let index = 0; index < REPORT_RECORD_LIMIT; index += 1) {
      expect(recorder.record('errorNotice', 'unknown')).toBeDefined()
    }
    expect(recorder.record('errorNotice', 'unknown')).toBeUndefined()
    clock.now += REPORT_RECORD_WINDOW_MS
    expect(recorder.record('errorNotice', 'unknown')).toEqual({
      kind: 'errorNotice',
      entryIndex: REPORT_RECORD_LIMIT,
    })
    const read = await recorder.readJournal()
    expect(read.entries).toHaveLength(REPORT_RECORD_LIMIT + 1)
  })

  it('says recording was unavailable when its storage failed', async () => {
    const dir = await storage()
    const recorder = new ReportRecorder({
      journal: new ReportJournal({
        globalStorageDir: dir,
        instance: 'window-b',
        ext: '0.12.1',
        host: '1.99.0',
        pid: 1001,
        log: new FakeLogOutputChannel(),
        isAlive: () => true,
        fs: {
          mkdir: () => Promise.reject(Object.assign(new Error('read-only'), { code: 'EROFS' })),
          readDir: () => Promise.reject(Object.assign(new Error('read-only'), { code: 'EROFS' })),
          readFile: () => Promise.reject(new Error('unused')),
          appendFile: () => Promise.reject(new Error('unused')),
          writeTempAndRename: () => Promise.reject(new Error('unused')),
          remove: () => Promise.reject(new Error('unused')),
        },
      }),
      extensionRoot: INSTALLED,
      now: () => NOW,
    })
    expect(await recorder.startup()).toBe(false)
    expect(await recorder.readJournal()).toEqual({ entries: [], recordingUnavailable: true })
  })
})

describe('the dialog facts', () => {
  const VERDICT_FACTS = {
    extensionVersion: '0.12.1',
    vscodeVersion: '1.99.0',
    nodeVersion: '22.20.4',
    platform: 'linux',
    backend: 'auto',
    sandbox: 'auto',
    hasStoredApiKey: true,
    hasEnvironmentApiKey: false,
    changedSettingNames: ['museSpark.backend'],
  } as const

  it('reads the sign-in from the credential file structure alone', () => {
    for (const [verdict, isSignedIn] of [
      ['inline', true],
      ['keychain', true],
      ['empty', false],
      ['unrecognized', false],
      ['unsupportedHere', false],
      ['absent', false],
    ] as const) {
      const facts = extensionReportFacts({
        ...VERDICT_FACTS,
        cli: { isFound: true, version: '1.4.2' },
        credentialFileVerdict: verdict,
      })
      expect(facts, verdict).toMatchObject({
        cliSignIn: isSignedIn,
        cliFound: true,
        cliVersion: '1.4.2',
      })
    }
  })

  it('names the CLI version only when the CLI was found, and the builder accepts the facts', () => {
    const facts = extensionReportFacts({
      ...VERDICT_FACTS,
      cli: { isFound: false, version: '1.4.2' },
      credentialFileVerdict: 'absent',
    })
    expect(facts).not.toHaveProperty('cliVersion')
    const draft = buildProblemReportDraft({
      description: '',
      includeFacts: true,
      includeEvents: false,
      facts,
      events: [],
      recordingUnavailable: false,
      nowMs: NOW,
      scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
    })
    expect(draft.text).toContain('cli: not found; signed in: no')
    expect(draft.text).toContain('settings (names only): museSpark.backend')
  })

  it('lists the changed settings by name only', () => {
    const names = manifestSettingNames({
      contributes: {
        configuration: {
          properties: { 'museSpark.backend': {}, 'museSpark.shellSandbox': {}, 'other.x': {} },
        },
      },
    })
    expect(names).toEqual(['museSpark.backend', 'museSpark.shellSandbox'])
    expect(manifestSettingNames({ contributes: {} })).toEqual([])
    expect(
      changedSettingNames(names, (name) =>
        name === 'museSpark.backend' ? { workspaceValue: 'modelApi' } : {},
      ),
    ).toEqual(['museSpark.backend'])
  })

  it('takes the names to forget where the OS gives them', () => {
    expect(
      reportScrubContext({
        workspaceRoots: ['/work'],
        homeDir: '/home/someone',
        userName: () => 'someone',
        hostName: () => {
          throw new Error('no host name')
        },
      }),
    ).toEqual({ workspaceRoots: ['/work'], homeDir: '/home/someone', extraLiterals: ['someone'] })
  })
})
