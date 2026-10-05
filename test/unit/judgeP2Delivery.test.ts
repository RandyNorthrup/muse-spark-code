// Verify the real production artifacts and exercise every new delivery guard.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'

const judgeFiles = [
  'src/runtime/judge/judgeEntry.ts',
  'src/core/judge/calibration/apply.ts',
  'src/core/judge/calibration/fit.ts',
  'src/core/judge/calibration/report.ts',
  'src/core/judge/calibration/schema.ts',
  'src/core/judge/sampling.ts',
  'src/core/judge/contrastive.ts',
  'src/runtime/judge/serve.ts',
  'src/runtime/judge/tokenFile.ts',
  'src/runtime/judge/commands.ts',
  'src/runtime/judge/mcp.ts',
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
const targets = [
  ['extension', 'dist/meta/extension.json'],
  ['modelApi', 'dist/meta/modelApi.json'],
  ['acp', 'dist/meta-acp/acp.json'],
] as const

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
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

function vsixListing(): string[] {
  return execFileSync(
    process.execPath,
    ['node_modules/@vscode/vsce/vsce', 'ls', '--no-dependencies'],
    { encoding: 'utf8' },
  ).split(/\r?\n/)
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
  const green = gate(script)
  expect(green.status, green.stderr).toBe(0)
}

describe('phase-2 judge production delivery', () => {
  it('ships every merged implementation exclusively in the explicit-action factory', () => {
    const judge = output('dist/meta/judge.json', 'judge').result
    for (const source of judgeFiles) expect(judge.inputs).toHaveProperty(source)
    for (const [name, file] of targets) {
      const parent = output(file, name).result
      expect(
        Object.keys(parent.inputs).filter((source) => source.startsWith('src/core/judge/')),
      ).toEqual([])
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

  it.each(targets)(
    'fires each phase-2 leak guard in %s with byte-exact restoration',
    (name, file) => {
      for (const source of judgeFiles) {
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
      }
    },
  )

  it('fires every missing implementation guard with byte-exact restoration', () => {
    const file = 'dist/meta/judge.json'
    for (const source of judgeFiles) {
      guard(
        file,
        () => {
          const { meta, result } = output(file, 'judge')
          Reflect.deleteProperty(result.inputs, source)
          writeFileSync(file, JSON.stringify(meta))
        },
        'check-bundle-split',
        `dist/judge.js no longer carries ${source}`,
      )
    }
  })

  it('refuses duplicated English fallback and a missing shared-table import', () => {
    const file = 'dist/meta/judge.json'
    guard(
      file,
      () => {
        const { meta, result } = output(file, 'judge')
        result.inputs['src/shared/l10n/en.ts'] = { bytesInOutput: 1 }
        writeFileSync(file, JSON.stringify(meta))
      },
      'check-bundle-split',
      'dist/judge.js duplicates src/shared/l10n/en.ts',
    )
    guard(
      file,
      () => {
        const { meta, result } = output(file, 'judge')
        result.imports = result.imports.filter((entry) => entry.path !== './uiText.js')
        writeFileSync(file, JSON.stringify(meta))
      },
      'check-bundle-split',
      'dist/judge.js no longer loads the shared English table',
    )
  })

  it('fires the new size and host-global guards without changing caps', () => {
    const file = 'dist/judge.js'
    guard(
      file,
      () => {
        writeFileSync(file, ' '.repeat(75 * 1024 + 1))
      },
      'check-bundle-size',
      'OVER dist/judge.js',
    )
    guard(
      file,
      () => {
        writeFileSync(file, `${readFileSync(file, 'utf8')}\nnavigator\n`)
      },
      'check-host-globals',
      'FAIL dist/judge.js',
    )
    const hidden = `${file}.missing-control`
    const originalHash = digest(file)
    renameSync(file, hidden)
    try {
      const red = gate('check-bundle-size')
      expect(red.status).toBe(1)
      expect(red.stdout).toContain('MISS dist/judge.js')
      const pack = gate('package-acp')
      expect(pack.status).toBe(1)
      expect(pack.stderr).toContain('dist/judge.js is missing')
    } finally {
      renameSync(hidden, file)
    }
    expect(digest(file)).toBe(originalHash)
    expect(gate('check-bundle-size').status).toBe(0)
  })

  it('includes the new member in the actual VSIX list and excludes it when its allowlist entry is removed', () => {
    expect(vsixListing()).toContain('dist/judge.js')
    const file = '.vscodeignore'
    const original = readFileSync(file)
    const hash = digest(file)
    try {
      writeFileSync(file, original.toString('utf8').replace('!dist/judge.js\n', ''))
      expect(vsixListing()).not.toContain('dist/judge.js')
    } finally {
      writeFileSync(file, original)
    }
    expect(digest(file)).toBe(hash)
    expect(vsixListing()).toContain('dist/judge.js')
  })

  it('lists judge.js as required in both CI package inventories', () => {
    const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
    expect(workflow).toContain('extension/dist/judge.js')
    expect(workflow).toContain('package/dist/judge.js')
    // These are delivery inputs, not additional CLI commands or support claims.
    const root = path.resolve('src/runtime/main.ts')
    expect(readFileSync(root, 'utf8')).not.toContain('judgeEntry')
  })
})
