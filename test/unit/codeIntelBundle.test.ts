// The `ide` server's code intelligence answers as a bundle of their own (M67,
// PLAN.md D6 2026-10-03): src/host/ide/codeIntelEntry.ts built with esbuild
// into a temporary folder as scripts/build.mjs builds dist/codeIntel.js (the
// shared English fallback beside it), then required by `codeIntelLoader`
// with Node's own `require`, as the `ide` server does on its first call. A
// bundle that cannot load is refused with the reason until one loads.

import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CodeIntelDeps } from '../../src/core/codeIntel/codeIntelQuery'
import { requireFile } from '../../src/host/lazyBundle'
import {
  codeIntelLoader,
  type CodeIntelAnswers,
  isCodeIntelBundle,
} from '../../src/host/ide/codeIntelBundle'
import { createCodeIntelAnswers } from '../../src/host/ide/codeIntelEntry'
import {
  CODE_INTEL_BUNDLE_FILE,
  CODE_INTEL_MODEL_TEXT,
  MODEL_TEXT,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { fakeLanguageService, loc } from './helpers/fakeLanguageService'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { sharedUiText } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }
const ROOT = '/ws'
const A = `${ROOT}/a.ts`
const FILES = { 'a.ts': 'export const answer = 42\n', 'b.ts': 'answer\n' }

// Built as scripts/build.mjs builds it, with the shared English fallback.
beforeAll(async () => {
  built.folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-code-intel-bundle-')))
  built.file = path.join(built.folder, CODE_INTEL_BUNDLE_FILE)
  // One build of both: the entry's import of the table resolves to the
  // adjacent ./uiText.js, as the production build's plugin makes it.
  await build({
    entryPoints: {
      [path.parse(CODE_INTEL_BUNDLE_FILE).name]: path.resolve('src/host/ide/codeIntelEntry.ts'),
      uiText: path.resolve('src/shared/l10n/en.ts'),
    },
    outdir: built.folder,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    plugins: [sharedUiText],
    logLevel: 'silent',
  })
})

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

afterAll(() => removeFolder(built.folder))

function intel(): CodeIntelDeps {
  const io = memoryToolIo(FILES, ROOT)
  return {
    service: fakeLanguageService({ files: io.files, definitions: () => [loc(A, 0, 13)] }),
    workspaceRoot: ROOT,
    platform: 'linux',
    io,
    now: () => 0,
  }
}

const answers: CodeIntelAnswers = createCodeIntelAnswers({ uiText: EN, uiLocale: BASE_LOCALE })

describe('isCodeIntelBundle', () => {
  it('accepts a module whose factory is a function, and nothing else', () => {
    expect(isCodeIntelBundle({ createCodeIntelAnswers: () => answers })).toBe(true)
    expect(isCodeIntelBundle({ createCodeIntelAnswers: 1 })).toBe(false)
    expect(isCodeIntelBundle({})).toBe(false)
    expect(isCodeIntelBundle(null)).toBe(false)
    expect(isCodeIntelBundle('createCodeIntelAnswers')).toBe(false)
  })
})

describe('codeIntelLoader', () => {
  it('loads nothing until asked, then loads the bundle once and keeps its answers', () => {
    const loadBundle = vi.fn(() => ({ createCodeIntelAnswers: () => answers }))
    const load = codeIntelLoader({
      bundlePath: '/dist/codeIntel.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(load()).toBe(answers)
    expect(load()).toBe(answers)
    expect(loadBundle).toHaveBeenCalledExactlyOnceWith('/dist/codeIntel.js')
  })

  it('says why a module that cannot be loaded is refused, and tries again on the next call', () => {
    const log = new FakeLogOutputChannel()
    let isBroken = true
    const load = codeIntelLoader({
      bundlePath: '/dist/codeIntel.js',
      log,
      loadBundle: () => {
        if (isBroken) throw new Error('Cannot find module')
        return { createCodeIntelAnswers: () => answers }
      },
    })
    expect(() => load()).toThrow(MODEL_TEXT.codeIntelUnavailable)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'))
    isBroken = false
    expect(load()).toBe(answers)
  })

  it('refuses a module that is not the bundle, and a file that does not exist, with the same reason', () => {
    const log = new FakeLogOutputChannel()
    expect(() =>
      codeIntelLoader({
        bundlePath: '/dist/codeIntel.js',
        log,
        loadBundle: () => ({ somethingElse: true }),
      })(),
    ).toThrow(MODEL_TEXT.codeIntelUnavailable)
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('does not export the code intelligence bundle'),
    )
    expect(() =>
      codeIntelLoader({
        bundlePath: path.join(built.folder, 'missing', CODE_INTEL_BUNDLE_FILE),
        log: new FakeLogOutputChannel(),
      })(),
    ).toThrow(MODEL_TEXT.codeIntelUnavailable)
  })
})

describe('the shipped code intelligence bundle', () => {
  it('loads the shared English fallback and its own model text, never MODEL_TEXT', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('require("./uiText.js")')
    expect(text).not.toContain(UI_TEXT.crashTitle)
    expect(text).toContain(CODE_INTEL_MODEL_TEXT.codeIntelNoSymbolNamed)
    expect(text).not.toContain(MODEL_TEXT.replyContextLead)
  })

  it('is the module the loader accepts, and answers as the source does', async () => {
    const loadBundle = vi.fn(requireFile)
    const load = codeIntelLoader({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    const args = { path: 'b.ts', symbol: 'answer' }
    const shipped = await load().answer('findDefinition', args, intel())
    expect(shipped).toEqual(await answers.answer('findDefinition', args, intel()))
    expect(shipped).toEqual({
      ok: true,
      text: 'Using `answer` at b.ts:1:1.\na.ts:1:14: export const answer = 42',
    })
    expect(loadBundle).toHaveBeenCalledOnce()
  })

  it('reads the table the activation bundle installed, before it reads a string', async () => {
    setUiText({ ...EN, codeIntelNoService: 'localized: no service for {path}' }, 'de')
    const load = codeIntelLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    expect(await load().answer('documentSymbols', { path: 'a.ts' }, intel())).toMatchObject({
      ok: false,
      visibleReason: 'localized: no service for a.ts',
    })
  })
})
