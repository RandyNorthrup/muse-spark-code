import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import * as inventories from '../../scripts/lib/deferredBundles.mjs'
import {
  AutoCompactionNotAuthorizedError,
  isAutoCompactionNotAuthorizedError,
} from '../../src/core/paid/paidConsent'

it('recognizes compaction authorization refusal across independently loaded bundles', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm101-refusal-bundle-'))
  try {
    const file = path.join(directory, 'consent.cjs')
    await build({
      entryPoints: ['src/core/paid/paidConsent.ts'],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    const bundled = createRequire(import.meta.url)(file)
    const error = new bundled.AutoCompactionNotAuthorizedError()
    expect(error).not.toBeInstanceOf(AutoCompactionNotAuthorizedError)
    expect(isAutoCompactionNotAuthorizedError(error)).toBe(true)
    expect(isAutoCompactionNotAuthorizedError(new Error('ledger unavailable'))).toBe(false)
    expect(isAutoCompactionNotAuthorizedError({ name: error.name })).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('classifies compaction admission in the actual mandatory bundle-split inventory', () => {
  const source = readFileSync('scripts/check-bundle-split.mjs', 'utf8')
  // Run the checker's real inventory pass without requiring unrelated build artifacts.
  const start = source.indexOf('const MODEL_API_DIR =')
  const end = source.indexOf('const activation = inputsOf(BUNDLES.activation)')
  const problems = runInNewContext(`${source.slice(start, end)}\nproblems`, {
    ...inventories,
    readdirSync,
    path,
  })
  expect(problems.filter((problem) => problem.includes('autoCompactionAdmission.ts'))).toEqual([])
})
