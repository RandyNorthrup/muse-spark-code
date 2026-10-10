import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import * as inventories from '../../scripts/lib/deferredBundles.mjs'

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
