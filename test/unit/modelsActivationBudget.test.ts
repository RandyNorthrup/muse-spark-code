// Comparable production builds, including the same English/deferred externals
// as scripts/build.mjs. The immutable pre-K tree is the review's ad916bbc.
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { build, type Plugin } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'

const baselineSources = new Map<string, string>()
beforeAll(() => {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'ad916bbc', 'src'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.ts'))
  const content = execFileSync('git', ['cat-file', '--batch'], {
    input: files.map((file) => `ad916bbc:${file}\n`).join(''),
    maxBuffer: 32 * 1024 * 1024,
  })
  let offset = 0
  for (const file of files) {
    const end = content.indexOf('\n', offset)
    const length = Number(content.subarray(offset, end).toString().split(' ', 3)[2])
    if (end === -1 || !Number.isFinite(length)) {
      throw new Error('Invalid baseline Git frame')
    }
    offset = end + 1
    baselineSources.set(file, content.subarray(offset, offset + length).toString())
    offset += length + 1
  }
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
async function bytes(base?: string): Promise<number> {
  const plugins = [externals()]
  if (base !== undefined) {
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
    const baseline = await bytes('ad916bbc')
    const current = await bytes()
    process.stdout.write(
      `Activation baseline=${String(baseline)} current=${String(current)} growth=${String(current - baseline)}\n`,
    )
    expect(current - baseline).toBeLessThanOrEqual(3 * 1024)
  })
})
