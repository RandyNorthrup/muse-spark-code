// HOTFIX0181: the cross-bundle member check, on real esbuild output.
//
// 0.18.0's defect in miniature: a build plugin points a reader's import of a
// shared module at the bundle that carries it, and that bundle's entry does
// not export every name the reader imports. TypeScript and the source tests
// see nothing; the built reader calls `undefined`.
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { siblingExportProblems } from '../../scripts/lib/bundleExports.mjs'

const SHARED = `
  export function sent() { return 'sent' }
  export function stale(error) { return error instanceof Error }
  export function kept() { return 'kept' }
`

/** Sources by path; every bundle but `hub.js` reads `./shared` from `hub.js`. */
function sources(files) {
  return {
    name: 'fixture-sources',
    setup(bundler) {
      bundler.onResolve({ filter: /^\.\// }, (args) =>
        args.path === './shared' && !bundler.initialOptions.outfile.endsWith('hub.js')
          ? { path: './hub.js', external: true }
          : { path: args.path, namespace: 'fixture' },
      )
      bundler.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
        contents: files[args.path],
        loader: 'js',
      }))
    },
  }
}

async function bundle(name, entry, files) {
  const built = await build({
    entryPoints: [entry],
    outfile: `dist/${name}`,
    bundle: true,
    minify: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    logLevel: 'silent',
    plugins: [sources(files)],
  })
  const [output] = built.outputFiles
  return [name, output.text]
}

async function check(hubEntry, reader) {
  const files = { './shared': SHARED, './hubEntry': hubEntry, './reader': reader }
  return siblingExportProblems(
    new Map([
      await bundle('hub.js', './hubEntry', files),
      await bundle('reader.js', './reader', files),
    ]),
  )
}

const PARTIAL_HUB = `export { kept } from './shared'; export function make() { return 'hub' }`
const FULL_HUB = `export { kept, sent, stale } from './shared'; export function make() { return 'hub' }`
const STATIC_READER = `
  import { kept, sent, stale } from './shared'
  export function run() {
    try { return sent() } catch (error) { if (stale(error)) throw error }
    return kept()
  }
`
const missing = (member) => `reader.js reads ${member} from hub.js, which does not export it`

describe('cross-bundle members of built bundles', () => {
  it('names every imported member the sibling bundle does not export', async () => {
    const report = await check(PARTIAL_HUB, STATIC_READER)
    expect(report.problems).toEqual([missing('sent'), missing('stale')])
    expect(report.verified.get('hub.js')).toBe(3)
    expect(report.unverified).toEqual([])
  })

  it('passes once the entry exports them', async () => {
    const report = await check(FULL_HUB, STATIC_READER)
    expect(report.problems).toEqual([])
    expect(report.verified.get('hub.js')).toBe(3)
  })

  it('follows a dynamic import that is destructured, kept, read at once or read in then', async () => {
    const report = await check(
      PARTIAL_HUB,
      `
      export async function destructured() { const { sent } = await import('./shared'); return sent() }
      export async function held() { const shared = await import('./shared'); return shared.stale(new Error('x')) }
      export async function direct() { return (await import('./shared')).kept() }
      export function chained() { return import('./shared').then((shared) => shared.absent()) }
    `,
    )
    expect(report.problems).toEqual([missing('absent'), missing('sent'), missing('stale')])
    expect(report.verified.get('hub.js')).toBe(4)
  })

  it('does not take a local of the same name for the sibling', async () => {
    const report = await check(
      FULL_HUB,
      `
      import { kept } from './shared'
      export function run(items) { return items.map((item) => item.label).concat(kept()) }
    `,
    )
    expect(report.problems).toEqual([])
    expect(report.verified.get('hub.js')).toBe(1)
  })

  it('reports a sibling whose export list is not in its text instead of passing it', () => {
    const report = siblingExportProblems(
      new Map([
        ['hub.js', 'module.exports=load();'],
        ['reader.js', 'var a=require("./hub.js");a.sent();'],
      ]),
    )
    expect(report.problems).toEqual([])
    expect(report.verified.size).toBe(0)
    expect(report.unverified).toEqual(['hub.js'])
  })
})
