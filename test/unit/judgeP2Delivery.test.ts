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
// Real bundle-split gate rereads every production metafile (2.2s on this tree); a child case runs it five times.
const REAL_SPLIT_CASE_MS = 60_000
// `vsce ls` walks the real package tree; each distinct allowlist needs one real listing.
const REAL_VSIX_CASE_MS = 60_000

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
  return spawnSync(process.execPath, [`scripts/${script}.mjs`], { encoding: 'utf8' })
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
    { encoding: 'utf8' },
  ).split(/\r?\n/)
  vsixListings.set(key, listing)
  return listing
}

interface Control {
  readonly status: number | null
  readonly output: string
  readonly restored: boolean
}

// One mutation control: mutate, run the real gate, restore byte-exact.
function control(file: string, mutate: () => void, script: string): Control {
  const original = readFileSync(file)
  const hash = digest(file)
  let red
  try {
    mutate()
    red = gate(script)
  } finally {
    writeFileSync(file, original)
  }
  return {
    status: red.status,
    output: `${red.stdout}${red.stderr}`,
    restored: digest(file) === hash,
  }
}

function expectFired(result: Control, message: string) {
  expect(result.status, result.output).toBe(1)
  expect(result.output).toContain(message)
  expect(result.restored).toBe(true)
}

function guard(file: string, mutate: () => void, script: string, message: string) {
  expectFired(control(file, mutate, script), message)
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

// The default-deadline controls run here, once, while the file is collected:
// each spawns a real gate (check-bundle-split rereads every production
// metafile, 2.6 s idle on kubuntu), so a loaded runner pushed a single control
// past its 5 s test deadline (RVM98P2R3 10). Collection has no deadline; each
// case below still asserts its own control's exit, message and restoration.
const greenSplit = gate('check-bundle-split')
const leakControls = targets.flatMap(([name, file]) =>
  [...judgeFiles].map((source) => ({
    name,
    source,
    result: control(file, leakInto(file, name, source), 'check-bundle-split'),
  })),
)
const missingControls = [...judgeFiles].map((source) => ({
  source,
  result: control(
    'dist/meta/judgeP2.json',
    dropFrom('dist/meta/judgeP2.json', 'judgeP2', source),
    'check-bundle-split',
  ),
}))
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

  it(
    'lists every phase-2 production member in the real VSIX inventory',
    () => {
      const listing = vsixListing()
      for (const name of ['judgeP2', ...children.map((child) => child.name)])
        expect(listing).toContain(`dist/${name}.js`)
    },
    REAL_VSIX_CASE_MS,
  )

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

  it.each(children.flatMap(({ name, sources }) => sources.map((source) => ({ name, source }))))(
    'fires each $name child split guard for $source with byte-exact restoration',
    ({ name, source }) => {
      for (const [parent, file] of [...targets, ['judgeP2', 'dist/meta/judgeP2.json'] as const]) {
        guard(
          file,
          leakInto(file, parent, source),
          'check-bundle-split',
          `carries ${source}, which belongs to dist/${name}.js`,
        )
      }
      const file = `dist/meta/${name}.json`
      guard(
        file,
        dropFrom(file, name, source),
        'check-bundle-split',
        `dist/${name}.js no longer carries ${source}`,
      )
    },
    REAL_SPLIT_CASE_MS,
  )

  it.each([
    ['judgeSources', 75],
    ['judgeLint', 50],
    ['judgeHook', 100],
    ['judgeLocal', 75],
    ['judgeUses', 25],
    // RLM98P2: merged judge schema measures 25.2 KiB + 15%, rounded to 30.
    ['judgeServe', 30],
    ['validationSchema', 50],
  ] as const)(
    'fires %s size, globals and actual package allowlist guards',
    (name, cap) => {
      const file = `dist/${name}.js`
      guard(
        file,
        () => {
          writeFileSync(file, ' '.repeat(cap * 1024 + 1))
        },
        'check-bundle-size',
        `OVER ${file}`,
      )
      guard(
        file,
        () => {
          writeFileSync(file, `${readFileSync(file, 'utf8')}\nnavigator\n`)
        },
        'check-host-globals',
        `FAIL ${file}`,
      )
      const listing = '.vscodeignore'
      const original = readFileSync(listing)
      const hash = digest(listing)
      expect(vsixListing()).toContain(file)
      try {
        writeFileSync(listing, original.toString('utf8').replace(`!${file}\n`, ''))
        expect(vsixListing()).not.toContain(file)
      } finally {
        writeFileSync(listing, original)
      }
      expect(digest(listing)).toBe(hash)
      expect(vsixListing()).toContain(file)
    },
    REAL_VSIX_CASE_MS,
  )

  it.each(['judgeP2', ...children.map((child) => child.name)])(
    'refuses %s duplicated English fallback and a missing shared-table import',
    (name) => {
      const file = `dist/meta/${name}.json`
      guard(
        file,
        () => {
          const { meta, result } = output(file, name)
          result.inputs['src/shared/l10n/en.ts'] = { bytesInOutput: 1 }
          writeFileSync(file, JSON.stringify(meta))
        },
        'check-bundle-split',
        `dist/${name}.js duplicates src/shared/l10n/en.ts`,
      )
      guard(
        file,
        () => {
          const { meta, result } = output(file, name)
          result.imports = result.imports.filter((entry) => entry.path !== './uiText.js')
          writeFileSync(file, JSON.stringify(meta))
        },
        'check-bundle-split',
        `dist/${name}.js no longer loads the shared English table`,
      )
    },
    REAL_SPLIT_CASE_MS,
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

  it(
    'includes the new member in the actual VSIX list and excludes it when its allowlist entry is removed',
    () => {
      expect(vsixListing()).toContain('dist/judgeP2.js')
      const file = '.vscodeignore'
      const original = readFileSync(file)
      const hash = digest(file)
      try {
        writeFileSync(file, original.toString('utf8').replace('!dist/judgeP2.js\n', ''))
        expect(vsixListing()).not.toContain('dist/judgeP2.js')
      } finally {
        writeFileSync(file, original)
      }
      expect(digest(file)).toBe(hash)
      expect(vsixListing()).toContain('dist/judgeP2.js')
    },
    REAL_VSIX_CASE_MS,
  )

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
    REAL_SPLIT_CASE_MS,
  )
})
