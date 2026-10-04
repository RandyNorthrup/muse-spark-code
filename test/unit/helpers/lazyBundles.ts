// A lazily loaded bundle of our own (PLAN.md D6), as scripts/build.mjs makes
// it and as `lazyBundleLoader` requires it: the entry built with esbuild into
// a folder the test owns, beside the shared English fallback it loads, and
// the cases every such loader meets. Loaded once, on the first call, and
// kept; a missing file or another module at the path refused with the
// feature's own reason and the cause logged, never a silent no-op; tried
// again on the next call, so a file repaired in place is read.

import { copyFileSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { requireFile } from '../../../src/host/lazyBundle'
import type { Logger } from '../../../src/host/logger'
import { FakeLogOutputChannel } from './fakes'
import { logLines } from './logText'
import { sharedUiText } from './modelApiBundle'
import { removeFolder } from './temporaryFolders'

export interface BuiltBundle {
  /** The folder the test owns, filled before the file's first test runs. */
  readonly folder: string
  /** The bundle in it. */
  readonly file: string
}

/** Builds `entry` into `<a new folder>/<file>`, with dist/uiText.js beside it. */
async function buildLazyBundle(entry: string, file: string): Promise<BuiltBundle> {
  // Node keys its module cache by real path (macOS's /var is a link).
  const folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-lazy-bundle-')))
  const shared = { bundle: true, platform: 'node', format: 'cjs', target: 'node20.18' } as const
  await build({
    ...shared,
    entryPoints: [path.resolve('src/shared/l10n/en.ts')],
    outfile: path.join(folder, 'uiText.js'),
    logLevel: 'silent',
  })
  await build({
    ...shared,
    entryPoints: [path.resolve(entry)],
    outfile: path.join(folder, file),
    plugins: [sharedUiText],
    logLevel: 'silent',
  })
  return { folder, file: path.join(folder, file) }
}

/** The bundle, built before the file's tests and removed after them. */
export function builtForTests(entry: string, file: string): BuiltBundle {
  const built = { folder: '', file: '' }
  beforeAll(async () => {
    Object.assign(built, await buildLazyBundle(entry, file))
  })
  afterAll(() => removeFolder(built.folder))
  return built
}

type LoaderFactory<T> = (deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}) => () => T

/** The loader cases, over the shipped bundle. */
export function lazyLoaderCases<T>(
  loader: LoaderFactory<T>,
  built: BuiltBundle,
  reason: () => string,
): void {
  it('requires the shipped bundle on the first call only, and keeps it', () => {
    const load = vi.fn(requireFile)
    const bundle = loader({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
      loadBundle: load,
    })
    expect(load).not.toHaveBeenCalled()
    const first = bundle()
    expect(bundle()).toBe(first)
    expect(load).toHaveBeenCalledExactlyOnceWith(built.file)
  })

  it('refuses a missing file with the reason, logs the cause, and tries again on the next call', () => {
    const log = new FakeLogOutputChannel()
    const missing = path.join(built.folder, 'missing.js')
    const bundle = loader({ bundlePath: missing, log })
    expect(() => bundle()).toThrow(reason())
    expect(() => bundle()).toThrow(reason())
    expect(logLines(log).filter((line) => line.includes(missing))).toHaveLength(2)
  })

  it('refuses another module at the path, then reads the file again once it is repaired', () => {
    const log = new FakeLogOutputChannel()
    const wrong = path.join(built.folder, 'wrong.js')
    writeFileSync(wrong, 'module.exports = { somethingElse: true }')
    const bundle = loader({ bundlePath: wrong, log })
    expect(() => bundle()).toThrow(reason())
    expect(logLines(log).some((line) => line.includes('does not export'))).toBe(true)
    copyFileSync(built.file, wrong)
    expect(() => bundle()).not.toThrow()
  })
}
