// Lane 0's component contracts (src/shared/desktopContracts.ts, M111 D91)
// for the Node harness: esbuild bundles the one TypeScript module in memory,
// the same way scripts/lib/l10nSource.mjs loads the language tables, so the
// harness reads the real contract values and never a copied list.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import * as esbuild from 'esbuild'

const CONTRACTS_FILE = 'src/shared/desktopContracts.ts'
const ENTRY = "export * from './desktopContracts'"

const cache = new Map()

async function bundleContracts(repoRoot) {
  try {
    const { outputFiles } = await esbuild.build({
      stdin: {
        contents: ENTRY,
        resolveDir: path.join(repoRoot, path.dirname(CONTRACTS_FILE)),
        sourcefile: 'desktop-contracts-entry.ts',
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    })
    const code = Buffer.from(outputFiles[0].contents).toString('base64')
    return await import(`data:text/javascript;base64,${code}`)
  } catch (error) {
    // A failed bundle is retried by the next caller instead of cached.
    cache.delete(repoRoot)
    throw error
  }
}

/** The desktop contracts module, bundled once per repository root. */
export function loadDesktopContracts(repoRoot) {
  let loaded = cache.get(repoRoot)
  if (loaded === undefined) {
    loaded = bundleContracts(repoRoot)
    cache.set(repoRoot, loaded)
  }
  return loaded
}
