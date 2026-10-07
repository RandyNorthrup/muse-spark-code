// The legal scanner's lazy bundle (M97, lane B): the structural check, the
// cached load, and the unavailable refusal naming the cause in the log.
// Lane R builds the real dist/legalScan.js; until then a missing file refuses
// with the installed unavailable words.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../src/host/logger'
import { isLegalScanBundle, legalScanLoader } from '../../src/host/ide/legalScanBundle'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { legalScanResultSchema } from '../../src/shared/legal'
import { loadLegalScanner } from '../../src/runtime/legal/legalScanner'
import { sharedUiText } from './helpers/modelApiBundle'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { removeFolder } from './helpers/temporaryFolders'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

function logger() {
  const channel = new FakeLogOutputChannel()
  return { log: createLogger(channel), channel }
}

describe('isLegalScanBundle', () => {
  it('takes the shared scan export without a host mode hold', () => {
    const runLegalScan = vi.fn()
    expect(isLegalScanBundle({ runLegalScan })).toBe(true)
    expect(isLegalScanBundle({})).toBe(false)
    expect(isLegalScanBundle({ runLegalScan: 'scan' })).toBe(false)
    expect(isLegalScanBundle(undefined)).toBe(false)
  })
})

describe('legalScanLoader', () => {
  it('loads once and keeps the bundle', () => {
    const runLegalScan = vi.fn()
    const loadBundle = vi.fn(() => ({ runLegalScan }))
    const { log } = logger()
    const load = legalScanLoader({ bundlePath: '/dist/legalScan.js', log, loadBundle })
    expect(load()).toEqual({ runLegalScan })
    expect(load()).toEqual({ runLegalScan })
    expect(loadBundle).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing bundle with the unavailable words and logs the cause', () => {
    setUiText(EN, BASE_LOCALE)
    const { log, channel } = logger()
    const failure = new Error('ENOENT: no such bundle')
    const load = legalScanLoader({
      bundlePath: '/dist/legalScan.js',
      log,
      loadBundle: () => {
        throw failure
      },
    })
    expect(() => load()).toThrow(UI_TEXT.legalScanUnavailable)
    expect(logLines(channel).join('\n')).toContain('ENOENT')
  })

  it('refuses a module without the scan export', () => {
    const { log } = logger()
    const load = legalScanLoader({
      bundlePath: '/dist/legalScan.js',
      log,
      loadBundle: () => ({ somethingElse: 1 }),
    })
    expect(() => load()).toThrow(UI_TEXT.legalScanUnavailable)
  })
})

describe('the production legal scanner bundle', () => {
  it('builds the real entry with production options and scans through BOTH loaders', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'muse-legal-entry-'))
    try {
      const workspaceRoot = path.join(folder, 'workspace')
      mkdirSync(workspaceRoot)
      writeFileSync(
        path.join(workspaceRoot, 'package.json'),
        JSON.stringify({ name: 'fixture', license: 'MIT', dependencies: { missing: '1.0.0' } }),
      )
      writeFileSync(
        path.join(workspaceRoot, 'package-lock.json'),
        JSON.stringify({
          lockfileVersion: 3,
          packages: { '': { name: 'fixture' }, 'node_modules/missing': { version: '1.0.0' } },
        }),
      )
      writeFileSync(path.join(workspaceRoot, 'requirements.txt'), 'Django==5.0\n')
      await build({
        entryPoints: {
          legalScan: path.resolve('src/core/legal/entry.ts'),
          uiText: path.resolve('src/shared/l10n/en.ts'),
        },
        outdir: folder,
        bundle: true,
        minify: true,
        metafile: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20.18',
        plugins: [sharedUiText],
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        logLevel: 'silent',
      })
      const { log } = logger()
      const host = legalScanLoader({ bundlePath: path.join(folder, 'legalScan.js'), log })()
      const request = { workspaceRoot, input: {}, signal: new AbortController().signal }
      const fromHost = await host.runLegalScan(request)
      const fromRuntime = await loadLegalScanner({ distDir: folder }).scan(request)
      expect(fromRuntime).toEqual(fromHost)
      expect(legalScanResultSchema.parse(fromHost.result)).toEqual(fromHost.result)
      expect(fromHost.registryTargets).toContainEqual({
        ecosystem: 'npm',
        name: 'missing',
        version: '1.0.0',
      })
      expect(fromHost.registryTargets).toContainEqual({
        ecosystem: 'pypi',
        name: 'Django',
        version: '5.0',
      })
      expect('createHold' in host).toBe(false)
    } finally {
      await removeFolder(folder)
    }
  })
  it('emits and packages the scanner in both distributions with a named size cap', () => {
    const buildScript = readFileSync('scripts/build.mjs', 'utf8')
    expect(buildScript).toContain("const LEGAL_SCAN_ENTRY = 'src/core/legal/entry.ts'")
    expect(buildScript).toContain('legalScan: esbuild.build(legalScanOptions)')
    expect(readFileSync('scripts/package-acp.mjs', 'utf8')).toContain("'legalScan.js'")
    expect(readFileSync('.vscodeignore', 'utf8')).toContain('!dist/legalScan.js')
    expect(readFileSync('.github/workflows/build.yml', 'utf8')).toContain(
      'extension/dist/legalScan.js',
    )
    expect(readFileSync('.github/workflows/build.yml', 'utf8')).toContain(
      'package/dist/legalScan.js',
    )
    expect(readFileSync('scripts/check-bundle-size.mjs', 'utf8')).toContain(
      "path: 'dist/legalScan.js'",
    )
    expect(readFileSync('scripts/lib/deferredBundles.mjs', 'utf8')).toContain(
      "output: 'dist/legalScan.js'",
    )
  })
})
