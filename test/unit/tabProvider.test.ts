import { Usd } from '../../src/shared/usd'
// Tab's provider and its eligibility (M94, PLAN.md D73, Acceptance 3–5):
// quiet wherever D73 says quiet, one item otherwise, every byte sent
// redacted, and the inferred partial accept. Each exclusion has its own
// case; removing one exclusion fails its case (the red drills).

import path from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { removeFolder } from './helpers/temporaryFolders'
import { ExtensionHookRunner } from '../../src/host/extensionHooksRunner'
import { memoryContextIo } from './helpers/fakeContextIo'
import { hookEnvironment, runCommand } from '../../src/host/backend/toolIo'
import { createTabProvider as entryProvider } from '../../src/host/tab/tabEntry'
import { BASE_LOCALE } from '../../src/shared/l10n/text'
import { readFileSync } from 'node:fs'
import type * as vscode from 'vscode'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InlineCompletionTriggerKind,
  Position,
  Range,
  Uri,
  commands,
  extensions,
  languages,
  window,
  workspace,
} from 'vscode'
import { GitExitError } from '../../src/host/git'
import {
  TAB_COMMAND_IDS,
  isTabLanguageOn,
  type TabCompletionSnapshot,
  type TabConsentGrant,
  type TabDocumentChange,
  type TabHookBridge,
  type TabOutcome,
  type TabProviderDeps,
  type TabReportedUsage,
  type TabReservation,
  type TabTextChangeEvent,
} from '../../src/host/tab/tabBundle'
import {
  TabIgnoreCache,
  chooseTabMode,
  inferTabPartialAccept,
  isFilesExcluded,
  isTabFileEligible,
  isTabForbiddenName,
  tabAcceptArgsOf,
  type TabFileCandidate,
} from '../../src/host/tab/tabProvider'
import { tabUserText } from '../../src/core/tab/tabRequest'
import {
  REDACTED_MARK,
  TAB_FAST_MAX_OUTPUT_TOKENS,
  TAB_FILE_MAX_BYTES,
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_OUTPUT_TOKENS,
  UI_TEXT,
  HOOK_OUTPUT_MAX_BYTES,
} from '../../src/shared/constants'
import { FakeCancellationToken, FakeLogOutputChannel, FakeTextDocument } from './helpers/fakes'
import { hookResult } from './helpers/fakeToolIo'
import type { ShellResult } from '../../src/core/shellResult'
import { SYNTHETIC } from './helpers/syntheticTokens'
import { FakeUri } from './mocks/vscode'

const openContextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument> =
  workspace.openTextDocument

/** A consent grant that stays current: the provider cases test other bindings. */
const GRANTED: TabConsentGrant = { scope: 'window', isCurrent: () => true }

const USAGE: TabReportedUsage = { inputTokens: 10, cachedTokens: 2, outputTokens: 3 }
const NOTHING_SENT: TabReportedUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }
const RESERVATION: TabReservation = {
  model: 'muse-spark-1.3',
  worstCaseUsd: Usd.from(0.01).toAmount(),
  date: '2026-10-04',
}

beforeEach(() => {
  vi.mocked(extensions.getExtension).mockReset().mockReturnValue(undefined)
  vi.mocked(languages.registerInlineCompletionItemProvider).mockReset()
  vi.mocked(window.showQuickPick).mockReset()
  vi.mocked(window.showWarningMessage).mockReset()
  vi.mocked(commands.executeCommand).mockReset()
  vi.mocked(workspace.getWorkspaceFolder).mockReset()
  vi.mocked(workspace.openTextDocument).mockReset()
})

function onInvokeSettings(): ReturnType<TabProviderDeps['settings']> {
  return {
    tabModel: 'muse-spark-1.3',
    tabLanguages: { '*': true },
    tabMultiline: 'auto',
    tabTrigger: 'onInvoke',
    tabWithCopilot: 'yield',
  }
}

function languagesOffSettings(): ReturnType<TabProviderDeps['settings']> {
  return {
    tabModel: 'muse-spark-1.3',
    tabLanguages: { '*': false },
    tabMultiline: 'auto',
    tabTrigger: 'automatic',
    tabWithCopilot: 'yield',
  }
}

/** A hook bridge with one fixed, loaded hook policy unless a case overrides it. */
function bridge(overrides: Partial<TabHookBridge> = {}): TabHookBridge {
  return {
    beforeRead: () => Promise.resolve(true),
    afterEdit: () => undefined,
    bindPolicy: () =>
      Promise.resolve({ key: 'hooks-1', isConfigurationInvalid: false, isReloading: false }),
    policyKey: () => 'hooks-1',
    ...overrides,
  }
}

/** A document change for the inference cases, at the item's position by default. */
function textChange(overrides: Partial<TabDocumentChange> = {}): TabDocumentChange {
  return {
    uriString: 'file:///ws/file.ts',
    insertedText: 'foo(',
    startLine: 0,
    startCharacter: 10,
    endLine: 0,
    endCharacter: 10,
    ...overrides,
  }
}

describe('isTabLanguageOn', () => {
  it('prefers the exact language over the wildcard', () => {
    expect(isTabLanguageOn({ '*': true, plaintext: false }, 'plaintext')).toBe(false)
    expect(isTabLanguageOn({ '*': false, typescript: true }, 'typescript')).toBe(true)
  })

  it('falls back to the wildcard, then to on', () => {
    expect(isTabLanguageOn({ '*': false }, 'typescript')).toBe(false)
    expect(isTabLanguageOn({}, 'typescript')).toBe(true)
  })
})

/** Only `src/a.ts` exists beside the matches (a `when` condition's sibling). */
function hasSibling(relativePath: string): boolean {
  return relativePath === 'src/a.ts'
}

describe('isFilesExcluded', () => {
  it('matches basenames, segments and alternatives', () => {
    expect(isFilesExcluded('debug.log', { '*.log': true })).toBe(true)
    expect(isFilesExcluded('a/debug.log', { '*.log': true })).toBe(true)
    expect(isFilesExcluded('a/b/c.js', { '**/b/**': true })).toBe(true)
    expect(isFilesExcluded('src/a.ts', { 'src/{a,b}.ts': true })).toBe(true)
    expect(isFilesExcluded('src/c.ts', { 'src/{a,b}.ts': true })).toBe(false)
  })

  it('matches a root file through **/ and everything below an excluded folder (RVM94HU 14)', () => {
    expect(isFilesExcluded('file.ts', { '**/*.ts': true })).toBe(true)
    expect(isFilesExcluded('node_modules/pkg/index.js', { '**/node_modules': true })).toBe(true)
    expect(isFilesExcluded('build/out.js', { build: true })).toBe(true)
    expect(isFilesExcluded('src/out.js', { build: true })).toBe(false)
  })

  it('excludes under a when condition only while its sibling exists (RVM94HU 14)', () => {
    const exclude = { '**/*.js': { when: '$(basename).ts' } }
    expect(isFilesExcluded('src/a.js', exclude, hasSibling)).toBe(true)
    expect(isFilesExcluded('src/b.js', exclude, hasSibling)).toBe(false)
  })

  it('ignores switched-off and uncompilable patterns', () => {
    expect(isFilesExcluded('debug.log', { '*.log': false })).toBe(false)
    expect(isFilesExcluded('debug.log', { '({bad': true })).toBe(false)
    expect(isFilesExcluded('src/a.ts', {})).toBe(false)
  })
})

describe('isTabForbiddenName', () => {
  it('refuses secrets, the five new entries and protected paths', () => {
    for (const name of [
      '.env',
      '.env.production',
      'credentials.json',
      'id_rsa',
      'key.pem',
      'secrets.yml',
      '.dev.vars',
      'cert.crt',
      'cert.cert',
      'store.keystore',
      '.git/config',
      '.github/workflows/ci.yml',
      'AGENTS.md',
    ]) {
      expect(isTabForbiddenName(name)).toBe(true)
    }
  })

  it('allows ordinary source files', () => {
    expect(isTabForbiddenName('src/host/tab/tabProvider.ts')).toBe(false)
  })
})

describe('chooseTabMode', () => {
  it('is always multi-line on Invoke', () => {
    expect(chooseTabMode('const x = ', 'foo', 'never', true)).toBe('multiline')
  })

  it('obeys never and onInvoke', () => {
    expect(chooseTabMode('', '', 'never', false)).toBe('fast')
    expect(chooseTabMode('', '', 'onInvoke', false)).toBe('fast')
  })

  it('takes multi-line on a blank line or a block opener with nothing after', () => {
    expect(chooseTabMode('', '', 'auto', false)).toBe('multiline')
    expect(chooseTabMode(' '.repeat(3), ' '.repeat(2), 'auto', false)).toBe('multiline')
    expect(chooseTabMode('function f() {', '', 'auto', false)).toBe('multiline')
    expect(chooseTabMode('if (x):', '  ', 'auto', false)).toBe('multiline')
  })

  it('stays fast with text after the cursor or mid-line code', () => {
    expect(chooseTabMode('function f() {', ' }', 'auto', false)).toBe('fast')
    expect(chooseTabMode('const x = 1', '', 'auto', false)).toBe('fast')
    expect(chooseTabMode('const ', 'x = 1', 'auto', false)).toBe('fast')
  })
})

describe('inferTabPartialAccept', () => {
  const tracked = {
    uriString: 'file:///ws/file.ts',
    filePath: '/ws/file.ts',
    line: 0,
    character: 10,
    rest: 'foo(bar)',
  }
  it('infers the rest after a word-sized insertion of the rest’s start', () => {
    expect(inferTabPartialAccept(tracked, textChange())).toBe('bar)')
  })

  it('ignores keystrokes, replacements, moves and foreign text', () => {
    expect(inferTabPartialAccept(tracked, textChange({ insertedText: 'f' }))).toBe(undefined)
    expect(inferTabPartialAccept(tracked, textChange({ endLine: 0, endCharacter: 11 }))).toBe(
      undefined,
    )
    expect(inferTabPartialAccept(tracked, textChange({ startCharacter: 9 }))).toBe(undefined)
    expect(inferTabPartialAccept(tracked, textChange({ insertedText: 'zzz(' }))).toBe(undefined)
    expect(inferTabPartialAccept(tracked, textChange({ uriString: 'file:///ws/other.ts' }))).toBe(
      undefined,
    )
  })
})

/** A git answer: exit 1 allowed, anything else blind. */
function gitExit(code: number): GitExitError {
  return new GitExitError(code, '', 'check-ignore')
}

interface IgnoreHarness {
  readonly cache: TabIgnoreCache
  readonly runs: readonly string[][]
  fireCleared(): void
}

function ignoreHarness(
  runGit: (args: readonly string[], cwd: string) => Promise<string>,
  ignoreFiles: readonly string[] = [],
): IgnoreHarness {
  const runs: string[][] = []
  let cleared: (() => void) | undefined
  const cache = new TabIgnoreCache({
    runGit: (args, cwd) => {
      runs.push([...args, `cwd=${cwd}`])
      return runGit(args, cwd)
    },
    ignoreFileExists: (absolutePath) => ignoreFiles.includes(absolutePath),
    workspaceRoots: () => ['/ws'],
    onIgnoreFilesChanged: (clear) => {
      cleared = clear
      return { dispose: () => undefined }
    },
  })
  return {
    cache,
    runs,
    fireCleared: () => {
      cleared?.()
    },
  }
}

describe('TabIgnoreCache', () => {
  it('believes exit 0, allows exit 1, and caches per path', async () => {
    const git = vi.fn((args: readonly string[]): Promise<string> => {
      if (args.includes('--no-index')) {
        return Promise.reject(gitExit(1))
      }
      return args.includes('ignored.ts') ? Promise.resolve('') : Promise.reject(gitExit(1))
    })
    const harness = ignoreHarness(git)
    expect(await harness.cache.isIgnored('/ws', 'ignored.ts')).toBe(true)
    expect(await harness.cache.isIgnored('/ws', 'free.ts')).toBe(false)
    expect(await harness.cache.isIgnored('/ws', 'free.ts')).toBe(false)
    expect(git).toHaveBeenCalledTimes(2)
  })

  it('reads nothing in the folder when git is blind and a cursorignore sits there', async () => {
    const harness = ignoreHarness(
      () => Promise.reject(new Error('no repository')),
      [path.join('/ws', '.cursorignore')],
    )
    expect(await harness.cache.isIgnored('/ws', 'any.ts')).toBe(true)
  })

  it('applies a cursorignore even where git answers not ignored (RVM94HU 10)', async () => {
    const harness = ignoreHarness(
      (args) => (args.includes('--no-index') ? Promise.resolve('') : Promise.reject(gitExit(1))),
      [path.join('/ws', '.cursorignore')],
    )
    expect(await harness.cache.isIgnored('/ws', 'src/tracked.ts')).toBe(true)
  })

  it('reads nothing below a nested ignore file when git is blind (RVM94HU 11)', async () => {
    const harness = ignoreHarness(
      () => Promise.reject(new Error('no git')),
      [path.join('/ws', 'src', '.gitignore')],
    )
    expect(await harness.cache.isIgnored('/ws', 'src/sensitive.ts')).toBe(true)
    expect(await harness.cache.isIgnored('/ws', 'other/free.ts')).toBe(false)
  })

  it('asks again when an ignore file changes while git answers (RVM94HU 1)', async () => {
    const state = { isIgnoredNow: false, calls: 0 }
    const firstAnswer = Promise.withResolvers<undefined>()
    const harness = ignoreHarness(async () => {
      state.calls += 1
      const isIgnored = state.isIgnoredNow
      if (state.calls === 1) {
        await firstAnswer.promise
      }
      if (isIgnored) {
        return ''
      }
      throw gitExit(1)
    })
    const pending = harness.cache.isIgnored('/ws', 'a.ts')
    // The user adds the exclusion while git still answers under the old rules.
    state.isIgnoredNow = true
    harness.fireCleared()
    firstAnswer.resolve(undefined)
    expect(await pending).toBe(true)
    expect(await harness.cache.isIgnored('/ws', 'a.ts')).toBe(true)
  })

  it('allows the folder when git is blind and no ignore file is present', async () => {
    const harness = ignoreHarness(() => Promise.reject(new Error('no git')))
    expect(await harness.cache.isIgnored('/ws', 'any.ts')).toBe(false)
  })

  it('drops the cache when an ignore file changes', async () => {
    const git = vi.fn((): Promise<string> => Promise.reject(gitExit(1)))
    const harness = ignoreHarness(git)
    expect(await harness.cache.isIgnored('/ws', 'free.ts')).toBe(false)
    harness.fireCleared()
    expect(await harness.cache.isIgnored('/ws', 'free.ts')).toBe(false)
    expect(git).toHaveBeenCalledTimes(2)
  })
})

function eligibleCandidate(overrides: Partial<TabFileCandidate> = {}): TabFileCandidate {
  return {
    absolutePath: '/ws/file.ts',
    relativePath: 'file.ts',
    sizeBytes: 10,
    content: 'const x = 1\n',
    ...overrides,
  }
}

function ignoreAllowing(): TabIgnoreCache {
  return ignoreHarness(() => Promise.reject(gitExit(1))).cache
}

describe('isTabFileEligible', () => {
  it('allows an ordinary file', async () => {
    await expect(
      isTabFileEligible(eligibleCandidate(), {
        filesExclude: {},
        ignore: ignoreAllowing(),
        rootAbs: '/ws',
      }),
    ).resolves.toBe(true)
  })

  it('refuses each exclusion on its own', async () => {
    const refusing = bridge({ beforeRead: () => Promise.resolve(false) })
    const cases: [string, TabFileCandidate, { filesExclude?: Record<string, boolean> }][] = [
      ['private', eligibleCandidate({ relativePath: '.env' }), {}],
      ['new private entry', eligibleCandidate({ relativePath: 'secrets.yml' }), {}],
      ['protected', eligibleCandidate({ relativePath: '.git/config' }), {}],
      ['oversize', eligibleCandidate({ sizeBytes: TAB_FILE_MAX_BYTES + 1 }), {}],
      ['files.exclude', eligibleCandidate(), { filesExclude: { '*.ts': true } }],
    ]
    for (const [name, candidate, extra] of cases) {
      await expect(
        isTabFileEligible(candidate, {
          filesExclude: extra.filesExclude ?? {},
          ignore: ignoreAllowing(),
          rootAbs: '/ws',
        }),
        name,
      ).resolves.toBe(false)
    }
    const ignored = ignoreHarness(() => Promise.resolve('')).cache
    await expect(
      isTabFileEligible(eligibleCandidate(), {
        filesExclude: {},
        ignore: ignored,
        rootAbs: '/ws',
      }),
      'git-ignored',
    ).resolves.toBe(false)
    await expect(
      isTabFileEligible(eligibleCandidate(), {
        filesExclude: {},
        ignore: ignoreAllowing(),
        rootAbs: '/ws',
        hooks: refusing,
      }),
      'hook deny',
    ).resolves.toBe(false)
    await expect(
      isTabFileEligible(eligibleCandidate({ content: undefined }), {
        filesExclude: {},
        ignore: ignoreAllowing(),
        rootAbs: '/ws',
        hooks: bridge(),
      }),
      'hook without content',
    ).resolves.toBe(false)
  })
})

// --- The provider ---

interface ProviderHarness {
  readonly outcomes: TabOutcome[]
  readonly snapshots: TabCompletionSnapshot[]
  readonly reserve: ReturnType<typeof vi.fn>
  readonly settle: ReturnType<typeof vi.fn>
  readonly requestUse: ReturnType<typeof vi.fn>
  readonly complete: ReturnType<typeof vi.fn>
  readonly beforeRead: ReturnType<typeof vi.fn>
  readonly afterEdit: ReturnType<typeof vi.fn>
  readonly log: FakeLogOutputChannel
  readonly textListeners: ((event: TabTextChangeEvent) => void)[]
  readonly provider: vscode.InlineCompletionItemProvider
  readonly handle: ReturnType<typeof entryProvider>
  serve(
    text?: string,
    line?: number,
    character?: number,
    token?: FakeCancellationToken,
    file?: string,
  ): Promise<vscode.InlineCompletionItem[]>
}

/** The workspace folders holding a path, innermost first: `/ws` in these tests. */
function wsRoots(absolutePath: string): readonly string[] {
  return absolutePath.startsWith('/ws/') ? ['/ws'] : []
}

/** A document outside any file scheme, for the scheme exclusion. */
class UntitledUri extends FakeUri {
  public override readonly scheme = 'untitled'
}

function providerHarness(
  overrides: Partial<TabProviderDeps> & {
    readonly engineCompletion?: string | undefined
    readonly withHooks?: boolean
  } = {},
): ProviderHarness {
  // The default applies only when the key is absent: `undefined` is a real
  // answer (the engine's refusal) the tests exercise.
  const engineCompletion = 'engineCompletion' in overrides ? overrides.engineCompletion : 'foo()'
  const { withHooks = false, ...deps } = overrides
  const outcomes: TabOutcome[] = []
  const snapshots: TabCompletionSnapshot[] = []
  const complete = vi.fn((snapshot: TabCompletionSnapshot) => {
    snapshots.push(snapshot)
    return Promise.resolve({ completion: engineCompletion, usage: Promise.resolve(USAGE) })
  })
  const reserve = vi.fn((): Promise<TabReservation | undefined> => Promise.resolve(RESERVATION))
  const settle = vi.fn((): void => undefined)
  const requestUse = vi.fn((): Promise<TabConsentGrant | undefined> => Promise.resolve(GRANTED))
  const beforeRead = vi.fn((): Promise<boolean> => Promise.resolve(true))
  const afterEdit = vi.fn((): void => undefined)
  const log = new FakeLogOutputChannel()
  const textListeners: ((event: TabTextChangeEvent) => void)[] = []
  const handle = entryProvider({
    uiTable: UI_TEXT,
    locale: BASE_LOCALE,
    settings: () => ({
      tabModel: 'muse-spark-1.3',
      tabLanguages: { '*': true },
      tabMultiline: 'auto',
      tabTrigger: 'automatic',
      tabWithCopilot: 'yield',
    }),
    isPaidOn: () => true,
    isKeyStored: () => true,
    isTrusted: () => workspace.isTrusted,
    isSnoozed: () => false,
    realPath: (absolutePath) => Promise.resolve(absolutePath),
    foreignSetting: () => undefined,
    isCopilotExtensionPresent: () => false,
    filesExclude: () => ({}),
    workspaceRoots: wsRoots,
    ignoreFileExists: () => false,
    runGit: () => Promise.reject(gitExit(1)),
    onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
    onDidChangeTextDocument: (listener) => {
      textListeners.push(listener)
      return { dispose: () => undefined }
    },
    engine: { complete },
    spend: {
      reserve,
      settle,
      todayTotalUsd: () => Usd.from(0).toAmount(),
      todayRequests: () => 0,
    },
    consent: { requestUse },
    hooks: withHooks ? bridge({ beforeRead, afterEdit }) : undefined,
    onOutcome: (outcome) => {
      outcomes.push(outcome)
    },
    log,
    ...deps,
  })
  const found = handle.provider
  return {
    outcomes,
    snapshots,
    reserve,
    settle,
    requestUse,
    complete,
    beforeRead,
    afterEdit,
    log,
    textListeners,
    provider: found,
    handle,
    serve: async (
      text = 'const y = ',
      line = 0,
      character = 10,
      token = new FakeCancellationToken(),
      file = '/ws/file.ts',
    ) => {
      const document = new FakeTextDocument(Uri.file(file), 'typescript', text)
      const result = await found.provideInlineCompletionItems(
        document,
        new Position(line, character),
        {
          triggerKind: InlineCompletionTriggerKind.Automatic,
          selectedCompletionInfo: undefined,
        },
        token,
      )
      if (result === undefined || !Array.isArray(result)) {
        throw new Error('the provider returned no items array')
      }
      return result
    },
  }
}

describe('createTabProvider', () => {
  it('serves one item with the accept command, reserves and settles', async () => {
    const harness = providerHarness()
    const items = await harness.serve()
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item?.insertText).toBe('foo()')
    expect(item?.command?.command).toBe(TAB_COMMAND_IDS.afterAccept)
    const args = tabAcceptArgsOf(item?.command?.arguments?.[0])
    expect(args).toMatchObject({ filePath: '/ws/file.ts', completion: 'foo()' })
    expect(harness.outcomes).toEqual([{ kind: 'served', mode: 'fast' }])
    expect(harness.reserve).toHaveBeenCalledOnce()
    expect(harness.reserve).toHaveBeenCalledWith({
      model: 'muse-spark-1.3',
      inputBytes: expect.any(Number),
      maxOutputTokens: TAB_FAST_MAX_OUTPUT_TOKENS,
    })
    // Usage settles the same reservation when the request ends.
    await vi.waitFor(() => {
      expect(harness.settle).toHaveBeenCalledWith(RESERVATION, USAGE)
    })
  })

  it('redacts every byte sent: a secret reaches the engine only as the mark', async () => {
    const harness = providerHarness()
    const secret = SYNTHETIC.awsAccessKey
    await harness.serve(`key = "${secret}"\nconst y = `, 1, 10)
    expect(harness.snapshots).toHaveLength(1)
    const snapshot = harness.snapshots[0]
    expect(snapshot?.prefix).not.toContain(secret)
    expect(snapshot?.prefix).toContain(REDACTED_MARK)
    expect(snapshot?.relativePath).toBe('file.ts')
    // The reply is placed against the cursor's own line (RVM94LC finding 2).
    expect(snapshot?.cursorLineBefore).toBe('const y = ')
  })

  it('stays quiet wherever D73 says quiet, without a request', async () => {
    const quietCases: [string, Partial<TabProviderDeps>][] = [
      ['snoozed', { isSnoozed: () => true }],
      ['paid-off', { isPaidOn: () => false }],
      ['no-key', { isKeyStored: () => false }],
      ['outside-workspace', { workspaceRoots: () => [] }],
      ['language-off', { settings: languagesOffSettings }],
      ['ineligible-file', { filesExclude: () => ({ '*.ts': true }) }],
    ]
    for (const [name, extra] of quietCases) {
      const harness = providerHarness(extra)
      await expect(harness.serve(), name).resolves.toEqual([])
      expect(harness.complete, name).not.toHaveBeenCalled()
    }
    const untrusted = providerHarness({ isTrusted: () => false })
    await expect(untrusted.serve()).resolves.toEqual([])
    const scheme = providerHarness()
    const untitled = new FakeTextDocument(new UntitledUri('/blank'), 'typescript', 'x')
    const found = scheme.provider
    const result = await found.provideInlineCompletionItems(
      untitled,
      new Position(0, 1),
      { triggerKind: InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined },
      new FakeCancellationToken(),
    )
    expect(result).toEqual([])
  })

  it('stays quiet while the suggest widget has a selection', async () => {
    const harness = providerHarness()
    const document = new FakeTextDocument(Uri.file('/ws/file.ts'), 'typescript', 'console.')
    const result = await harness.provider.provideInlineCompletionItems(
      document,
      new Position(0, 8),
      {
        triggerKind: InlineCompletionTriggerKind.Automatic,
        selectedCompletionInfo: {
          range: new Range(new Position(0, 7), new Position(0, 8)),
          text: '.',
        },
      },
      new FakeCancellationToken(),
    )
    expect(result).toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'suggest-selection' }])
  })

  it('obeys the onInvoke trigger setting on automatic triggers, but Invoke still works', async () => {
    const harness = providerHarness({ settings: onInvokeSettings })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'trigger-setting' }])
    const document = new FakeTextDocument(Uri.file('/ws/file.ts'), 'typescript', 'const y = ')
    const invoked = await harness.provider.provideInlineCompletionItems(
      document,
      new Position(0, 10),
      { triggerKind: InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined },
      new FakeCancellationToken(),
    )
    expect(invoked).toHaveLength(1)
  })

  it('yields automatic requests to Copilot, but Invoke still works', async () => {
    const harness = providerHarness({
      isCopilotExtensionPresent: () => true,
      foreignSetting: (section) => (section === 'github.copilot' ? { '*': true } : undefined),
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'copilot' }])
  })

  it('sends nothing on Deny, and nothing past the budget', async () => {
    const denied = providerHarness({ consent: { requestUse: () => Promise.resolve(undefined) } })
    await expect(denied.serve()).resolves.toEqual([])
    expect(denied.outcomes).toEqual([{ kind: 'quiet', reason: 'consent-denied' }])
    expect(denied.complete).not.toHaveBeenCalled()
    const broke = providerHarness({
      spend: {
        reserve: () => Promise.resolve(undefined),
        settle: () => undefined,
        todayTotalUsd: () => Usd.from(1).toAmount(),
        todayRequests: () => 20,
      },
    })
    await expect(broke.serve()).resolves.toEqual([])
    expect(broke.outcomes).toEqual([{ kind: 'quiet', reason: 'budget' }])
  })

  it('never starts a request the token cancelled in time, and never aborts a sent one', async () => {
    const early = providerHarness()
    const cancelled = new FakeCancellationToken()
    cancelled.cancel()
    const document = new FakeTextDocument(Uri.file('/ws/file.ts'), 'typescript', 'const y = ')
    const result = await early.provider.provideInlineCompletionItems(
      document,
      new Position(0, 10),
      { triggerKind: InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined },
      cancelled,
    )
    expect(result).toEqual([])
    expect(early.complete).not.toHaveBeenCalled()
    expect(early.outcomes).toEqual([{ kind: 'quiet', reason: 'cancelled-before-send' }])
    // Cancellation after consent stops before ledger admission: nothing is reserved or billed.
    expect(early.reserve).not.toHaveBeenCalled()
    expect(early.settle).not.toHaveBeenCalled()

    const token = new FakeCancellationToken()
    const late = providerHarness({
      engine: {
        complete: () => {
          token.cancel()
          return Promise.resolve({ completion: 'foo()', usage: Promise.resolve(USAGE) })
        },
      },
    })
    const items = await late.provider.provideInlineCompletionItems(
      document,
      new Position(0, 10),
      { triggerKind: InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined },
      token,
    )
    // The request ran to its end: settled, but no ghost text.
    expect(items).toEqual([])
    await vi.waitFor(() => {
      expect(late.settle).toHaveBeenCalledWith(RESERVATION, USAGE)
    })
    expect(late.outcomes).toEqual([{ kind: 'served', mode: 'fast' }])
  })

  it('keeps the reservation when the request fails, and logs only the class', async () => {
    const harness = providerHarness({
      engine: {
        complete: () => Promise.reject(new Error('boom in /ws/file.ts')),
      },
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.settle).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ kind: 'failed', failure: 'request' }])
    expect(harness.log.warn).toHaveBeenCalledWith('Tab request failed (request)')
  })

  it('settles even when the engine has no suggestion', async () => {
    const harness = providerHarness({ engineCompletion: undefined })
    await expect(harness.serve()).resolves.toEqual([])
    await vi.waitFor(() => {
      expect(harness.settle).toHaveBeenCalledWith(RESERVATION, USAGE)
    })
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'no-suggestion' }])
  })

  it('logs counts and timings, never code, a completion or a path', async () => {
    const harness = providerHarness()
    const secret = SYNTHETIC.awsAccessKey
    await harness.serve(`key = "${secret}"\nconst y = `, 1, 10)
    const logged = [
      ...harness.log.info.mock.calls,
      ...harness.log.warn.mock.calls,
      ...harness.log.error.mock.calls,
      ...harness.log.debug.mock.calls,
      ...harness.log.trace.mock.calls,
    ]
      .map((call) => String(call[0]))
      .join('\n')
    expect(logged).toContain('Tab suggestion served')
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain('foo()')
    expect(logged).not.toContain('/ws/file.ts')
  })

  it('reports a full accept exactly, with 1-based lines and columns', async () => {
    const harness = providerHarness({ withHooks: true })
    const items = await harness.serve('const y = ', 0, 10)
    const args = tabAcceptArgsOf(items[0]?.command?.arguments?.[0])
    expect(args).toBeDefined()
    harness.handle.acceptNotified(items[0]?.command?.arguments?.[0])
    expect(harness.afterEdit).toHaveBeenCalledWith({
      filePath: '/ws/file.ts',
      generationId: 'request-1',
      model: 'muse-spark-1.3',
      workspaceRoots: ['/ws'],
      oldLine: 'const y = ',
      newLine: 'const y = foo()',
      range: { startLineNumber: 1, startColumn: 11, endLineNumber: 1, endColumn: 11 },
      oldString: '',
      newString: 'foo()',
      inferred: false,
    })
    // A second report of the same item is stale.
    harness.handle.acceptNotified(items[0]?.command?.arguments?.[0])
    expect(harness.afterEdit).toHaveBeenCalledOnce()
  })

  it('ignores a foreign accept', async () => {
    const harness = providerHarness({ withHooks: true })
    await harness.serve()
    harness.handle.acceptNotified({ nonsense: true })
    expect(harness.afterEdit).not.toHaveBeenCalled()
  })

  it('infers a partial accept from typing the rest’s start, word by word', async () => {
    const harness = providerHarness({ engineCompletion: 'foo(bar)', withHooks: true })
    await harness.serve('const y = ', 0, 10)
    const fire = (insertedText: string, at: number): void => {
      for (const listener of harness.textListeners) {
        listener({
          changes: [textChange({ insertedText, startCharacter: at, endCharacter: at })],
        })
      }
    }
    fire('foo(', 10)
    expect(harness.afterEdit).toHaveBeenCalledWith(
      expect.objectContaining({ newString: 'foo(', inferred: true }),
    )
    // The rest now starts where `foo(` ended (RVM94HU 6).
    fire('bar)', 14)
    expect(harness.afterEdit).toHaveBeenCalledTimes(2)
    expect(harness.afterEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        newString: 'bar)',
        oldLine: 'const y = foo(',
        newLine: 'const y = foo(bar)',
        inferred: true,
        range: { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 15 },
      }),
    )
    // The rest is spent: further typing is not an accept.
    fire('!', 18)
    expect(harness.afterEdit).toHaveBeenCalledTimes(2)
  })

  it('never infers from keystrokes or foreign text', async () => {
    const harness = providerHarness({ withHooks: true })
    await harness.serve('const y = ', 0, 10)
    for (const listener of harness.textListeners) {
      listener({ changes: [textChange({ insertedText: 'f' })] })
    }
    expect(harness.afterEdit).not.toHaveBeenCalled()
  })

  it('reports a full accept whose document change arrived first, once and exactly (RVM94HU 5)', async () => {
    const harness = providerHarness({ engineCompletion: 'foo(bar)', withHooks: true })
    const items = await harness.serve('const y = ', 0, 10)
    for (const listener of harness.textListeners) {
      listener({ changes: [textChange({ insertedText: 'foo(bar)' })] })
    }
    expect(harness.afterEdit).not.toHaveBeenCalled()
    harness.handle.acceptNotified(items[0]?.command?.arguments?.[0])
    expect(harness.afterEdit).toHaveBeenCalledOnce()
    expect(harness.afterEdit).toHaveBeenCalledWith(
      expect.objectContaining({ newString: 'foo(bar)', inferred: false }),
    )
  })

  it('reads none of a refused file’s text (RVM94HU 17)', async () => {
    const harness = providerHarness()
    const document = new FakeTextDocument(Uri.file('/ws/.env'), 'dotenv', 'TOKEN=x')
    const getText = vi.spyOn(document, 'getText')
    const result = await harness.provider.provideInlineCompletionItems(
      document,
      new Position(0, 6),
      { triggerKind: InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined },
      new FakeCancellationToken(),
    )
    expect(result).toEqual([])
    expect(getText).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'ineligible-file' }])
  })

  it('never reads a link whose target leaves the folder or is private (RVM94HU 12)', async () => {
    const outside = providerHarness({
      realPath: (absolutePath) =>
        Promise.resolve(absolutePath === '/ws/file.ts' ? '/elsewhere/file.ts' : absolutePath),
    })
    await expect(outside.serve()).resolves.toEqual([])
    const privateTarget = providerHarness({
      realPath: (absolutePath) =>
        Promise.resolve(absolutePath === '/ws/file.ts' ? '/ws/.env' : absolutePath),
    })
    await expect(privateTarget.serve()).resolves.toEqual([])
    const unresolved = providerHarness({
      realPath: () => Promise.reject(new Error('link loop')),
    })
    await expect(unresolved.serve()).resolves.toEqual([])
    for (const harness of [outside, privateTarget, unresolved]) {
      expect(harness.complete).not.toHaveBeenCalled()
      expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'ineligible-file' }])
    }
  })

  it('checks a nested folder’s file relative to that folder, and serves any folder (RVM94HU 13)', async () => {
    const gitRuns: string[][] = []
    const harness = providerHarness({
      workspaceRoots: (absolutePath) => {
        if (absolutePath.startsWith('/ws/src/')) {
          return ['/ws/src', '/ws']
        }
        return absolutePath.startsWith('/second/') ? ['/second'] : []
      },
      runGit: (args, cwd) => {
        gitRuns.push([...args, `cwd=${cwd}`])
        return Promise.reject(gitExit(1))
      },
    })
    await harness.serve('const y = ', 0, 10, undefined, '/ws/src/sensitive.ts')
    expect(gitRuns[0]).toEqual(['check-ignore', '-q', '--', 'sensitive.ts', 'cwd=/ws/src'])
    expect(harness.snapshots[0]?.relativePath).toBe('sensitive.ts')
    const second = await harness.serve('const y = ', 0, 10, undefined, '/second/b.ts')
    expect(second).toHaveLength(1)
    expect(harness.snapshots[1]?.relativePath).toBe('b.ts')
  })

  it('sends nothing when a secret spans the cursor (RVM94HU 15)', async () => {
    const harness = providerHarness()
    const secret = SYNTHETIC.awsAccessKey
    const text = `key = "${secret}"`
    await expect(harness.serve(text, 0, 'key = "'.length + 8)).resolves.toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.reserve).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'secret-at-cursor' }])
  })

  it('prices everything it sends: the instructions and the whole message (RVM94HU 16)', async () => {
    const harness = providerHarness()
    await harness.serve()
    const sent =
      TAB_MODEL_TEXT.tabSystem +
      tabUserText({
        path: 'file.ts',
        languageId: 'typescript',
        prefix: 'const y = ',
        suffix: '',
        snippets: '',
      })
    expect(harness.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ inputBytes: Buffer.byteLength(sent, 'utf8') }),
    )
  })

  it('checks again after the waits, and releases the reservation (RVM94HU 2)', async () => {
    const state = { isSnoozed: false }
    const settled: unknown[][] = []
    const harness = providerHarness({
      isSnoozed: () => state.isSnoozed,
      spend: {
        reserve: () => {
          // Snoozed while the ledger writes the reservation.
          state.isSnoozed = true
          return Promise.resolve(RESERVATION)
        },
        settle: (...args) => {
          settled.push(args)
        },
        todayTotalUsd: () => Usd.from(0).toAmount(),
        todayRequests: () => 0,
      },
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(settled).toEqual([[RESERVATION, NOTHING_SENT]])
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'snoozed' }])
  })

  it('sends and reports nothing once disposed mid-request (RVM94HU 2)', async () => {
    const box: { harness?: ProviderHarness } = {}
    const harness = providerHarness({
      consent: {
        requestUse: () => {
          box.harness?.handle.dispose()
          return Promise.resolve(GRANTED)
        },
      },
    })
    box.harness = harness
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([])
  })

  it('hands the engine the token’s state for its debounce and slot wait (RVM94HU 3)', async () => {
    const harness = providerHarness()
    const token = new FakeCancellationToken()
    await harness.serve('const y = ', 0, 10, token)
    const snapshot = harness.snapshots[0]
    expect(snapshot?.isCancelled()).toBe(false)
    token.cancel()
    expect(snapshot?.isCancelled()).toBe(true)
  })

  it('reserves the multi-line cap on a blank line', async () => {
    const harness = providerHarness()
    const items = await harness.serve('', 0, 0)
    expect(items).toHaveLength(1)
    expect(harness.outcomes).toEqual([{ kind: 'served', mode: 'multiline' }])
    expect(harness.reserve).toHaveBeenCalledWith({
      model: 'muse-spark-1.3',
      inputBytes: expect.any(Number),
      maxOutputTokens: TAB_MULTILINE_MAX_OUTPUT_TOKENS,
    })
  })
})

// Related-file privacy is exercised with real metadata and fake open documents.
describe('Tab multi-line context wiring', () => {
  it('orders recent edits and definitions, redacts snippets and reserves exactly the sent text', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-context-'))
    const source = path.join(root, `main-${SYNTHETIC.awsAccessKey}.ts`)
    const edited = Uri.file(path.join(root, `z-${SYNTHETIC.awsAccessKey}.ts`))
    const definition = Uri.file(path.join(root, 'a.ts'))
    const texts = new Map([
      [edited.fsPath, `const key = "${SYNTHETIC.awsAccessKey}"`],
      [definition.fsPath, 'export const helper = 1'],
    ])
    for (const [file, text] of texts) writeFileSync(file, text)
    vi.mocked(openContextDocument).mockImplementation((uri) =>
      Promise.resolve(new FakeTextDocument(uri, 'typescript', texts.get(uri.fsPath) ?? '')),
    )
    vi.mocked(commands.executeCommand).mockResolvedValue([
      { uri: definition, range: new Range(new Position(0, 0), new Position(0, 1)) },
    ])
    const harness = providerHarness({
      workspaceRoots: () => [root],
      recentEdits: () => [{ uri: edited, line: 0 }],
    })
    try {
      await harness.serve('helper() {', 0, 10, new FakeCancellationToken(), source)
      const snapshot = harness.snapshots[0]
      expect(snapshot?.relativePath).toBe(`main-${REDACTED_MARK}.ts`)
      expect(snapshot?.snippets).toContain('export const helper = 1')
      expect(snapshot?.snippets).toContain(REDACTED_MARK)
      expect(snapshot?.snippets).not.toContain(SYNTHETIC.awsAccessKey)
      expect(snapshot?.snippets.indexOf('a.ts')).toBeLessThan(
        snapshot?.snippets.indexOf(`z-${REDACTED_MARK}.ts`) ?? -1,
      )
      expect(workspace.openTextDocument).toHaveBeenCalledTimes(2)
      expect(harness.reserve).toHaveBeenCalledWith({
        model: 'muse-spark-1.3',
        maxOutputTokens: TAB_MULTILINE_MAX_OUTPUT_TOKENS,
        inputBytes: Buffer.byteLength(
          TAB_MODEL_TEXT.tabSystem +
            tabUserText({
              path: `main-${REDACTED_MARK}.ts`,
              languageId: 'typescript',
              prefix: 'helper() {',
              suffix: '',
              snippets: snapshot?.snippets ?? '',
            }),
          'utf8',
        ),
      })
      expect(JSON.stringify(harness.log.trace.mock.calls)).not.toContain('helper')
    } finally {
      harness.handle.dispose()
      await removeFolder(root)
    }
  })

  it.each([
    'private',
    'protected',
    'gitignored',
    'cursorignored',
    'continueignored',
    'excluded',
    'oversize',
    'outside',
    'linked',
    'unreadable',
  ])('never opens a %s context file', async (reason) => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-context-'))
    const name =
      new Map([
        ['private', '.env'],
        ['protected', '.muse/data.ts'],
      ]).get(reason) ?? 'related.ts'
    const uri = Uri.file(path.join(root, name))
    mkdirSync(path.dirname(uri.fsPath), { recursive: true })
    if (reason !== 'unreadable')
      writeFileSync(
        uri.fsPath,
        reason === 'oversize' ? 'x'.repeat(TAB_FILE_MAX_BYTES + 1) : 'related text',
      )
    const harness = providerHarness({
      recentEdits: () => [{ uri, line: 0 }],
      workspaceRoots: (file) => (reason === 'outside' && file === uri.fsPath ? [] : [root]),
      realPath: (file) =>
        Promise.resolve(
          reason === 'linked' && file === uri.fsPath ? path.join(root, '..', 'external.ts') : file,
        ),
      filesExclude: () => (reason === 'excluded' ? { 'related.ts': true } : {}),
      ignoreFileExists: (file) =>
        reason === 'cursorignored'
          ? file.endsWith('.cursorignore')
          : reason === 'continueignored' && file.endsWith('.continueignore'),
      runGit: (args) =>
        args.includes('related.ts') &&
        (reason === 'gitignored' ||
          (reason === 'cursorignored' && args.some((arg) => arg.includes('core.excludesFile'))) ||
          (reason === 'continueignored' && args.some((arg) => arg.includes('core.excludesFile'))))
          ? Promise.resolve('related.ts')
          : Promise.reject(gitExit(1)),
    })
    try {
      await harness.serve(
        'helper() {',
        0,
        10,
        new FakeCancellationToken(),
        path.join(root, 'file.ts'),
      )
      expect(workspace.openTextDocument).not.toHaveBeenCalled()
      expect(harness.snapshots[0]?.snippets).toBe('')
    } finally {
      harness.handle.dispose()
      await removeFolder(root)
    }
  })

  it.each(['unsaved-oversize', 'language-off', 'hook-denied', 'untrusted-after-open'])(
    'refuses %s context before using its text',
    async (reason) => {
      const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-context-'))
      const uri = Uri.file(path.join(root, 'related.ts'))
      writeFileSync(uri.fsPath, 'small on disk')
      const document = new FakeTextDocument(
        uri,
        reason === 'language-off' ? 'markdown' : 'typescript',
        reason === 'unsaved-oversize' ? 'x'.repeat(TAB_FILE_MAX_BYTES + 1) : 'related text',
      )
      const read = vi.spyOn(document, 'getText')
      let isTrusted = true
      vi.mocked(openContextDocument).mockImplementation(() => {
        if (reason === 'untrusted-after-open') isTrusted = false
        return Promise.resolve(document)
      })
      const harness = providerHarness({
        workspaceRoots: () => [root],
        recentEdits: () => [{ uri, line: 0 }],
        isTrusted: () => isTrusted,
        settings: () => ({
          tabModel: 'muse-spark-1.3',
          tabLanguages: { '*': true, markdown: false },
          tabMultiline: 'auto',
          tabTrigger: 'automatic',
          tabWithCopilot: 'yield',
        }),
        hooks: bridge({
          beforeRead: (file) => Promise.resolve(reason !== 'hook-denied' || file !== uri.fsPath),
        }),
      })
      try {
        await harness.serve(
          'helper() {',
          0,
          10,
          new FakeCancellationToken(),
          path.join(root, 'file.ts'),
        )
        if (reason === 'hook-denied') expect(read).toHaveBeenCalledOnce()
        else expect(read).not.toHaveBeenCalled()
        expect(harness.snapshots[0]?.snippets ?? '').toBe('')
      } finally {
        harness.handle.dispose()
        await removeFolder(root)
      }
    },
  )

  it('reads no related files in fast mode', async () => {
    const recentEdits = vi.fn(() => [{ uri: Uri.file('/ws/related.ts'), line: 0 }])
    const harness = providerHarness({ recentEdits })
    await harness.serve()
    expect(recentEdits).not.toHaveBeenCalled()
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
    expect(commands.executeCommand).not.toHaveBeenCalled()
    harness.handle.dispose()
  })
})

describe('M94KW configured hooks through the lazy factory', () => {
  it('vetoes before a model call, then observes and edits an accepted completion with a real fake hook', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'muse-tab-hook-flow-'))
    const file = path.join(root, 'file.ts')
    const fixture = path.resolve('test/fixtures/tabHooks/completion.mjs')
    const hookRuns: {
      readonly command: string
      readonly stdin: string
      readonly timeoutMs: number
    }[] = []
    const files = new Map<string, string | Uint8Array>([
      [
        path.join(root, '.muse/spark-hooks.json').replaceAll('\\', '/'),
        JSON.stringify({
          hooks: {
            beforeTabFileRead: [
              {
                format: 'cursor',
                sourceEvent: 'beforeTabFileRead',
                failClosed: false,
                matcher: 'TabRead',
                hooks: [{ type: 'command', command: 'fake-read', timeout: 10 }],
              },
            ],
            afterTabFileEdit: [
              {
                format: 'cursor',
                sourceEvent: 'afterTabFileEdit',
                matcher: 'TabWrite',
                hooks: [{ type: 'command', command: 'fake-edit' }],
              },
            ],
          },
        }),
      ],
    ])
    const runner = new ExtensionHookRunner({
      io: memoryContextIo(files),
      platform: process.platform,
      workspaceRoot: root,
      settingsPath: path.join(root, 'config/settings.json'),
      isWorkspaceTrusted: () => true,
      isHooksEnabled: () => true,
      now: Date.now,
      runHook: async (command, stdin, cwd, timeoutMs, signal) => {
        hookRuns.push({ command, stdin, timeoutMs })
        return await runCommand({
          file: process.execPath,
          args: [fixture],
          cwd,
          env: hookEnvironment(process.env, process.platform),
          timeoutMs,
          signal,
          stdin,
          maxOutputBytes: HOOK_OUTPUT_MAX_BYTES,
          tree: {
            platform: process.platform,
            systemRoot: process.env['SystemRoot'],
            log: () => undefined,
          },
        })
      },
      notice: () => undefined,
      showOutput: () => undefined,
      warn: () => undefined,
    })
    await runner.reload()
    const harness = providerHarness({
      workspaceRoots: () => [root],
      hookDispatch: {
        isHooksEnabled: () => true,
        load: () => Promise.resolve(runner),
      },
    })
    try {
      await expect(
        harness.serve('BLOCK_TAB', 0, 0, new FakeCancellationToken(), file),
      ).resolves.toEqual([])
      expect(harness.complete).not.toHaveBeenCalled()
      await harness.serve('BLOCK_TAB', 0, 0, new FakeCancellationToken(), file)
      expect(hookRuns).toHaveLength(1)
      writeFileSync(file, 'const y = ')
      const items = await harness.serve('const y = ', 0, 10, new FakeCancellationToken(), file)
      expect(items).toHaveLength(1)
      expect(hookRuns.at(-1)?.timeoutMs).toBe(1500)
      const args = items[0]?.command?.arguments?.[0]
      writeFileSync(file, 'const y = foo()')
      harness.handle.acceptNotified(args)
      await vi.waitFor(() => {
        expect(readFileSync(file, 'utf8')).toContain('fake hook edited accepted completion')
      })
      expect(JSON.parse(hookRuns.at(-1)?.stdin ?? '{}')).toMatchObject({
        hook_event_name: 'afterTabFileEdit',
        generation_id: 'request-3',
        file_path: file,
        edits: [
          {
            old_string: '',
            new_string: 'foo()',
            old_line: 'const y = ',
            new_line: 'const y = foo()',
            range: { start_line_number: 1, start_column: 11, end_line_number: 1, end_column: 11 },
          },
        ],
      })
      expect(harness.complete).toHaveBeenCalledOnce()
    } finally {
      harness.handle.dispose()
      await removeFolder(root)
    }
  })

  it('keeps completion bytes identical with no configured guard, including JSON-expanded text', async () => {
    const plain = providerHarness()
    const run = vi.fn().mockResolvedValue([])
    const wired = providerHarness({
      hookDispatch: {
        isHooksEnabled: () => true,
        configurationVersion: () => 'empty',
        hookState: () => Promise.resolve('absent'),
        run,
      },
    })
    const text = 'const y = ' + '"'.repeat(TAB_FILE_MAX_BYTES / 2)
    expect(JSON.stringify(await wired.serve(text))).toBe(JSON.stringify(await plain.serve(text)))
    expect(wired.snapshots).toEqual(
      plain.snapshots.map((snapshot) => ({ ...snapshot, isCancelled: expect.any(Function) })),
    )
    expect(run).not.toHaveBeenCalled()
    plain.handle.dispose()
    wired.handle.dispose()
  })
})

describe('Tab accepted edit metadata', () => {
  it('reports only the remaining full insertion after a partial word', async () => {
    const harness = providerHarness({ engineCompletion: 'foo(bar)', withHooks: true })
    const items = await harness.serve()
    harness.textListeners[0]?.({ changes: [textChange({ insertedText: 'foo(' })] })
    harness.handle.acceptNotified(items[0]?.command?.arguments?.[0])
    expect(harness.afterEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        newString: 'bar)',
        oldLine: 'const y = foo(',
        newLine: 'const y = foo(bar)',
        range: { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 15 },
        inferred: false,
      }),
    )
  })
})

// RVM94KR: the configured hook file, the bound policy and the bound model,
// through the shipped lazy factory and the real window hook runner.
const PROJECT_SPARK = '/ws/.muse/spark-hooks.json'
const STANDARD = 'muse-spark-1.3'
const CONTRIBUTOR = 'muse-spark-1.3-contributor'

function sparkDoc(doc: unknown): string {
  return JSON.stringify({ hooks: doc })
}

const READ_GUARD = sparkDoc({
  beforeTabFileRead: [{ hooks: [{ type: 'command', command: 'guard' }] }],
})

/** The window's runner over in-memory hook files; `runHook` answers each guard. */
function hookRunner(
  files: Map<string, string | Uint8Array>,
  runHook: (command: string) => ShellResult | Promise<ShellResult>,
): ExtensionHookRunner {
  return new ExtensionHookRunner({
    io: memoryContextIo(files),
    platform: 'linux',
    workspaceRoot: '/ws',
    settingsPath: '/home/user/.config/muse/settings.json',
    isWorkspaceTrusted: () => true,
    isHooksEnabled: () => true,
    now: Date.now,
    runHook: (command) => Promise.resolve(runHook(command)),
    notice: () => undefined,
    showOutput: () => undefined,
    warn: () => undefined,
  })
}

/** The provider through the lazy factory over a loaded window runner. */
async function runnerHarness(
  files: Map<string, string | Uint8Array>,
  runHook: (command: string) => ShellResult | Promise<ShellResult>,
  overrides: Partial<TabProviderDeps> = {},
): Promise<{ readonly runner: ExtensionHookRunner; readonly harness: ProviderHarness }> {
  const runner = hookRunner(files, runHook)
  await runner.reload()
  const harness = providerHarness({
    hookDispatch: { isHooksEnabled: () => true, load: () => Promise.resolve(runner) },
    ...overrides,
  })
  return { runner, harness }
}

/** What a request's bound policy reads, changed under it by the cases. */
interface PolicyState {
  version: string
  isTrusted: boolean
  exclude: Record<string, boolean>
  model: string
}

function modelSettings(model: () => string): TabProviderDeps['settings'] {
  return () => ({
    tabModel: model(),
    tabLanguages: { '*': true },
    tabMultiline: 'auto',
    tabTrigger: 'automatic',
    tabWithCopilot: 'yield',
  })
}

describe('RVM94KR 1: a hook file that does not load whole refuses every read', () => {
  it.each([
    ['invalid JSON', '{"hooks": {'],
    [
      'an invalid Tab import group',
      sparkDoc({
        beforeTabFileRead: [
          {
            format: 'cursor',
            sourceEvent: 'afterTabFileEdit',
            hooks: [{ type: 'command', command: 'guard' }],
          },
        ],
      }),
    ],
    [
      'a guard whose matcher never names TabRead',
      sparkDoc({
        beforeTabFileRead: [{ matcher: 'TabWrite', hooks: [{ type: 'command', command: 'g' }] }],
      }),
    ],
    ['a misspelt event name', sparkDoc({ beforeTabFileread: [] })],
  ])('with %s, says why and sends nothing', async (_name, text) => {
    const runs: string[] = []
    const { harness } = await runnerHarness(new Map([[PROJECT_SPARK, text]]), (command) => {
      runs.push(command)
      return hookResult('{"permission":"allow"}')
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.requestUse).not.toHaveBeenCalled()
    expect(runs).toEqual([])
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'hooks-invalid' }])
    harness.handle.dispose()
  })

  it('keeps refusing after a denying guard file breaks, and reads again once fixed', async () => {
    const files = new Map<string, string | Uint8Array>([[PROJECT_SPARK, READ_GUARD]])
    const { runner, harness } = await runnerHarness(files, () =>
      hookResult('{"permission":"deny"}'),
    )
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'ineligible-file' }])
    files.set(PROJECT_SPARK, '{"hooks": {"beforeTabFileRead": [')
    await runner.reload()
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.outcomes.at(-1)).toEqual({ kind: 'quiet', reason: 'hooks-invalid' })
    expect(harness.complete).not.toHaveBeenCalled()
    files.set(PROJECT_SPARK, sparkDoc({}))
    await runner.reload()
    await expect(harness.serve()).resolves.toHaveLength(1)
    expect(harness.complete).toHaveBeenCalledOnce()
    harness.handle.dispose()
  })

  it('reads without a guard when no hook file exists', async () => {
    const { harness } = await runnerHarness(new Map(), () => hookResult('{"permission":"deny"}'))
    await expect(harness.serve()).resolves.toHaveLength(1)
    harness.handle.dispose()
  })
})

describe('RVM94KR 2: a request is bound to the policy it started under', () => {
  it('drops a request whose hook configuration changes while the question is open', async () => {
    const hooks = { version: 'v1', verdict: 'allow' }
    const run = vi.fn(() =>
      Promise.resolve([hookResult(JSON.stringify({ permission: hooks.verdict }))]),
    )
    const harness = providerHarness({
      hookDispatch: {
        isHooksEnabled: () => true,
        configurationVersion: () => hooks.version,
        hookState: () => Promise.resolve('present'),
        run,
      },
      consent: {
        requestUse: () => {
          hooks.version = 'v2'
          hooks.verdict = 'deny'
          return Promise.resolve(GRANTED)
        },
      },
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'policy-changed' }])
    // The next request is judged under the new configuration: refused.
    await expect(harness.serve()).resolves.toEqual([])
    expect(run).toHaveBeenCalledTimes(2)
    expect(harness.complete).not.toHaveBeenCalled()
    harness.handle.dispose()
  })

  it.each<readonly [string, (state: PolicyState) => void]>([
    [
      'the hook configuration',
      (state) => {
        state.version = 'v2'
      },
    ],
    [
      'trust',
      (state) => {
        state.isTrusted = false
      },
    ],
    [
      'files.exclude',
      (state) => {
        state.exclude = { '*.ts': true }
      },
    ],
    [
      'the model',
      (state) => {
        state.model = CONTRIBUTOR
      },
    ],
  ])('sends nothing once %s changes during the debounce or slot wait', async (_name, change) => {
    const state: PolicyState = { version: 'v1', isTrusted: true, exclude: {}, model: STANDARD }
    const harness = providerHarness({
      isTrusted: () => state.isTrusted,
      filesExclude: () => state.exclude,
      settings: modelSettings(() => state.model),
      hookDispatch: {
        isHooksEnabled: () => true,
        configurationVersion: () => state.version,
        hookState: () => Promise.resolve('absent'),
        run: () => Promise.resolve([]),
      },
    })
    await harness.serve()
    const snapshot = harness.snapshots[0]
    expect(snapshot?.isCancelled()).toBe(false)
    change(state)
    expect(snapshot?.isCancelled()).toBe(true)
    harness.handle.dispose()
  })

  it('shows no answer reached after the policy moved, and still settles its usage', async () => {
    const state = { version: 'v1' }
    const harness = providerHarness({
      hookDispatch: {
        isHooksEnabled: () => true,
        configurationVersion: () => state.version,
        hookState: () => Promise.resolve('absent'),
        run: () => Promise.resolve([]),
      },
      engine: {
        complete: () => {
          state.version = 'v2'
          return Promise.resolve({ completion: 'foo()', usage: Promise.resolve(USAGE) })
        },
      },
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'policy-changed' }])
    await vi.waitFor(() => {
      expect(harness.settle).toHaveBeenCalledWith(RESERVATION, USAGE)
    })
    harness.handle.dispose()
  })
})

describe('RVM94KR 3: the model asked about is the model sent', () => {
  it('asks for the request’s own model and never sends one the settings moved from', async () => {
    const state = { model: CONTRIBUTOR }
    const asked: string[] = []
    const harness = providerHarness({
      settings: modelSettings(() => state.model),
      consent: {
        requestUse: (model) => {
          asked.push(model)
          // The user switches to Standard while the question is open.
          state.model = STANDARD
          return Promise.resolve(GRANTED)
        },
      },
    })
    await expect(harness.serve()).resolves.toEqual([])
    expect(asked).toEqual([CONTRIBUTOR])
    expect(harness.reserve).not.toHaveBeenCalled()
    expect(harness.complete).not.toHaveBeenCalled()
    await expect(harness.serve()).resolves.toHaveLength(1)
    expect(asked).toEqual([CONTRIBUTOR, STANDARD])
    expect(harness.snapshots.map((snapshot) => snapshot.model)).toEqual([STANDARD])
    expect(harness.reserve).toHaveBeenCalledWith(expect.objectContaining({ model: STANDARD }))
    harness.handle.dispose()
  })

  it('never dispatches Contributor after a switch to Standard while the read guard waits', async () => {
    const state = { model: CONTRIBUTOR }
    const guard = Promise.withResolvers<ShellResult>()
    const runs: string[] = []
    const asked: string[] = []
    const { harness } = await runnerHarness(
      new Map([[PROJECT_SPARK, READ_GUARD]]),
      (command) => {
        runs.push(command)
        return guard.promise
      },
      {
        settings: modelSettings(() => state.model),
        consent: {
          requestUse: (model) => {
            asked.push(model)
            return Promise.resolve(GRANTED)
          },
        },
      },
    )
    const pending = harness.serve()
    await vi.waitFor(() => {
      expect(runs).toHaveLength(1)
    })
    state.model = STANDARD
    guard.resolve(hookResult('{"permission":"allow"}'))
    await expect(pending).resolves.toEqual([])
    expect(asked).toEqual([])
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.outcomes).toEqual([{ kind: 'quiet', reason: 'policy-changed' }])
    harness.handle.dispose()
  })
})
