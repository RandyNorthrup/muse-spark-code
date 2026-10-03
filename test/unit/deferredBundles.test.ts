// Build the real shipped entries: separation is a property of their output,
// rather than a source-import mock. The production build is serial here.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'

const metafileSchema = z.looseObject({
  outputs: z.record(
    z.string(),
    z.looseObject({
      inputs: z.record(z.string(), z.object({ bytesInOutput: z.number() })),
    }),
  ),
})

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
})

function inputs(name: string): string[] {
  const raw: unknown = JSON.parse(readFileSync(`dist/meta/${name}.json`, 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('inputs' in raw)) {
    throw new Error('Invalid build metafile')
  }
  if (typeof raw.inputs !== 'object' || raw.inputs === null) {
    throw new Error('Missing build inputs')
  }
  return Object.keys(raw.inputs).map((file) => file.split(path.sep).join('/'))
}

describe('deferred cohort bundles', () => {
  it('loads the activation entry without requiring either action bundle', () => {
    const entry = path.resolve('dist/extension.js')
    expect(readFileSync(entry, 'utf8')).toContain('./sessionBoard.js')
    expect(readFileSync('dist/modelApi.js', 'utf8')).toContain('./reviewer.js')
    const nativeRequire = createRequire(entry)
    const loaded: string[] = []
    const module: { exports: unknown } = { exports: {} }
    const run = vm.compileFunction(
      readFileSync(entry, 'utf8'),
      ['require', 'module', 'exports', '__dirname', '__filename'],
      { filename: entry },
    )
    Reflect.apply(run, undefined, [
      (file: string): unknown => {
        loaded.push(file)
        return file === 'vscode' ? {} : nativeRequire(file)
      },
      module,
      module.exports,
      path.dirname(entry),
      entry,
    ])
    expect(module.exports).toHaveProperty('activate', expect.any(Function))
    expect(loaded).not.toContain('./sessionBoard.js')
    expect(loaded).not.toContain('./reviewer.js')
  })

  it('keeps board and best-of-N execution out of activation', () => {
    const files = inputs('extension')
    expect(files).not.toContain('src/host/bestOfN/bestOfNManager.ts')
    expect(files).not.toContain('src/core/bestOfN/bestOfNRunner.ts')
    expect(files).not.toContain('src/host/sessionBoard.ts')
  })

  it('keeps paid review execution out of the session first-turn bundle', () => {
    expect(inputs('modelApi')).not.toContain('src/core/backends/modelapi/reviewerEntry.ts')
    expect(inputs('reviewer')).toContain('src/core/backends/modelapi/reviewerEntry.ts')
  })

  it.each([
    ['extension', 'src/host/bestOfN/bestOfNManager.ts'],
    ['modelApi', 'src/core/backends/modelapi/reviewerEntry.ts'],
  ])('fires the %s split guard and restores its metafile byte-exact', (name, source) => {
    const file = `dist/meta/${name}.json`
    const original = readFileSync(file)
    const hash = createHash('sha256').update(original).digest('hex')
    const meta = metafileSchema.parse(JSON.parse(original.toString('utf8')))
    const output = meta.outputs[`dist/${name}.js`]
    if (output === undefined) throw new Error('Missing bundle output')
    try {
      output.inputs[source] = { bytesInOutput: 1 }
      writeFileSync(file, JSON.stringify(meta))
      const red = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
        encoding: 'utf8',
      })
      expect(red.status).toBe(1)
      expect(red.stderr).toContain(`carries ${source}, which loads only on its first action`)
    } finally {
      writeFileSync(file, original)
    }
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash)
    const green = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
      encoding: 'utf8',
    })
    expect(green.status, green.stderr).toBe(0)
  })
})
