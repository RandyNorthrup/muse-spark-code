import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'
import { webviewDeferredBudgetGroups } from '../../scripts/lib/webviewBundles.mjs'

const built = { meta: undefined }
const REVIEW_BASE_DEFERRED_BYTES = 51_157
beforeAll(async () => {
  // Share the production graph build; assertions stay within the default timeout.
  const result = await build({
    entryPoints: ['src/webview/main.tsx'],
    outdir: 'dist/webview',
    bundle: true,
    write: false,
    metafile: true,
    minify: true,
    charset: 'utf8',
    platform: 'browser',
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[hash]',
    target: 'chrome132',
    jsx: 'automatic',
    plugins: [
      compactBrowserEnglish,
      {
        name: 'reference-page',
        setup(builder) {
          builder.onResolve({ filter: /\/components\/ReferencePage$/ }, (args) =>
            args.kind === 'dynamic-import'
              ? { path: './referencePage.js', external: true }
              : undefined,
          )
        },
      },
    ],
  })
  built.meta = result.metafile
})

describe('M113 reporting bundle boundary', () => {
  it('keeps the usage report action out of the capped legacy deferred group', () => {
    const meta = built.meta
    const legacy = webviewDeferredBudgetGroups(meta).find(({ name }) => name === 'deferred JS')
    const bytes = legacy.outputs.reduce((total, file) => total + meta.outputs[file].bytes, 0)
    expect(bytes).toBeLessThanOrEqual(legacy.budgetKiB * 1024)
    expect(bytes).toBeLessThanOrEqual(REVIEW_BASE_DEFERRED_BYTES)
    for (const output of legacy.outputs) {
      expect(
        Object.keys(meta.outputs[output].inputs).some((input) =>
          input.replaceAll('\\', '/').startsWith('src/webview/reporting/'),
        ),
      ).toBe(false)
    }
  })
})
