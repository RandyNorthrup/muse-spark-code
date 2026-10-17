// HOTFIX0181: the cross-bundle member check, on real esbuild output.
//
// 0.18.0's defect in miniature: a build plugin points a reader's import of a
// shared module at the bundle that carries it, and that bundle's entry does
// not export every name the reader imports. TypeScript and the source tests
// see nothing; the built reader calls `undefined`.
//
// The cases below the first five are the review of pull request 150: a name
// is followed by its binding through the lexical scopes, a module is followed
// through every place the build keeps it, and what cannot be followed fails.
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  COMPUTED_LOADS,
  CROSS_BUNDLE_TARGETS,
  crossBundleFailures,
  siblingExportProblems,
} from '../../scripts/lib/bundleExports.mjs'

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

// Built text written by hand, in the shapes the minifier leaves: one letter
// stands for the sibling's module and is used again for a local. The hub
// exports `kept` and `sent`; `gone` is the member it lacks.
const HUB = 'var k=1;0&&(module.exports={kept,sent});'
const shaped = (reader, hub = HUB) =>
  siblingExportProblems(
    new Map([
      ['hub.js', hub],
      ['reader.js', reader],
    ]),
  )
const lost = (form, text) => `reader.js loads hub.js and ${form}: ${text}`

describe('cross-bundle members of built bundles', () => {
  it('names every imported member the sibling bundle does not export', async () => {
    const report = await check(PARTIAL_HUB, STATIC_READER)
    expect(report.problems).toEqual([missing('sent'), missing('stale')])
    expect(report.verified.get('hub.js')).toBe(3)
    expect(report.unverified).toEqual([])
    expect(report.unfollowed).toEqual([])
  })

  it('passes once the entry exports them', async () => {
    const report = await check(FULL_HUB, STATIC_READER)
    expect(report.problems).toEqual([])
    expect(report.verified.get('hub.js')).toBe(3)
    expect(crossBundleFailures(report, ['hub.js'])).toEqual([])
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
    expect(report.unfollowed).toEqual([])
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
    const report = shaped('var a=require("./hub.js");a.sent();', 'module.exports=load();')
    expect(report.problems).toEqual([])
    expect(report.verified.size).toBe(0)
    expect(report.unverified).toEqual(['hub.js'])
    expect(crossBundleFailures(report, [])).toEqual([
      'hub.js: its export list is not in its text, so nothing read from it was checked',
    ])
  })
})

describe('a local that reuses the module name hides it only in its own scope', () => {
  // Each reader reads the sibling before the inner scope and after it. The
  // read after it is the one a function-wide view of the local lost.
  it.each([
    [
      'a catch parameter',
      'var e=require("./hub.js");function run(){e.kept();try{x()}catch(e){e.message}return e.gone()}',
    ],
    [
      'a for (let …) binding',
      'var e=require("./hub.js");function run(n){e.kept();for(let e=0;e<n.length;e++)n[e].label,e.toFixed();return e.gone()}',
    ],
    [
      'a for (const … of …) binding',
      'var e=require("./hub.js");function run(n){e.kept();for(const e of n)e.label;return e.gone()}',
    ],
    [
      'a block const',
      'var e=require("./hub.js");function run(n){e.kept();{const e=n[0];e.label}return e.gone()}',
    ],
    [
      'a block class',
      'var e=require("./hub.js");function run(n){e.kept();if(n){class e{static label=1}e.label}return e.gone()}',
    ],
    [
      'a switch case const',
      'var e=require("./hub.js");function run(n){e.kept();switch(n){case 1:const e=n;e.label}return e.gone()}',
    ],
    [
      'a class static block var',
      'var e=require("./hub.js");class C{static{var e=x();e.label}static m(){e.kept();return e.gone()}}',
    ],
  ])('%s', (_, reader) => {
    const report = shaped(reader)
    // `gone` after the scope is read from the sibling; the local's members are not.
    expect(report.problems).toEqual([missing('gone')])
    expect(report.verified.get('hub.js')).toBe(2)
    expect(report.unfollowed).toEqual([])
  })

  it('a function still hides it for its whole body, and only for that', () => {
    const report = shaped(
      'var e=require("./hub.js");function a(){var e=x();return e.label}function b(e){return e.label}var c=e=>e.label;function d(){return e.gone()}',
    )
    expect(report.problems).toEqual([missing('gone')])
    expect(report.verified.get('hub.js')).toBe(1)
  })

  it('a module kept in a block is read there and nowhere else', () => {
    const report = shaped(
      'async function run(o){{let e=await import("./hub.js");e.gone()}let e=o;e.label;for(let e of o)e.label}',
    )
    expect(report.problems).toEqual([missing('gone')])
    expect(report.verified.get('hub.js')).toBe(1)
  })

  it('a module kept in a catch-free try block is the same binding after it', () => {
    const report = shaped(
      'async function run(){let e;try{e=await import("./hub.js")}catch{return}return e.gone()}',
    )
    expect(report.problems).toEqual([missing('gone')])
    expect(report.unfollowed).toEqual([])
  })
})

describe('a module is followed through every place the build keeps it', () => {
  it.each([
    [
      'a promise cached in a variable by ??=, behind a function that returns it',
      'let _,y=()=>_??=import("./hub.js"),T=async()=>{let J=await y();return J.gone()};',
    ],
    [
      'a promise cached in a property of this',
      'class C{async load(){let a;try{this.held??=import("./hub.js"),a=await this.held}catch{return this.held=void 0}return a.gone()}}',
    ],
    [
      'a method that returns the module',
      'class C{async rt(){return await import("./hub.js")}async use(){return(await this.rt()).gone()}}',
    ],
    [
      'a method that returns it, called on another object',
      'class C{async rt(){return await import("./hub.js")}}async function use(c){let r=await c.rt();return r.gone()}',
    ],
    [
      'a function declaration that returns it',
      'function load(){return require("./hub.js")}function use(){return load().gone()}',
    ],
    [
      'one branch of a conditional',
      'async function f(h){let g=h===void 0?void 0:await import("./hub.js");return g?.gone()}',
    ],
    [
      'an assignment whose value is destructured, and the property that keeps it',
      'class C{async f(){let{kept:u}=this.m??=await import("./hub.js");return u()}g(){return this.m.gone()}}',
    ],
    ['an assignment that is itself assigned', 'var a,b;a=b=require("./hub.js");a.kept();b.gone();'],
    ['||= and a string key', 'var a;a||=require("./hub.js");a["gone"]();'],
    ['a destructuring assignment', 'var kept,g,a=require("./hub.js");({kept,gone:g}=a);'],
    [
      'a promise with a catch before the await',
      'async function f(){let m=await import("./hub.js").catch(()=>{});return m?.gone()}',
    ],
    [
      "esbuild's interop helper around the require",
      'var P=(e,t,o)=>(o=e!=null?C(G(e)):{},X(t||!e||!e.__esModule?D(o,"default",{value:e,enumerable:!0}):o,e)),a=P(require("./hub.js"));a.gone();',
    ],
    [
      'a lowered dynamic import',
      'async function f(){let m=await Promise.resolve().then(()=>require("./hub.js"));return m.gone()}',
    ],
  ])('%s', (_, reader) => {
    const report = shaped(reader)
    expect(report.problems).toEqual([missing('gone')])
    expect(report.unfollowed).toEqual([])
    expect(report.verified.get('hub.js')).toBeGreaterThan(0)
  })

  it('follows a cached dynamic import in real esbuild output', async () => {
    const report = await check(
      PARTIAL_HUB,
      `
      let cached
      const load = () => (cached ??= import('./shared'))
      export async function run() { const shared = await load(); return shared.absent() }
      export class Holder {
        async use() { this.held ??= import('./shared'); return (await this.held).sent() }
      }
    `,
    )
    expect(report.problems).toEqual([missing('absent'), missing('sent')])
    expect(report.unfollowed).toEqual([])
  })
})

describe('a use that cannot be followed is reported, never passed over', () => {
  it.each([
    [
      'the module passed whole',
      'var a=require("./hub.js");use(a);',
      [lost('passes it whole to other code', 'use(a)')],
    ],
    [
      'the module kept in an object',
      'var a=require("./hub.js"),b={hub:a};',
      [lost('keeps it where the check cannot follow', 'hub:a')],
    ],
    [
      'a wrapper that is not the interop helper',
      'function use(m){return m}var a=use(require("./hub.js"));a.gone();',
      [lost('passes it whole to other code', 'use(require("./hub.js"))')],
    ],
    [
      'a function that returns it, handed on without a call',
      'let y=()=>import("./hub.js");register(y);',
      [lost('hands on y, which returns it, without calling it', 'register(y)')],
    ],
    [
      'a method that returns it, handed on without a call',
      'class C{rt(){return import("./hub.js")}m(){return on(this.rt)}}',
      [lost('hands on rt, which returns it, without calling it', 'on(this.rt)')],
    ],
    [
      'a function nobody names',
      'register(()=>import("./hub.js"));',
      [lost('returns it from a function the check cannot name', '()=>import("./hub.js")')],
    ],
    [
      'a computed member',
      'var a=require("./hub.js");a[k]();',
      [lost('reads a member the check cannot name', 'a[k]')],
    ],
    [
      'the promise read as if it were the module',
      'var p=import("./hub.js");p.gone();',
      [lost('reads gone of the promise of it', 'p.gone')],
    ],
    [
      'a then callback given by name',
      'import("./hub.js").then(handle);',
      [lost('passes it to a callback the check cannot read', 'import("./hub.js").then(handle)')],
    ],
    [
      'an array that keeps it',
      'var a=[require("./hub.js")];',
      [lost('keeps it where the check cannot follow', '[require("./hub.js")]')],
    ],
    [
      'a static import, which no Node bundle has',
      'import{kept}from"./hub.js";kept();',
      [
        lost(
          'takes it by a static import or re-export, which the check does not read',
          'import{kept}from"./hub.js";',
        ),
      ],
    ],
    [
      'a static re-export',
      'export*from"./hub.js";',
      [
        lost(
          'takes it by a static import or re-export, which the check does not read',
          'export*from"./hub.js";',
        ),
      ],
    ],
  ])('%s', (_, reader, unfollowed) => {
    const report = shaped(reader)
    expect(report.unfollowed).toEqual(unfollowed)
    expect(report.problems).toEqual([])
    // Nothing was compared, so the sibling is not verified and the gate fails.
    expect(report.verified.has('hub.js')).toBe(false)
    expect(crossBundleFailures(report, [])).toEqual(
      unfollowed.map((sentence) => `${sentence} (not followed, so not checked)`),
    )
  })

  it('keeps what it could read beside what it could not', () => {
    const report = shaped('const{kept,gone,...rest}=require("./hub.js");')
    expect(report.problems).toEqual([missing('gone')])
    expect(report.verified.get('hub.js')).toBe(2)
    expect(report.unfollowed).toEqual([
      lost(
        'destructures a member the check cannot name',
        '{kept,gone,...rest}=require("./hub.js")',
      ),
    ])
  })

  it('shortens a long use to where it starts', () => {
    const [sentence] = shaped(
      `var a=require("./hub.js");use(a,${'"padding",'.repeat(20)}1);`,
    ).unfollowed
    expect(sentence).toMatch(/^reader\.js loads hub\.js and passes it whole to other code: use\(a,/)
    expect(sentence.endsWith('…')).toBe(true)
    expect(sentence.length).toBeLessThan(160)
  })

  it('leaves a sibling outside the set to the package lists', () => {
    const report = siblingExportProblems(
      new Map([['reader.js', 'var a=require("./elsewhere.js");use(a);a.gone();']]),
    )
    expect(report).toEqual({
      problems: [],
      verified: new Map(),
      unverified: [],
      unfollowed: [],
      computed: [],
    })
  })
})

describe('a load whose file is worked out at run time', () => {
  // The shape of the one such load in the product: the provider catalog.
  const CALL = String.raw`import(u(t.catalogFile.replace(/\.json$/,".js")).href)`
  const reader = `async function f(t){let p=await ${CALL};return s.parse(p).default}`
  const listed = [
    { reader: 'reader.js', fragment: String.raw`catalogFile.replace(/\.json$/,".js")` },
  ]

  it('is listed with its reader and its text, and nothing is compared for it', () => {
    const report = shaped(reader)
    expect(report.computed).toEqual([{ reader: 'reader.js', text: CALL }])
    expect(report.problems).toEqual([])
    expect(report.unfollowed).toEqual([])
    expect(report.verified.size).toBe(0)
  })

  it('fails unless the gate was told about it', () => {
    const report = shaped(reader)
    expect(crossBundleFailures(report, [])).toEqual([
      `reader.js loads a file whose name is worked out at run time, ${CALL}: the check cannot tell which bundle that is, so nothing read from it is checked`,
    ])
    expect(crossBundleFailures(report, [], listed)).toEqual([])
    // The entry is for one reader and one call.
    expect(crossBundleFailures(report, [], [{ ...listed[0], reader: 'other.js' }])).toHaveLength(2)
    expect(
      crossBundleFailures(report, [], [{ ...listed[0], fragment: 'somethingElse(' }]),
    ).toHaveLength(2)
  })

  it('fails an entry whose load is no longer in the build', () => {
    expect(crossBundleFailures(shaped('var a=1;'), [], listed)).toEqual([
      String.raw`reader.js: the computed load listed as expected (catalogFile.replace(/\.json$/,".js")) is not in the build`,
    ])
  })

  it('takes a require by a built-up name the same way, and a template without holes as a name', () => {
    const report = shaped(
      'var n="x",a=require("./"+n+".js"),b=require(`./hub.js`);a.kept();b.gone();',
    )
    expect(report.computed).toEqual([{ reader: 'reader.js', text: 'require("./"+n+".js")' }])
    expect(report.problems).toEqual([missing('gone')])
  })

  it('accepts exactly the one the product has', () => {
    expect(COMPUTED_LOADS).toEqual([
      {
        reader: 'configuredProviders.js',
        fragment: String.raw`catalogFile.replace(/\.json$/,".js")`,
      },
    ])
    expect(CROSS_BUNDLE_TARGETS).toEqual(['modelApi.js', 'modelApiBoundaries.js'])
  })
})

describe('a bundle counts as checked by the members compared with it', () => {
  it('fails a target that is loaded and never read', () => {
    const report = shaped('require("./hub.js");')
    expect(report.problems).toEqual([])
    expect(report.unfollowed).toEqual([])
    // Loaded, with zero members compared: absent from `verified`, not present with 0.
    expect(report.verified.has('hub.js')).toBe(false)
    expect(crossBundleFailures(report, ['hub.js'])).toEqual([
      'hub.js: no member read from it was compared with its export list (nothing reads a member of it in a form the check follows)',
    ])
    expect(crossBundleFailures(report, [])).toEqual([])
  })

  it('fails a target whose only use could not be followed, naming the form', () => {
    const report = shaped('var a=require("./hub.js");use(a);')
    expect(crossBundleFailures(report, ['hub.js'])).toEqual([
      'reader.js loads hub.js and passes it whole to other code: use(a) (not followed, so not checked)',
      'hub.js: no member read from it was compared with its export list (nothing reads a member of it in a form the check follows)',
    ])
  })

  it('fails a target nothing loads', () => {
    const report = shaped('var a=1;')
    expect(crossBundleFailures(report, ['hub.js'])).toHaveLength(1)
  })

  it('never records a sibling with a count of zero', () => {
    const report = siblingExportProblems(
      new Map([
        ['hub.js', HUB],
        ['other.js', HUB],
        ['reader.js', 'require("./hub.js");var b=require("./other.js");b.kept();'],
      ]),
    )
    expect([...report.verified]).toEqual([['other.js', 1]])
    expect(crossBundleFailures(report, ['other.js'])).toEqual([])
  })

  it('reads the export list of a file that assigns exports.NAME, and no further', () => {
    const table =
      'exports.EN=JSON.parse("{}");for(const key of ["a"])Object.defineProperty(exports.EN,key,{get(){return require("./more.js").EN[key]}});'
    const reader = 'var t=require("./hub.js");t.EN.a;t.DE;'
    const report = siblingExportProblems(
      new Map([
        ['hub.js', table],
        ['more.js', 'exports.EN={};'],
        ['reader.js', reader],
      ]),
    )
    expect(report.problems).toEqual([missing('DE')])
    expect(report.unverified).toEqual([])
    expect(report.verified).toEqual(
      new Map([
        ['more.js', 1],
        ['hub.js', 2],
      ]),
    )
    // Anything else done with `exports` leaves the list unknown.
    for (const hub of [
      'exports.EN={};module.exports.DE={};',
      'exports.EN={};fill(exports);',
      'exports.EN={};exports[name]={};',
      'var k=1;',
    ])
      expect(shaped(reader, hub).unverified, hub).toEqual(['hub.js'])
  })
})
