// Verify the real production artifacts and exercise every new delivery guard.
import { execFileSync, spawnSync } from 'node:child_process'
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
// The last case runs three real gates; the bundle-split gate rereads every production metafile.
const REAL_GATES_CASE_MS = 60_000
// A gate takes 2 to 18 s and `vsce ls` up to a minute. Their real runs happen while
// the file is collected, where no case's deadline reaches, so one that has not
// ended by now is hung: the file fails naming it, instead of holding the shard.
const GATE_HUNG_MS = 300_000

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

function gate(script: string) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], {
    encoding: 'utf8',
    timeout: GATE_HUNG_MS,
  })
  if (result.error !== undefined)
    throw new Error(`scripts/${script}.mjs did not end: ${result.error.message}`, {
      cause: result.error,
    })
  return result
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
    { encoding: 'utf8', timeout: GATE_HUNG_MS },
  ).split(/\r?\n/)
  vsixListings.set(key, listing)
  return listing
}

interface Control {
  readonly status: number | null
  readonly output: string
  readonly restored: boolean
}

type Mutation = readonly [file: string, mutate: () => void]

// Every mutation at once, one run of the real gate, every file restored
// byte-exact. A gate reports every problem it finds, so each case below still
// asserts its own message from that run.
function controlAll(mutations: readonly Mutation[], script: string): Control {
  const originals = new Map(mutations.map(([file]) => [file, readFileSync(file)]))
  const hashes = new Map(mutations.map(([file]) => [file, digest(file)]))
  let red
  try {
    for (const [, mutate] of mutations) mutate()
    red = gate(script)
  } finally {
    for (const [file, original] of originals) writeFileSync(file, original)
  }
  return {
    status: red.status,
    output: `${red.stdout}${red.stderr}`,
    restored: mutations.every(([file]) => digest(file) === hashes.get(file)),
  }
}

function control(file: string, mutate: () => void, script: string): Control {
  return controlAll([[file, mutate]], script)
}

function expectFired(result: Control, message: string) {
  expect(result.status, result.output).toBe(1)
  expect(result.output).toContain(message)
  expect(result.restored).toBe(true)
}

// The gate counts its problems before it lists them. One gate run holds a whole
// family's mutations, so its report runs to 230 lines, and each case below asserts
// lines of it: a report cut short would read as those cases' guards not firing.
function expectWholeReport({ output }: Control, planted: number) {
  expect(output).toContain(`bundle split: ${String(planted)} problem(s)`)
  expect(output.split(/\r?\n/u).filter((line) => line.startsWith('  '))).toHaveLength(planted)
}

function leakInto(file: string, name: string, source: string) {
  return () => {
    const { meta, result } = output(file, name)
    result.inputs[source] = { bytesInOutput: 1 }
    writeFileSync(file, JSON.stringify(meta))
  }
}

function dropFrom(file: string, name: string, source: string) {
  return () => {
    const { meta, result } = output(file, name)
    Reflect.deleteProperty(result.inputs, source)
    writeFileSync(file, JSON.stringify(meta))
  }
}

// The controls run here, once, while the file is collected: each spawns a real
// gate (check-bundle-split rereads every production metafile: 2.6 s idle on
// kubuntu, 9 to 18 s on a loaded Windows workstation), so a loaded runner pushed
// a single control past its test deadline (RVM98P2R3 10). One gate run per
// mutation was 282 of them, which no shard can finish inside its job's limit:
// runs 41214393586 and 41516831678 lost a shard on all three OSes here, with no
// line in the log. So one run proves all the mutations of its kind, and each
// case below still asserts its own message, the run's exit and the restoration.
const greenSplit = gate('check-bundle-split')
const leakControls = targets.flatMap(([name]) =>
  [...judgeFiles].map((source) => ({ name, source })),
)
const judgeSplit = controlAll(
  [
    ...targets.flatMap(([name, file]) =>
      [...judgeFiles].map((source): Mutation => [file, leakInto(file, name, source)]),
    ),
    ...[...judgeFiles].map((source): Mutation => [
      'dist/meta/judgeP2.json',
      dropFrom('dist/meta/judgeP2.json', 'judgeP2', source),
    ]),
  ],
  'check-bundle-split',
)
const missingControls = [...judgeFiles].map((source) => ({ source }))
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

const childParents = [...targets, ['judgeP2', 'dist/meta/judgeP2.json'] as const]
const childSplit = controlAll(
  children.flatMap(({ name, sources }) =>
    sources.flatMap((source): Mutation[] => [
      ...childParents.map(([parent, file]): Mutation => [file, leakInto(file, parent, source)]),
      [`dist/meta/${name}.json`, dropFrom(`dist/meta/${name}.json`, name, source)],
    ]),
  ),
  'check-bundle-split',
)
const childControls = children.flatMap(({ name, sources }) =>
  sources.map((source) => ({ name, source })),
)

/** The real VSIX list before, without and after the files' allowlist entries (two real listings). */
function allowlistControl(files: readonly string[]) {
  const listing = '.vscodeignore'
  const original = readFileSync(listing)
  const hash = digest(listing)
  const before = vsixListing()
  let without: string[]
  try {
    const entries = original.toString('utf8').split('\n')
    writeFileSync(
      listing,
      entries.filter((entry) => files.every((file) => entry !== `!${file}`)).join('\n'),
    )
    without = vsixListing()
  } finally {
    writeFileSync(listing, original)
  }
  return { before, without, restored: digest(listing) === hash, after: vsixListing() }
}

const sizeControls = (
  [
    ['judgeSources', 75],
    ['judgeLint', 50],
    ['judgeHook', 100],
    ['judgeLocal', 75],
    ['judgeUses', 25],
    // RLM98P2: merged judge schema measures 25.2 KiB + 15%, rounded to 30.
    ['judgeServe', 30],
    ['validationSchema', 50],
  ] as const
).map(([name, cap]) => {
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
  }
})
const judgeAllowlist = allowlistControl([JUDGE_BUNDLE, ...sizeControls.map(({ file }) => file)])

const englishControls = ['judgeP2', ...children.map((child) => child.name)].map((name) => ({
  name,
}))
const englishSplit = controlAll(
  englishControls.flatMap(({ name }): Mutation[] => {
    const file = `dist/meta/${name}.json`
    return [
      [
        file,
        () => {
          const { meta, result } = output(file, name)
          result.inputs['src/shared/l10n/en.ts'] = { bytesInOutput: 1 }
          writeFileSync(file, JSON.stringify(meta))
        },
      ],
      [
        file,
        () => {
          const { meta, result } = output(file, name)
          result.imports = result.imports.filter((entry) => entry.path !== './uiText.js')
          writeFileSync(file, JSON.stringify(meta))
        },
      ],
    ]
  }),
  'check-bundle-split',
)

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
    expect(greenSplit.status, greenSplit.stderr).toBe(0)
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

  it('reports exactly the problems each shared gate run planted, every one of them', () => {
    expectWholeReport(judgeSplit, leakControls.length + missingControls.length)
    expectWholeReport(childSplit, childControls.length * (childParents.length + 1))
    expectWholeReport(englishSplit, englishControls.length * 2)
  })

  it.each(leakControls)(
    'fires the phase-2 leak guard in $name for $source with byte-exact restoration',
    ({ name, source }) => {
      expectFired(
        judgeSplit,
        `dist/${name}.js carries ${source}, which belongs to the lazy judge bundle`,
      )
    },
  )

  it.each(missingControls)(
    'fires the missing implementation guard for $source with byte-exact restoration',
    ({ source }) => {
      expectFired(judgeSplit, `dist/judgeP2.js no longer carries ${source}`)
    },
  )

  it.each(childControls)(
    'fires each $name child split guard for $source with byte-exact restoration',
    ({ name, source }) => {
      for (const [parent] of childParents)
        expectFired(
          childSplit,
          `dist/${parent}.js carries ${source}, which belongs to dist/${name}.js`,
        )
      expectFired(childSplit, `dist/${name}.js no longer carries ${source}`)
    },
  )

  it.each(sizeControls)(
    'fires $name size, globals and actual package allowlist guards',
    ({ file, oversize, global }) => {
      expectFired(oversize, `OVER ${file}`)
      expectFired(global, `FAIL ${file}`)
      expect(judgeAllowlist.before).toContain(file)
      expect(judgeAllowlist.without).not.toContain(file)
      expect(judgeAllowlist.restored).toBe(true)
      expect(judgeAllowlist.after).toContain(file)
    },
  )

  it.each(englishControls)(
    'refuses $name duplicated English fallback and a missing shared-table import',
    ({ name }) => {
      expectFired(englishSplit, `dist/${name}.js duplicates src/shared/l10n/en.ts`)
      expectFired(englishSplit, `dist/${name}.js no longer loads the shared English table`)
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
    expect(green.status).toBe(0)
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
  // the complete restored artifact set once, last (three real gates).
  it(
    'leaves every restored artifact green',
    () => {
      for (const script of ['check-bundle-split', 'check-bundle-size', 'check-host-globals']) {
        const green = gate(script)
        expect(green.status, green.stderr).toBe(0)
      }
    },
    REAL_GATES_CASE_MS,
  )
})
