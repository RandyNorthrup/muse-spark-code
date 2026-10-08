// Verify the real production artifacts and exercise every new delivery guard.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'

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
    name: 'judgeServe',
    sources: [
      'src/runtime/judge/judgeServeEntry.ts',
      'src/runtime/judge/serve.ts',
      'src/runtime/judge/tokenFile.ts',
      'src/runtime/tokenFile.ts',
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

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
})
// Every mutation restores and checks the original hash. Verify that complete
// restored artifact set once; rerunning it after each identical restoration
// repeated hundreds of full metafile parses without adding a distinct control.
afterAll(() => {
  for (const script of ['check-bundle-split', 'check-bundle-size', 'check-host-globals']) {
    const green = gate(script)
    expect(green.status, green.stderr).toBe(0)
  }
})

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

function guard(file: string, mutate: () => void, script: string, message: string) {
  const original = readFileSync(file)
  const hash = digest(file)
  try {
    mutate()
    const red = gate(script)
    expect(red.status, red.stderr).toBe(1)
    expect(`${red.stdout}${red.stderr}`).toContain(message)
  } finally {
    writeFileSync(file, original)
  }
  expect(digest(file)).toBe(hash)
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
    expect(gate('check-bundle-split').status).toBe(0)
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

  // Each real-gate control has its own unchanged deadline on this rig.
  it.each(
    targets.flatMap(([name, file]) => [...judgeFiles].map((source) => ({ name, file, source }))),
  )(
    'fires the phase-2 leak guard in $name for $source with byte-exact restoration',
    ({ name, file, source }) => {
      guard(
        file,
        () => {
          const { meta, result } = output(file, name)
          result.inputs[source] = { bytesInOutput: 1 }
          writeFileSync(file, JSON.stringify(meta))
        },
        'check-bundle-split',
        `carries ${source}, which belongs to the lazy judge bundle`,
      )
    },
  )

  it.each([...judgeFiles])(
    'fires the missing implementation guard for %s with byte-exact restoration',
    (source) => {
      const file = 'dist/meta/judgeP2.json'
      guard(
        file,
        () => {
          const { meta, result } = output(file, 'judgeP2')
          Reflect.deleteProperty(result.inputs, source)
          writeFileSync(file, JSON.stringify(meta))
        },
        'check-bundle-split',
        `dist/judgeP2.js no longer carries ${source}`,
      )
    },
  )

  it.each(children.flatMap(({ name, sources }) => sources.map((source) => ({ name, source }))))(
    'fires each $name child split guard for $source with byte-exact restoration',
    ({ name, source }) => {
      for (const [parent, file] of [...targets, ['judgeP2', 'dist/meta/judgeP2.json'] as const]) {
        guard(
          file,
          () => {
            const { meta, result } = output(file, parent)
            result.inputs[source] = { bytesInOutput: 1 }
            writeFileSync(file, JSON.stringify(meta))
          },
          'check-bundle-split',
          `carries ${source}, which belongs to dist/${name}.js`,
        )
      }
      const file = `dist/meta/${name}.json`
      guard(
        file,
        () => {
          const { meta, result } = output(file, name)
          Reflect.deleteProperty(result.inputs, source)
          writeFileSync(file, JSON.stringify(meta))
        },
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
    ['judgeServe', 25],
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
    const file = 'dist/judgeP2.js'
    guard(
      file,
      () => {
        writeFileSync(file, ' '.repeat(75 * 1024 + 1))
      },
      'check-bundle-size',
      'OVER dist/judgeP2.js',
    )
    guard(
      file,
      () => {
        writeFileSync(file, `${readFileSync(file, 'utf8')}\nnavigator\n`)
      },
      'check-host-globals',
      'FAIL dist/judgeP2.js',
    )
    const hidden = `${file}.missing-control`
    const originalHash = digest(file)
    renameSync(file, hidden)
    try {
      const red = gate('check-bundle-size')
      expect(red.status).toBe(1)
      expect(red.stdout).toContain('MISS dist/judgeP2.js')
      const pack = gate('package-acp')
      expect(pack.status).toBe(1)
      expect(pack.stderr).toContain('dist/judgeP2.js is missing')
    } finally {
      renameSync(hidden, file)
    }
    expect(digest(file)).toBe(originalHash)
    expect(gate('check-bundle-size').status).toBe(0)
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
})
