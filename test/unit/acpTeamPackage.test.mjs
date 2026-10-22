// Exercise the production parser entry, rather than Vitest's full zod/mini.
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as nodeSplits from '../../scripts/lib/deferredBundles.mjs'
import { deferredTeamView } from '../../scripts/lib/deferredTeamView.mjs'

const require = createRequire(import.meta.url)

describe('M96b production team contracts', () => {
  let folder = ''
  let headless
  beforeAll(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'm96b-parser-'))
    const options = {
      target: 'node22',
      platform: 'node',
      format: 'cjs',
      minify: true,
      bundle: true,
      logLevel: 'silent',
      define: { navigator: 'undefined', 'process.env.NODE_ENV': '"production"' },
      external: ['@napi-rs/keyring'],
    }
    const plugins = [
      nodeSplits.sharedUiText,
      nodeSplits.sharedValidation,
      nodeSplits.deferredCohort,
      nodeSplits.sharedWire,
      nodeSplits.sharedResourceAdmission,
      nodeSplits.sharedStructuredSchema,
      deferredTeamView,
      nodeSplits.sharedModelApiBoundaries,
      nodeSplits.englishZodLocales,
    ]
    await build({
      ...options,
      plugins: [nodeSplits.sharedUiText, nodeSplits.sharedValidation],
      outdir: folder,
      entryPoints: { contracts: 'src/acp/teamContracts.ts' },
    })
    await build({
      ...options,
      outdir: folder,
      entryPoints: { validation: 'src/shared/validationEntry.ts', uiText: 'src/shared/l10n/en.ts' },
    })
    headless = await build({
      ...options,
      plugins,
      write: false,
      metafile: true,
      outfile: 'dist/headless.js',
      entryPoints: ['src/runtime/exec/runExec.ts'],
    })
  })
  afterAll(async () => {
    if (folder !== '') await rm(folder, { recursive: true, force: true })
  })

  it('imports builders using the shipped validation entry and builds ACP content', () => {
    const contracts = require(path.join(folder, 'contracts.js'))
    const diff = contracts.teamDiff({ path: '/repo/a.ts', oldText: null, newText: 'b' })
    const update = contracts.teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: [diff] })
    expect(update.content).toEqual([
      { type: 'content', content: { type: 'text', text: 'done' } },
      diff,
    ])
    expect(() => contracts.teamPlanEntries([null])).toThrow(contracts.TeamContractError)
  })

  it('keeps ACP mapping schemas off headless and stays within its 125 KiB cap', () => {
    // TRAINFIX moved the headless budget 100 KiB -> 125 KiB (train growth and
    // the plan-model preflight); the team entry points add no headless bytes.
    expect(headless.outputFiles[0].contents.byteLength).toBeLessThanOrEqual(125 * 1024)
    const inputs = Object.keys(headless.metafile.inputs).map((file) => file.replaceAll('\\', '/'))
    expect(inputs).not.toContain('src/acp/teamContracts.ts')
    expect(inputs).toContain('src/acp/teamAdmission.ts')
  })
})
