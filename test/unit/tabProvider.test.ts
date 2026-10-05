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
import {
  REDACTED_MARK,
  TAB_FAST_MAX_OUTPUT_TOKENS,
  TAB_FILE_MAX_BYTES,
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

describe('isFilesExcluded', () => {
  it('matches basenames, segments and alternatives', () => {
    expect(isFilesExcluded('debug.log', { '*.log': true })).toBe(true)
    expect(isFilesExcluded('a/debug.log', { '*.log': true })).toBe(true)
    expect(isFilesExcluded('a/b/c.js', { '**/b/**': true })).toBe(true)
    expect(isFilesExcluded('src/a.ts', { 'src/{a,b}.ts': true })).toBe(true)
    expect(isFilesExcluded('src/c.ts', { 'src/{a,b}.ts': true })).toBe(false)
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
  serve(text?: string, line?: number, character?: number): Promise<vscode.InlineCompletionItem[]>
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
  let provider: vscode.InlineCompletionItemProvider | undefined
  vi.mocked(languages.registerInlineCompletionItemProvider).mockImplementation(
    (_selector, found) => {
      provider = found
      return { dispose: () => undefined }
    },
  )
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
    relativeInWorkspace: (uri) =>
      uri.fsPath.startsWith('/ws/') ? uri.fsPath.slice('/ws/'.length) : undefined,
    foreignSetting: () => undefined,
    isCopilotExtensionPresent: () => false,
    filesExclude: () => ({}),
    workspaceRoots: () => ['/ws'],
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
  if (provider === undefined) {
    throw new Error('the provider was not registered')
  }
  const found = provider
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
    serve: async (text = 'const y = ', line = 0, character = 10) => {
      const document = new FakeTextDocument(Uri.file('/ws/file.ts'), 'typescript', text)
      const result = await found.provideInlineCompletionItems(
        document,
        new Position(line, character),
        {
          triggerKind: InlineCompletionTriggerKind.Automatic,
          selectedCompletionInfo: undefined,
        },
        new FakeCancellationToken(),
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
  })

  it('stays quiet wherever D73 says quiet, without a request', async () => {
    const quietCases: [string, Partial<TabProviderDeps>][] = [
      ['snoozed', { isSnoozed: () => true }],
      ['paid-off', { isPaidOn: () => false }],
      ['no-key', { isKeyStored: () => false }],
      ['outside-workspace', { relativeInWorkspace: () => undefined }],
      ['language-off', { settings: languagesOffSettings }],
      ['ineligible-file', { relativeInWorkspace: () => '.env' }],
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
    const fire = (insertedText: string): void => {
      for (const listener of harness.textListeners) {
        listener({ changes: [textChange({ insertedText })] })
      }
    }
    fire('foo(')
    expect(harness.afterEdit).toHaveBeenCalledWith(
      expect.objectContaining({ newString: 'foo(', inferred: true }),
    )
    fire('bar)')
    expect(harness.afterEdit).toHaveBeenCalledTimes(2)
    // The rest is spent: further typing is not an accept.
    fire('!')
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
