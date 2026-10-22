import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTabHooks } from '../../src/core/tab/tabHooks'
import { REDACTED_MARK, TAB_FILE_MAX_BYTES } from '../../src/shared/constants'
import {
  chooseTabMode,
  inferTabPartialAccept,
  isFilesExcluded,
  isTabFileEligible,
  isTabForbiddenName,
  isTabPathEligible,
  redactedHalves,
  relativeInside,
  tabAcceptArgsOf,
  type TabFileCheckDeps,
  type TabTrackedItem,
} from '../../src/host/tab/tabEligibility'
import { TabIgnoreCache } from '../../src/host/tab/tabIgnore'
import { collectingLogger } from './helpers/collectingLogger'
import { realGit } from './helpers/realGit'
import { fixtureHookRun, type TabHookFixtureMode } from './helpers/tabHookScripts'
import { usingTempDir } from './helpers/temporaryFolders'

// M94 acceptance 4 (the files Tab never reads), acceptance 5 (the
// redacted halves), acceptance 8 (the inferred partial accept) and
// acceptance 13 (fast or multi-line): the provider's file decisions over
// real git, real hook fixtures and the real redactor.

const TRACKED: TabTrackedItem = {
  uriString: 'file:///workspace/a.ts',
  filePath: '/workspace/a.ts',
  line: 9,
  character: 15,
  rest: 'value + offset;',
}

function changeOf(insertedText: string, startCharacter = 15) {
  return {
    uriString: TRACKED.uriString,
    insertedText,
    startLine: 9,
    startCharacter,
    endLine: 9,
    endCharacter: startCharacter,
  }
}

describe('isFilesExcluded', () => {
  it('excludes a glob match and everything below it', () => {
    expect(isFilesExcluded('build/out.js', { 'build/**': true })).toBe(true)
    expect(isFilesExcluded('build/nested/out.js', { 'build/**': true })).toBe(true)
    expect(isFilesExcluded('src/out.js', { 'build/**': true })).toBe(false)
  })

  it('matches a root-level file against a spanning glob', () => {
    expect(isFilesExcluded('file.ts', { '**/*.ts': true })).toBe(true)
    expect(isFilesExcluded('src/file.ts', { '**/*.ts': true })).toBe(true)
  })

  it('names a file or folder anywhere below the scope without a slash', () => {
    expect(isFilesExcluded('src/node_modules/x.js', { node_modules: true })).toBe(true)
    expect(isFilesExcluded('a/b/c.log', { '*.log': true })).toBe(true)
  })

  it('gates a when condition on its sibling', () => {
    const patterns = { '*.ts': { when: '$(basename).js' } }
    expect(isFilesExcluded('src/a.ts', patterns, () => true)).toBe(true)
    expect(isFilesExcluded('src/a.ts', patterns, () => false)).toBe(false)
    const seen: string[] = []
    isFilesExcluded('src/a.ts', patterns, (sibling) => {
      seen.push(sibling)
      return false
    })
    expect(seen).toEqual(['src/a.js'])
  })

  it('excludes nothing for a refusal or an uncompilable pattern', () => {
    expect(isFilesExcluded('a.ts', { '*.ts': false })).toBe(false)
    expect(isFilesExcluded('a.ts', { '[': true })).toBe(false)
  })
})

describe('isTabForbiddenName', () => {
  it('refuses private and protected names', () => {
    expect(isTabForbiddenName('keys/deploy.pem')).toBe(true)
    expect(isTabForbiddenName('src/a.ts')).toBe(false)
  })
})

describe('chooseTabMode', () => {
  const indented = `${' '.repeat(2)}return `
  const blank = ' '.repeat(3)
  it.each([
    ['invoke', indented, '', 'never', true, 'multiline'],
    ['plain typing', indented, '', 'auto', false, 'fast'],
    ['blank line', blank, '', 'auto', false, 'multiline'],
    ['block opener', 'function f() {', '', 'auto', false, 'multiline'],
    ['opener with text after', 'function f() {', ' x', 'auto', false, 'fast'],
    ['multiline never', blank, '', 'never', false, 'fast'],
    ['multiline onInvoke', blank, '', 'onInvoke', false, 'fast'],
  ] as const)('%s chooses %s', (_name, before, after, multiline, isInvoke, mode) => {
    expect(chooseTabMode(before, after, multiline, isInvoke)).toBe(mode)
  })
})

describe('inferTabPartialAccept', () => {
  it('accepts the start of the rest typed at its position', () => {
    expect(inferTabPartialAccept(TRACKED, changeOf('value'))).toBe(' + offset;')
    expect(inferTabPartialAccept(TRACKED, changeOf('value + offset;'))).toBe('')
  })

  it('ignores any other change', () => {
    expect(inferTabPartialAccept(TRACKED, changeOf('v'))).toBeUndefined()
    expect(inferTabPartialAccept(TRACKED, changeOf('other'))).toBeUndefined()
    expect(inferTabPartialAccept(TRACKED, changeOf('value', 3))).toBeUndefined()
    expect(
      inferTabPartialAccept(TRACKED, { ...changeOf('value'), uriString: 'file:///workspace/b.ts' }),
    ).toBeUndefined()
    expect(
      inferTabPartialAccept(TRACKED, { ...changeOf('value'), endCharacter: 18 }),
    ).toBeUndefined()
  })
})

describe('tabAcceptArgsOf', () => {
  const args = {
    filePath: '/workspace/a.ts',
    generationId: 'suggestion-1',
    model: 'muse-spark-1.3',
    positionLine: 9,
    positionCharacter: 15,
    completion: 'value;',
  }

  it('reads the item command args and refuses foreign shapes', () => {
    expect(tabAcceptArgsOf(args)).toEqual(args)
    expect(tabAcceptArgsOf({ ...args, completion: 7 })).toBeUndefined()
    expect(tabAcceptArgsOf({})).toBeUndefined()
    expect(tabAcceptArgsOf(undefined)).toBeUndefined()
  })
})

describe('relativeInside', () => {
  it('forward-slashes the inside path and refuses the outside', () => {
    const root = path.join('workspace', 'root')
    expect(relativeInside(root, path.join(root, 'a', 'b.ts'))).toBe('a/b.ts')
    expect(relativeInside(root, path.join('workspace', 'other', 'a.ts'))).toBeUndefined()
    expect(relativeInside(root, root)).toBeUndefined()
  })
})

describe('redactedHalves', () => {
  const SECRET_LINE = 'const password = "hunter22";'
  const SECRET_AT = SECRET_LINE.indexOf('hunter22')

  it('redacts a secret wholly inside one half', () => {
    const halves = redactedHalves(`prefix\n${SECRET_LINE}\nsuffix`, 7)
    expect(halves).toBeDefined()
    expect(halves?.before).not.toContain('hunter22')
    expect(halves?.after).not.toContain('hunter22')
    expect(halves?.after).toContain(REDACTED_MARK)
  })

  it('refuses a secret spanning the cursor', () => {
    expect(redactedHalves(SECRET_LINE, SECRET_AT + 3)).toBeUndefined()
  })

  it('splits clean text at the cursor', () => {
    expect(redactedHalves('const value = 42;', 13)).toEqual({
      before: 'const value =',
      after: ' 42;',
    })
  })
})

async function checksFor(
  root: string,
  mode?: TabHookFixtureMode,
): Promise<{ checks: TabFileCheckDeps; dispose: () => void }> {
  await realGit(['init', '-q'], root)
  const ignore = new TabIgnoreCache({
    runGit: realGit,
    ignoreFileExists: (absolutePath) => existsSync(absolutePath),
    workspaceRoots: () => [root],
    onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
    log: collectingLogger([]),
  })
  const hooks =
    mode === undefined
      ? undefined
      : createTabHooks({
          isWorkspaceTrusted: () => true,
          isHooksEnabled: () => true,
          configurationVersion: () => 'epoch-1',
          run: fixtureHookRun(mode),
          log: () => undefined,
        })
  return {
    dispose: () => {
      ignore.dispose()
      hooks?.dispose()
    },
    checks: {
      filesExclude: {},
      ignore,
      rootAbs: root,
      hasSibling: (sibling) => existsSync(path.join(root, ...sibling.split('/'))),
      ...(hooks !== undefined && {
        hooks: {
          beforeRead: hooks.beforeRead,
          afterEdit: () => undefined,
          bindPolicy: hooks.bindPolicy,
          policyKey: hooks.policyKey,
        },
        hookContext: { workspaceRoots: [root], model: 'muse-spark-1.3', generationId: 'g1' },
      }),
    },
  }
}

describe('isTabPathEligible and isTabFileEligible over real git and hooks', () => {
  it('reads an ordinary file and refuses an ignored one', async () => {
    await usingTempDir('muse-tab-eligible-', async (root) => {
      writeFileSync(path.join(root, '.gitignore'), '*.log\n', 'utf8')
      writeFileSync(path.join(root, 'notes.txt'), 'kept', 'utf8')
      const { checks, dispose } = await checksFor(root)
      try {
        await expect(isTabPathEligible('notes.txt', checks)).resolves.toBe(true)
        await expect(isTabPathEligible('debug.log', checks)).resolves.toBe(false)
      } finally {
        dispose()
      }
    })
  })

  it('refuses a cursor-ignored file git itself allows', async () => {
    await usingTempDir('muse-tab-eligible-', async (root) => {
      writeFileSync(path.join(root, '.cursorignore'), 'secret-notes.txt\n', 'utf8')
      writeFileSync(path.join(root, 'secret-notes.txt'), 'cursor says no', 'utf8')
      const { checks, dispose } = await checksFor(root)
      try {
        await expect(isTabPathEligible('secret-notes.txt', checks)).resolves.toBe(false)
      } finally {
        dispose()
      }
    })
  })

  it('refuses private, excluded and oversize files before any hook runs', async () => {
    await usingTempDir('muse-tab-eligible-', async (root) => {
      const { checks, dispose } = await checksFor(root, 'allow')
      try {
        const excluded: TabFileCheckDeps = { ...checks, filesExclude: { '*.log': true } }
        await expect(isTabPathEligible('keys/deploy.pem', checks)).resolves.toBe(false)
        await expect(isTabPathEligible('debug.log', excluded)).resolves.toBe(false)
        const candidate = {
          absolutePath: path.join(root, 'notes.txt'),
          relativePath: 'notes.txt',
          sizeBytes: TAB_FILE_MAX_BYTES + 1,
          content: 'x',
        }
        await expect(isTabFileEligible(candidate, checks)).resolves.toBe(false)
      } finally {
        dispose()
      }
    })
  })

  it('asks the hook for the full text, and refuses without it', async () => {
    await usingTempDir('muse-tab-eligible-', async (root) => {
      writeFileSync(path.join(root, 'notes.txt'), 'kept', 'utf8')
      const allowed = await checksFor(root, 'allow')
      try {
        const candidate = {
          absolutePath: path.join(root, 'notes.txt'),
          relativePath: 'notes.txt',
          sizeBytes: 4,
          content: 'kept',
        }
        await expect(isTabFileEligible(candidate, allowed.checks)).resolves.toBe(true)
        await expect(
          isTabFileEligible({ ...candidate, content: undefined }, allowed.checks),
        ).resolves.toBe(false)
      } finally {
        allowed.dispose()
      }
      const denied = await checksFor(root, 'deny')
      try {
        const candidate = {
          absolutePath: path.join(root, 'notes.txt'),
          relativePath: 'notes.txt',
          sizeBytes: 4,
          content: 'kept',
        }
        await expect(isTabFileEligible(candidate, denied.checks)).resolves.toBe(false)
      } finally {
        denied.dispose()
      }
    })
  })
})
