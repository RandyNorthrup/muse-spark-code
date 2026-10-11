// Comparable production builds, including the same English/deferred externals
// as scripts/build.mjs. Checked-in pre-K source bytes preserve the historical
// comparison without requiring the review rig's ad916bbc Git object.
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { build, type Plugin } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { HOST_PLUGINS } from '../../scripts/lib/hostPlugins.mjs'

const baselineSources = new Map<string, string>()
beforeAll(() => {
  const captured = readFileSync(
    'test/fixtures/models-activation-baseline/sources.json',
    'utf8',
  ).replaceAll('\r\n', '\n')
  expect(createHash('sha256').update(captured).digest('hex')).toBe(
    '6d361ac567eb3894eaff407045daef7fcdd23cceb05cb436bd6f7f024172f4f7',
  )
  const sources = z.record(z.string(), z.string()).parse(JSON.parse(captured))
  for (const [file, source] of Object.entries(sources)) baselineSources.set(file, source)
})

function externals(): Plugin {
  return {
    name: 'activation-externals',
    setup(builder) {
      builder.onResolve(
        { filter: /\/(?:en|sessionBoardEntry|reviewerEntry)(?:\.[jt]s)?$/ },
        (args) => {
          const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
          if (source === path.resolve('src/shared/l10n/en.ts')) {
            return { path: './uiText.js', external: true }
          }
          if (args.kind !== 'dynamic-import') {
            return undefined
          }
          if (source === path.resolve('src/host/sessionBoardEntry.ts')) {
            return { path: './sessionBoard.js', external: true }
          }
          return source === path.resolve('src/core/backends/modelapi/reviewerEntry.ts')
            ? { path: './reviewer.js', external: true }
            : undefined
        },
      )
    },
  }
}
async function bytes(isBaseline = false): Promise<number> {
  // The plugins dist/extension.js ships with (scripts/lib/hostPlugins.mjs).
  const plugins = [...HOST_PLUGINS, externals()]
  if (isBaseline) {
    plugins.push({
      name: 'immutable-baseline',
      setup(builder) {
        builder.onResolve({ filter: /^\./ }, (args) => {
          const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
          const key = path.relative(process.cwd(), source).split(path.sep).join('/')
          return baselineSources.has(key) ? { path: source } : undefined
        })
        builder.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, (args) => {
          const contents = baselineSources.get(
            path.relative(process.cwd(), args.path).split(path.sep).join('/'),
          )
          if (contents === undefined) {
            throw new Error('Missing immutable baseline source')
          }
          return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
        })
      },
    })
  }
  const result = await build({
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    minify: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    external: ['vscode'],
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins,
  })
  const output = result.outputFiles[0]
  if (output === undefined) {
    throw new Error('No activation bundle')
  }
  return output.contents.byteLength
}
describe('lane K activation budget', () => {
  it('adds at most 3 KiB to the immutable pre-K production bundle', async () => {
    const baseline = await bytes(true)
    const current = await bytes()
    process.stdout.write(
      `Activation baseline=${String(baseline)} current=${String(current)} growth=${String(current - baseline)}\n`,
    )
    expect(current - baseline).toBeLessThanOrEqual(3 * 1024)
  })
})
