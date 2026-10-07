import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import {
  isRuntimeAccountsBundle,
  runtimeAccountsLoader,
} from '../../src/runtime/providers/accountsBundle'
import { UI_TEXT, RUNTIME_ACCOUNTS_BUNDLE_FILE } from '../../src/shared/constants'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  deferredCohort,
  sharedUiText,
  sharedValidation,
  sharedWire,
} from '../../scripts/lib/deferredBundles.mjs'

const built = builtForTests('src/runtime/providers/accountsEntry.ts', RUNTIME_ACCOUNTS_BUNDLE_FILE)

/** In ACP startup and CLI argument parsing, none of these may appear. */
const LAZY_FILES = [
  'src/runtime/providers/accountsEntry.ts',
  'src/runtime/providers/runtimeServices.ts',
  'src/runtime/providers/providersFileStore.ts',
  'src/runtime/developer/developerCommand.ts',
  'src/runtime/developer/localFiles.ts',
  'src/core/developer/developerOptions.ts',
  'src/core/developer/surfaces.ts',
  'src/core/providers/accounts.ts',
  'src/core/providers/accountPolicy.ts',
  'src/host/providers/accountSecrets.ts',
]

describe('runtime accounts loader', () => {
  lazyLoaderCases(runtimeAccountsLoader, built, () => UI_TEXT.accounts.unavailable)

  it('rejects a module without both factory exports', () => {
    expect(isRuntimeAccountsBundle({ createRuntimeAccountServicesForLocale: vi.fn() })).toBe(false)
    expect(
      isRuntimeAccountsBundle({
        createRuntimeAccountServicesForLocale: vi.fn(),
        runTerminalDeveloperCommand: 1,
      }),
    ).toBe(false)
    expect(isRuntimeAccountsBundle(null)).toBe(false)
  })

  it('installs the caller language before the same-build terminal command runs', async () => {
    const bundle = runtimeAccountsLoader({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
    })()
    const canary = {
      ...UI_TEXT,
      developer: { ...UI_TEXT.developer, invalidRequest: 'PRIVATE-LOCALE-CANARY' },
    }
    const result = await bundle.runTerminalDeveloperCommand(
      canary,
      'de',
      {
        dataDir: mkdtempSync(path.join(tmpdir(), 'muse-accounts-entry-')),
        openEntry: () => {
          throw new Error('the keyring stays closed on an invalid request')
        },
      },
      {
        readLine: () => Promise.resolve(''),
        print: vi.fn(),
      },
      ['other'],
      'terminal',
    )
    expect(result).toEqual({ text: 'PRIVATE-LOCALE-CANARY', exitCode: 1 })
  })
})

describe('M108 runtime accounts split', () => {
  it('keeps account services out of ACP startup and CLI argument parsing', async () => {
    const result = await build({
      entryPoints: ['src/runtime/main.ts'],
      outfile: 'dist/acp.js',
      write: false,
      bundle: true,
      minify: true,
      metafile: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['@napi-rs/keyring'],
      plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
    const inputs = Object.keys(result.metafile.inputs)
    for (const file of LAZY_FILES) {
      expect(inputs).not.toContain(file)
    }
    expect(inputs).toContain('src/runtime/providers/accountsBundle.ts')
  })
})
