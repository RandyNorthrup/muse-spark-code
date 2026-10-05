// Tab's provider and its eligibility (M94, PLAN.md D73, Acceptance 3–5):
// quiet wherever D73 says quiet, one item otherwise, every byte sent
// redacted, and the inferred partial accept. Each exclusion has its own
// case; removing one exclusion fails its case (the red drills).

import path from 'node:path'
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
  type TabDocumentChange,
  type TabOutcome,
  type TabProviderDeps,
  type TabReportedUsage,
  type TabReservation,
  type TabTextChangeEvent,
} from '../../src/host/tab/tabBundle'
import {
  TabIgnoreCache,
  chooseTabMode,
  createTabProvider,
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
} from '../../src/shared/constants'
import { FakeCancellationToken, FakeLogOutputChannel, FakeTextDocument } from './helpers/fakes'
import { SYNTHETIC } from './helpers/syntheticTokens'
import { FakeUri } from './mocks/vscode'

const USAGE: TabReportedUsage = { inputTokens: 10, cachedTokens: 2, outputTokens: 3 }
const NOTHING_SENT: TabReportedUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }
const RESERVATION: TabReservation = {
  model: 'muse-spark-1.3',
  worstCaseUsd: 0.01,
  date: '2026-10-04',
}

beforeEach(() => {
  vi.mocked(extensions.getExtension).mockReset().mockReturnValue(undefined)
  vi.mocked(languages.registerInlineCompletionItemProvider).mockReset()
  vi.mocked(window.showQuickPick).mockReset()
  vi.mocked(window.showWarningMessage).mockReset()
  vi.mocked(commands.executeCommand).mockReset()
  vi.mocked(workspace.getWorkspaceFolder).mockReset()
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
    const refusing = {
      beforeRead: () => Promise.resolve(false),
      afterEdit: () => undefined,
    }
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
        hooks: { beforeRead: () => Promise.resolve(true), afterEdit: () => undefined },
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
  readonly handle: ReturnType<typeof createTabProvider>
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
  const requestUse = vi.fn((): Promise<boolean> => Promise.resolve(true))
  const beforeRead = vi.fn((): Promise<boolean> => Promise.resolve(true))
  const afterEdit = vi.fn((): void => undefined)
  const log = new FakeLogOutputChannel()
  const textListeners: ((event: TabTextChangeEvent) => void)[] = []
  const handle = createTabProvider({
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
      todayTotalUsd: () => 0,
      todayRequests: () => 0,
    },
    consent: { requestUse },
    hooks: withHooks ? { beforeRead, afterEdit } : undefined,
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
    const denied = providerHarness({ consent: { requestUse: () => Promise.resolve(false) } })
    await expect(denied.serve()).resolves.toEqual([])
    expect(denied.outcomes).toEqual([{ kind: 'quiet', reason: 'consent-denied' }])
    expect(denied.complete).not.toHaveBeenCalled()
    const broke = providerHarness({
      spend: {
        reserve: () => Promise.resolve(undefined),
        settle: () => undefined,
        todayTotalUsd: () => 1,
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
    // Nothing was sent, so nothing was billed: the reservation is released.
    expect(early.settle).toHaveBeenCalledWith(RESERVATION, NOTHING_SENT)

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
      generationId: args?.generationId,
      model: 'muse-spark-1.3',
      oldLine: 1,
      newLine: 1,
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
        todayTotalUsd: () => 0,
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
          return Promise.resolve(true)
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
