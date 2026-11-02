// Verify the real production artifacts and exercise every new delivery guard.
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, inject, it } from 'vitest'
import * as z from 'zod/mini'
import { assertCurrentProductionBuild } from './productionBuild'

const judgeFiles = new Set([
  'src/runtime/judge/judgeEntry.ts',
  'src/core/judge/calibration/apply.ts',
  'src/core/judge/calibration/fit.ts',
  'src/core/judge/calibration/report.ts',
  'src/core/judge/calibration/schema.ts',
  'src/core/judge/sampling.ts',
  'src/core/judge/contrastive.ts',
  'src/runtime/judge/commands.ts',
  'src/runtime/judge/mcp.ts',
])
const children = [
  {
    name: 'judgeSources',
    sources: [
      'src/runtime/judge/judgeSourcesEntry.ts',
      'src/core/judge/routing.ts',
      'src/core/judge/providers/run.ts',
      'src/core/judge/providers/decide.ts',
      'src/core/judge/providers/decode.ts',
      'src/core/judge/systemone/source.ts',
      'src/core/judge/systemone/wire.ts',
      'src/core/judge/systemone/policy.ts',
    ],
  },
  {
    name: 'judgeLocal',
    sources: [
      'src/runtime/judge/judgeLocalEntry.ts',
      'src/runtime/judge/localHelper.ts',
      'src/host/judge/local.ts',
      'src/core/judge/local/darwinPeer.ts',
      'src/core/judge/local/executable.ts',
      'src/core/judge/local/linuxPeer.ts',
      'src/core/judge/local/linuxVolume.ts',
      'src/core/judge/local/model.ts',
      'src/core/judge/local/posixPeer.ts',
      'src/core/judge/local/recommendations.ts',
      'src/core/judge/local/snapshot.ts',
      'src/core/judge/local/source.ts',
      'src/core/judge/local/transport.ts',
      'src/core/judge/local/windowsPeer.ts',
      'src/core/judge/local/wire.ts',
    ],
  },
  {
    name: 'judgeUses',
    sources: [
      'src/runtime/judge/judgeUsesEntry.ts',
      'src/host/judge/uses.ts',
      'src/core/judge/uses/advice.ts',
      'src/core/judge/uses/definitions.ts',
      'src/core/judge/uses/fences.ts',
    ],
  },
  {
    name: 'judgeLint',
    sources: [
      'src/runtime/judge/judgeLintEntry.ts',
      'src/runtime/judge/lint.ts',
      'src/host/judge/lint.ts',
      'src/core/judge/lint/cache.ts',
      'src/core/judge/lint/config.ts',
      'src/core/judge/lint/context.ts',
      'src/core/judge/lint/evals.ts',
      'src/core/judge/lint/evaluate.ts',
      'src/core/judge/lint/formats.ts',
      'src/core/judge/lint/report.ts',
      'src/core/judge/lint/rules.ts',
      'src/core/judge/lint/syntax.ts',
      'src/core/judge/lint/units.ts',
    ],
  },
  {
    name: 'judgeHook',
    sources: ['src/runtime/judge/judgeHookEntry.ts', 'src/runtime/judge/hook.ts'],
  },
  {
    // M98P2F: the serve factory and its token file moved out of the parent.
    // RLM98P2: the shared token lifecycle stays shared with companion voice
    // on main, so only the judge wrapper below is exclusive to this child.
    name: 'judgeServe',
    sources: [
      'src/runtime/judge/judgeServeEntry.ts',
      'src/runtime/judge/serve.ts',
      'src/runtime/judge/tokenFile.ts',
    ],
  },
]
const metaSchema = z.looseObject({
  outputs: z.record(
    z.string(),
    z.looseObject({
      inputs: z.record(z.string(), z.looseObject({ bytesInOutput: z.number() })),
      imports: z.array(z.looseObject({ path: z.string(), external: z.optional(z.boolean()) })),
    }),
  ),
})
// The last case reruns three real gates in-test (the split gate rereads every
// production metafile, 15 s on the macmini rig); 60 s is the measured bound.
const REAL_SPLIT_CASE_MS = 60_000
// Every child below is bounded: collection has no Vitest deadline, so an
// unbounded wait hangs the suite with no output (RLF-JUDGEP2: the linuxlt
// hang). Each bound is a multiple of the slowest observed real run: the
// split gate takes 15 s on the macmini and 11-18 s on Windows, so 120 s;
// `vsce ls` takes 67 s on the macmini and about 4 min in a worktree with
// 59,000 scratch files (docs/certification/cc-int6.md §4), so 600 s.
const GATE_TIMEOUT_MS = 120_000
const VSCE_TIMEOUT_MS = 600_000

const targets = [
  ['extension', 'dist/meta/extension.json'],
  ['modelApi', 'dist/meta/modelApi.json'],
  ['acp', 'dist/meta-acp/acp.json'],
] as const

// The run's shared production build (test/unit/productionBuild.ts, a Vitest
// global setup outside every hook's deadline), refused when missing or built
// from sources that changed since (RVM98P2R2 10). Checked while the file is
// collected, before the controls below mutate dist/.
assertCurrentProductionBuild(inject('productionBuildGeneration'), process.cwd())

function output(file: string, bundle: string) {
  const meta = metaSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  const result = meta.outputs[`dist/${bundle}.js`]
  if (result === undefined) throw new Error('Missing build output')
  return { meta, result }
}

function gate(script: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [`scripts/${script}.mjs`], {
    encoding: 'utf8',
    timeout: GATE_TIMEOUT_MS,
  })
}

/** The gate's problem lines that name a judge artifact, if the gate ran. */
function judgeProblems(result: Pick<SpawnSyncReturns<string>, 'status' | 'stderr'>): string[] {
  expect(result.status, result.stderr).not.toBeNull()
  return result.stderr.split(/\r?\n/).filter((line) => /judge/i.test(line))
}

function digest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// Every artifact mutation is hash-restored before a listing; only the
// allowlist changes its inventory. Reuse the real result for identical inputs.
const vsixListings = new Map<string, string[]>()
function vsixListing(): string[] {
  const key = digest('.vscodeignore')
  const cached = vsixListings.get(key)
  if (cached !== undefined) return cached
  const listing = execFileSync(
    process.execPath,
    ['node_modules/@vscode/vsce/vsce', 'ls', '--no-dependencies'],
    { encoding: 'utf8', timeout: VSCE_TIMEOUT_MS },
  ).split(/\r?\n/)
  vsixListings.set(key, listing)
  return listing
}

interface Control {
  readonly status: number | null
  readonly output: string
  readonly restored: boolean
}

// One mutation control: mutate, run the real gate, restore byte-exact. A
// timed-out gate reports its signal in the output, never a silent null.
function controlMany(files: readonly string[], mutate: () => void, script: string): Control {
  const originals = files.map((file) => ({ file, bytes: readFileSync(file), hash: digest(file) }))
  let red
  try {
    mutate()
    red = gate(script)
  } finally {
    for (const { file, bytes } of originals) writeFileSync(file, bytes)
  }
  return {
    status: red.status,
    output: `${red.stdout}${red.stderr}${red.error === undefined ? '' : String(red.error)}`,
    restored: originals.every(({ file, hash }) => digest(file) === hash),
  }
}

function control(file: string, mutate: () => void, script: string): Control {
  return controlMany([file], mutate, script)
}

function expectFired(result: Control, message: string) {
  expect(result.status, result.output).toBe(1)
  expect(result.output).toContain(message)
  expect(result.restored).toBe(true)
}

/** A restored gate prints byte-identical output at its earlier status. */
function expectGateUnchanged(
  script: 'check-bundle-split' | 'check-bundle-size' | 'check-host-globals',
  green: SpawnSyncReturns<string>,
) {
  const result = gate(script)
  expect(result.status, result.stderr).toBe(green.status)
  expect(`${result.stdout}${result.stderr}`).toBe(`${green.stdout}${green.stderr}`)
}

function leakInto(file: string, name: string, sources: readonly string[]) {
  return () => {
    const { meta, result } = output(file, name)
    for (const source of sources) result.inputs[source] = { bytesInOutput: 1 }
    writeFileSync(file, JSON.stringify(meta))
  }
}

function dropFrom(file: string, name: string, sources: readonly string[]) {
  return () => {
    const { meta, result } = output(file, name)
    for (const source of sources) Reflect.deleteProperty(result.inputs, source)
    writeFileSync(file, JSON.stringify(meta))
  }
}

// The controls run here, once, while the file is collected: each spawns a
// real gate (check-bundle-split rereads every production metafile, 15 s on
// the macmini), so running them in-test pushed single controls past the 5 s
// test deadline on a loaded runner (RVM98P2R3 10). Collection has no
// deadline; each case below still asserts its own control's exit, message
// and restoration.
//
// One gate run serves a whole batch: the split gate collects every
// violation before it exits (it pushes each to `problems` and exits 1 once),
// so a single run over a metafile carrying every leaked source reports each
// source's own message. Batching cut the suite from 282 split runs to 18
// (RLF-JUDGEP2); every one of the 103 cases still asserts its own message.
const greenSplit = gate('check-bundle-split')
const greenSize = gate('check-bundle-size')
const greenGlobals = gate('check-host-globals')
const leakBatches = targets.map(([name, file]) => ({
  name,
  result: control(file, leakInto(file, name, [...judgeFiles]), 'check-bundle-split'),
}))
const leakControls = leakBatches.flatMap(({ name, result }) =>
  [...judgeFiles].map((source) => ({ name, source, result })),
)
const missingBatch = control(
  'dist/meta/judgeP2.json',
  dropFrom('dist/meta/judgeP2.json', 'judgeP2', [...judgeFiles]),
  'check-bundle-split',
)
const missingControls = [...judgeFiles].map((source) => ({ source, result: missingBatch }))
const JUDGE_BUNDLE = 'dist/judgeP2.js'
const judgeOversize = control(
  JUDGE_BUNDLE,
  () => {
    writeFileSync(JUDGE_BUNDLE, ' '.repeat(75 * 1024 + 1))
  },
  'check-bundle-size',
)
const judgeGlobal = control(
  JUDGE_BUNDLE,
  () => {
    writeFileSync(JUDGE_BUNDLE, `${readFileSync(JUDGE_BUNDLE, 'utf8')}\nnavigator\n`)
  },
  'check-host-globals',
)
const judgeMissing = (() => {
  const hidden = `${JUDGE_BUNDLE}.missing-control`
  const hash = digest(JUDGE_BUNDLE)
  renameSync(JUDGE_BUNDLE, hidden)
  let size, pack
  try {
    size = gate('check-bundle-size')
    pack = gate('package-acp')
  } finally {
    renameSync(hidden, JUDGE_BUNDLE)
  }
  return { size, pack, restored: digest(JUDGE_BUNDLE) === hash, green: gate('check-bundle-size') }
})()

// The child batches leak every child source into each parent at once (one
// run each), and drop each child's own sources from its own metafile at
// once; each case still asserts its own source's messages.
const childSources = children.flatMap((child) => child.sources)
const childLeakBatches = [...targets, ['judgeP2', 'dist/meta/judgeP2.json'] as const].map(
  ([parent, file]) => control(file, leakInto(file, parent, childSources), 'check-bundle-split'),
)
const childMissingBatches = new Map(
  children.map(
    (child) =>
      [
        child.name,
        control(
          `dist/meta/${child.name}.json`,
          dropFrom(`dist/meta/${child.name}.json`, child.name, child.sources),
          'check-bundle-split',
        ),
      ] as const,
  ),
)
const childControls = children.flatMap((child) => {
  const missing = childMissingBatches.get(child.name)
  if (missing === undefined) throw new Error(`Missing split batch for ${child.name}`)
  return child.sources.map((source) => ({
    name: child.name,
    source,
    leaks: childLeakBatches,
    missing,
  }))
})

/** The real VSIX list before, without and after the bundles' allowlist entries. */
function allowlistControl(files: readonly string[]) {
  const listing = '.vscodeignore'
  const original = readFileSync(listing)
  const hash = digest(listing)
  const before = vsixListing()
  let without: string[]
  try {
    let text = original.toString('utf8')
    // Each bundle rides its own `!` line (the file starts by excluding
    // everything), so one listing without all of them proves each entry.
    for (const file of files) text = text.replace(`!${file}\n`, '')
    writeFileSync(listing, text)
    without = vsixListing()
  } finally {
    writeFileSync(listing, original)
  }
  return { before, without, restored: digest(listing) === hash, after: vsixListing() }
}

const sizeBudgets = [
  ['judgeSources', 75],
  ['judgeLint', 50],
  ['judgeHook', 100],
  ['judgeLocal', 75],
  ['judgeUses', 25],
  // RLM98P2: merged judge schema measures 25.2 KiB + 15%, rounded to 30.
  ['judgeServe', 30],
  ['validationSchema', 50],
] as const
const sharedAllowlist = allowlistControl([
  JUDGE_BUNDLE,
  ...sizeBudgets.map(([name]) => `dist/${name}.js`),
])
const sizeControls = sizeBudgets.map(([name, cap]) => {
  const file = `dist/${name}.js`
  return {
    name,
    file,
    oversize: control(
      file,
      () => {
        writeFileSync(file, ' '.repeat(cap * 1024 + 1))
      },
      'check-bundle-size',
    ),
    global: control(
      file,
      () => {
        writeFileSync(file, `${readFileSync(file, 'utf8')}\nnavigator\n`)
      },
      'check-host-globals',
    ),
    allowlist: sharedAllowlist,
  }
})
const judgeAllowlist = sharedAllowlist

const englishMetas = ['judgeP2', ...children.map((child) => child.name)]
const englishDuplicate = controlMany(
  englishMetas.map((name) => `dist/meta/${name}.json`),
  () => {
    for (const name of englishMetas) {
      const file = `dist/meta/${name}.json`
      const { meta, result } = output(file, name)
      result.inputs['src/shared/l10n/en.ts'] = { bytesInOutput: 1 }
      writeFileSync(file, JSON.stringify(meta))
    }
  },
  'check-bundle-split',
)
const englishUnloaded = controlMany(
  englishMetas.map((name) => `dist/meta/${name}.json`),
  () => {
    for (const name of englishMetas) {
      const file = `dist/meta/${name}.json`
      const { meta, result } = output(file, name)
      result.imports = result.imports.filter((entry) => entry.path !== './uiText.js')
      writeFileSync(file, JSON.stringify(meta))
    }
  },
  'check-bundle-split',
)
const englishControls = englishMetas.map((name) => ({
  name,
  duplicate: englishDuplicate,
  unloaded: englishUnloaded,
}))

// The Muse Code backend's log text is a backend detail: judge code reports
// through errorNameForLog (src/core/logging.ts), so no judge child bundle
// may carry it. The case below proves its own whistle fires before asserting
// the tree is clean, in the file's own inject-detect-restore idiom.
const BACKEND_LOG_TEXT = 'src/core/backends/musecode/logText.ts'
function judgeChildrenCarryingLogText(): string[] {
  return children
    .filter(({ name }) =>
      Object.hasOwn(output(`dist/meta/${name}.json`, name).result.inputs, BACKEND_LOG_TEXT),
    )
    .map(({ name }) => `dist/${name}.js`)
}

describe('phase-2 judge production delivery', () => {
  it('ships every merged implementation exclusively in the explicit-action factory', () => {
    const judge = output('dist/meta/judgeP2.json', 'judgeP2').result
    for (const source of judgeFiles) expect(judge.inputs).toHaveProperty(source)
    for (const [name, file] of targets) {
      const parent = output(file, name).result
      expect(Object.keys(parent.inputs).filter((source) => judgeFiles.has(source))).toEqual([])
    }
    expect(
      Object.keys(judge.inputs).filter(
        (source) => source.startsWith('src/core/backends/') && !source.endsWith('/launch.ts'),
      ),
    ).toEqual([])
    expect(judge.imports.some((entry) => entry.path === './uiText.js' && entry.external)).toBe(true)
    expect(judge.inputs).not.toHaveProperty('src/shared/l10n/en.ts')
    // The gate may be red for bundles this suite does not own; what this
    // case owns is that no problem names the judge bundles.
    expect(judgeProblems(greenSplit)).toEqual([])
  })

  it('keeps the backend log text out of every judge child bundle', () => {
    const file = 'dist/meta/judgeSources.json'
    const original = readFileSync(file)
    const hash = digest(file)
    try {
      const { meta, result } = output(file, 'judgeSources')
      result.inputs[BACKEND_LOG_TEXT] = { bytesInOutput: 1 }
      writeFileSync(file, JSON.stringify(meta))
      expect(judgeChildrenCarryingLogText()).toEqual(['dist/judgeSources.js'])
    } finally {
      writeFileSync(file, original)
    }
    expect(digest(file)).toBe(hash)
    expect(judgeChildrenCarryingLogText()).toEqual([])
  })

  it('lists every phase-2 production member in the real VSIX inventory', () => {
    const listing = vsixListing()
    for (const name of ['judgeP2', ...children.map((child) => child.name)])
      expect(listing).toContain(`dist/${name}.js`)
  })

  it.each(leakControls)(
    'fires the phase-2 leak guard in $name for $source with byte-exact restoration',
    ({ source, result }) => {
      expectFired(result, `carries ${source}, which belongs to the lazy judge bundle`)
    },
  )

  it.each(missingControls)(
    'fires the missing implementation guard for $source with byte-exact restoration',
    ({ source, result }) => {
      expectFired(result, `dist/judgeP2.js no longer carries ${source}`)
    },
  )

  it.each(childControls)(
    'fires each $name child split guard for $source with byte-exact restoration',
    ({ name, source, leaks, missing }) => {
      for (const result of leaks)
        expectFired(result, `carries ${source}, which belongs to dist/${name}.js`)
      expectFired(missing, `dist/${name}.js no longer carries ${source}`)
    },
  )

  it.each(sizeControls)(
    'fires $name size, globals and actual package allowlist guards',
    ({ file, oversize, global, allowlist }) => {
      expectFired(oversize, `OVER ${file}`)
      expectFired(global, `FAIL ${file}`)
      expect(allowlist.before).toContain(file)
      expect(allowlist.without).not.toContain(file)
      expect(allowlist.restored).toBe(true)
      expect(allowlist.after).toContain(file)
    },
  )

  it.each(englishControls)(
    'refuses $name duplicated English fallback and a missing shared-table import',
    ({ name, duplicate, unloaded }) => {
      expectFired(duplicate, `dist/${name}.js duplicates src/shared/l10n/en.ts`)
      expectFired(unloaded, `dist/${name}.js no longer loads the shared English table`)
    },
  )

  it('fires the new size and host-global guards without changing caps', () => {
    expectFired(judgeOversize, 'OVER dist/judgeP2.js')
    expectFired(judgeGlobal, 'FAIL dist/judgeP2.js')
    const { size, pack, restored, green } = judgeMissing
    expect(size.status).toBe(1)
    expect(size.stdout).toContain('MISS dist/judgeP2.js')
    expect(pack.status).toBe(1)
    expect(pack.stderr).toContain('dist/judgeP2.js is missing')
    expect(restored).toBe(true)
    expect(judgeProblems(green)).toEqual([])
  })

  it('includes the new member in the actual VSIX list and excludes it when its allowlist entry is removed', () => {
    expect(judgeAllowlist.before).toContain(JUDGE_BUNDLE)
    expect(judgeAllowlist.without).not.toContain(JUDGE_BUNDLE)
    expect(judgeAllowlist.restored).toBe(true)
    expect(judgeAllowlist.after).toContain(JUDGE_BUNDLE)
  })

  it('lists judgeP2.js as required in both CI package inventories', () => {
    const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
    expect(workflow).toContain('extension/dist/judgeP2.js')
    expect(workflow).toContain('package/dist/judgeP2.js')
    // These are delivery inputs, not additional CLI commands or support claims.
    const root = path.resolve('src/runtime/main.ts')
    expect(readFileSync(root, 'utf8')).not.toContain('judgeEntry')
  })

  // Every control above checks its own byte-exact restoration; this verifies
  // the complete restored artifact set once, last (three real gates). The
  // gates may be red for bundles this suite does not own (the shared build
  // never builds desktop, so the size gate lists it missing), so the proof
  // is byte-identical output before and after, not a green exit.
  it(
    'leaves every restored artifact byte-identical',
    () => {
      expectGateUnchanged('check-bundle-split', greenSplit)
      expectGateUnchanged('check-bundle-size', greenSize)
      expectGateUnchanged('check-host-globals', greenGlobals)
    },
    REAL_SPLIT_CASE_MS,
  )
})
