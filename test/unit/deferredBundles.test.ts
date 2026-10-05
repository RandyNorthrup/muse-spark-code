// Build the real shipped Node entries once with the production plugins.
// Each drill changes its own metafile copy, never shared dist/ files.
import { createHash } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  checkDeferredBundles,
  deferredCohort,
  sharedUiText,
  sharedValidation,
} from '../../scripts/lib/deferredBundles.mjs'
import type * as validation from '../../src/shared/validationEntry'

const metafileSchema = z.looseObject({
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(
    z.string(),
    z.looseObject({
      inputs: z.record(z.string(), z.object({ bytesInOutput: z.number() })),
    }),
  ),
})

const fixtures = new Map<string, { bytes: Buffer; meta: z.infer<typeof metafileSchema> }>()
const bundleTexts = new Map<string, string>()
const inputMaps = new Map<string, ReadonlyMap<string, number>>()
const supportModules = new Map<string, unknown>()
const parserSchema = z.object({
  object: z.custom<typeof validation.object>((value) => typeof value === 'function'),
  string: z.custom<typeof validation.string>((value) => typeof value === 'function'),
})
const parsers: z.infer<typeof parserSchema>[] = []

beforeAll(async () => {
  const common = {
    outdir: 'dist',
    write: false,
    bundle: true,
    minify: true,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  } as const
  const builds = await Promise.all([
    build({
      ...common,
      entryPoints: {
        extension: 'src/extension.ts',
        modelApi: 'src/host/backend/modelApiEntry.ts',
        sessionBoard: 'src/host/sessionBoardEntry.ts',
        reviewer: 'src/core/backends/modelapi/reviewerEntry.ts',
        codeIntel: 'src/host/ide/codeIntelEntry.ts',
        voice: 'src/host/voice/voiceEntry.ts',
        webFetch: 'src/host/web/webFetchEntry.ts',
        museCodeReviewer: 'src/host/review/museCodeReviewerEntry.ts',
        whatsNew: 'src/host/whatsNew/whatsNewEntry.ts',
        browserCheck: 'src/host/browser/browserCheckEntry.ts',
        browserRuntime: 'src/host/browser/browserRuntimeEntry.ts',
        checkpointStore: 'src/host/checkpoints/checkpointStoreEntry.ts',
        pageWorker: 'src/host/web/pageWorker.ts',
        searchWorker: 'src/host/backend/searchWorker.ts',
      },
      plugins: [sharedUiText, sharedValidation, deferredCohort],
      external: ['vscode', '@napi-rs/keyring'],
    }),
    build({
      ...common,
      target: 'node22',
      entryPoints: { acp: 'src/runtime/main.ts' },
      plugins: [sharedUiText, sharedValidation, deferredCohort],
      external: ['@napi-rs/keyring'],
    }),
    build({
      ...common,
      entryPoints: {
        uiText: 'src/shared/l10n/en.ts',
        validation: 'src/shared/validationEntry.ts',
      },
    }),
  ])
  for (const { metafile, outputFiles } of builds) {
    for (const output of outputFiles)
      bundleTexts.set(path.basename(output.path, '.js'), output.text)
    for (const [output, details] of Object.entries(metafile.outputs)) {
      const name = path.basename(output, '.js')
      const meta = metafileSchema.parse({
        inputs: Object.fromEntries(
          Object.keys(details.inputs).map((file) => [file, metafile.inputs[file]]),
        ),
        outputs: { [`dist/${name}.js`]: details },
      })
      fixtures.set(`dist/${name === 'acp' ? 'meta-acp' : 'meta'}/${name}.json`, {
        bytes: Buffer.from(JSON.stringify(meta)),
        meta,
      })
    }
  }
  parsers.push(parserSchema.parse(loadSupportBundle('validation')))
  expect(checkDeferredBundles(bundleInputs)).toEqual([])
})

afterAll(() => {
  for (const { bytes, meta } of fixtures.values()) {
    expect(createHash('sha256').update(JSON.stringify(meta)).digest('hex')).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    )
  }
})

function bundleFile(name: string) {
  return path.resolve('dist', `${name}.js`)
}

function loadSupportBundle(name: string): unknown {
  if (supportModules.has(name)) return supportModules.get(name)
  const module: { exports: unknown } = { exports: {} }
  const entry = bundleFile(name)
  const run = vm.compileFunction(
    bundleText(name),
    ['require', 'module', 'exports', '__dirname', '__filename'],
    { filename: entry },
  )
  Reflect.apply(run, undefined, [
    createRequire(entry),
    module,
    module.exports,
    path.dirname(entry),
    entry,
  ])
  supportModules.set(name, module.exports)
  return module.exports
}

function bundleText(name: string) {
  const text = bundleTexts.get(name)
  if (text === undefined) throw new Error(`Missing built bundle: ${name}`)
  return text
}

function fixture(file: string) {
  const built = fixtures.get(file)
  if (built === undefined) throw new Error(`Missing build metafile: ${file}`)
  return built
}

function bundleInputs({ output, metafile }: { output: string; metafile: string }) {
  let inputs = inputMaps.get(output)
  if (inputs === undefined) {
    inputs = outputInputs(fixture(metafile).meta, output)
    inputMaps.set(output, inputs)
  }
  return inputs
}

function outputInputs(meta: z.infer<typeof metafileSchema>, output: string) {
  const built = meta.outputs[output]
  if (built === undefined) throw new Error(`Missing bundle output: ${output}`)
  return new Map(
    Object.entries(built.inputs).map(([file, { bytesInOutput }]) => [file, bytesInOutput]),
  )
}

function inputs(name: string): string[] {
  return Object.keys(fixture(`dist/meta/${name}.json`).meta.inputs).map((file) =>
    file.split(path.sep).join('/'),
  )
}

describe('deferred cohort bundles', () => {
  it('uses the real shared parser for boundary checks without inlining it in Node bundles', () => {
    const parser = parsers[0]
    if (parser === undefined) throw new Error('Missing built parser')
    expect(parser.object({ value: parser.string() }).safeParse({ value: 1 }).success).toBe(false)
    expect(parser.object({ value: parser.string() }).safeParse({ value: 'captured' }).success).toBe(
      true,
    )
    for (const name of [
      'extension',
      'modelApi',
      'browserCheck',
      'browserRuntime',
      'whatsNew',
      'checkpointStore',
      'pageWorker',
      'searchWorker',
    ]) {
      expect(inputs(name).filter((file) => file.startsWith('node_modules/zod/v4/mini/'))).toEqual(
        [],
      )
      expect(bundleText(name)).toContain('./validation.js')
    }
  })

  it('loads the activation entry without requiring either action bundle', () => {
    const entry = bundleFile('extension')
    expect(bundleText('extension')).toContain('./sessionBoard.js')
    expect(bundleText('modelApi')).toContain('./reviewer.js')
    const nativeRequire = createRequire(entry)
    const loaded: string[] = []
    const module: { exports: unknown } = { exports: {} }
    const run = vm.compileFunction(
      bundleText('extension'),
      ['require', 'module', 'exports', '__dirname', '__filename'],
      { filename: entry },
    )
    Reflect.apply(run, undefined, [
      (file: string): unknown => {
        loaded.push(file)
        if (file === 'vscode') return {}
        return file === './validation.js' || file === './uiText.js'
          ? loadSupportBundle(path.basename(file, '.js'))
          : nativeRequire(file)
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

  it('keeps code intelligence answers and voice drivers in their own bundles', () => {
    const activation = inputs('extension')
    for (const file of ['src/core/codeIntel/codeIntelTools.ts', 'src/core/voice/dictation.ts']) {
      expect(activation).not.toContain(file)
    }
    expect(inputs('codeIntel')).toContain('src/core/codeIntel/codeIntelTools.ts')
    expect(inputs('voice')).toContain('src/core/voice/dictation.ts')
    // The tool list and the helper's location stay where they are read.
    expect(activation).toContain('src/core/codeIntel/definitions.ts')
    expect(activation).toContain('src/core/voice/helperLocation.ts')
  })

  it('keeps the Auto reviewer on Muse Code and M78’s reviewer core out of activation (M90)', () => {
    const activation = inputs('extension')
    for (const file of [
      'src/host/review/museCodeReviewer.ts',
      'src/host/review/reviewedApprovals.ts',
      'src/core/backends/modelapi/autoReviewer.ts',
    ]) {
      expect(activation).not.toContain(file)
      expect(inputs('museCodeReviewer')).toContain(file)
    }
    // The port that requires it on the first review stays where it is asked.
    expect(activation).toContain('src/host/review/museCodeReviewerBundle.ts')
  })

  it('keeps paid review execution out of the session first-turn bundle', () => {
    expect(inputs('modelApi')).not.toContain('src/core/backends/modelapi/reviewerEntry.ts')
    expect(inputs('reviewer')).toContain('src/core/backends/modelapi/reviewerEntry.ts')
  })

  it('rejects a missing deferred input and restores its metafile byte-exact', () => {
    const file = 'dist/meta/reviewer.json'
    const meta = structuredClone(fixture(file).meta)
    const original = JSON.stringify(meta)
    const hash = createHash('sha256').update(original).digest('hex')
    const output = meta.outputs['dist/reviewer.js']
    if (output === undefined) throw new Error('Missing reviewer output')
    const source = 'src/core/backends/modelapi/reviewerEntry.ts'
    const input = output.inputs[source]
    if (input === undefined) throw new Error('Missing reviewer input')
    const originalInputs = structuredClone(output.inputs)
    const check = () => {
      const changed = outputInputs(meta, 'dist/reviewer.js')
      return checkDeferredBundles((bundle) =>
        bundle.metafile === file ? changed : bundleInputs(bundle),
      )
    }
    expect(check()).toEqual([])
    try {
      Reflect.deleteProperty(output.inputs, source)
      expect(check()).toEqual([`dist/reviewer.js no longer carries ${source}`])
    } finally {
      output.inputs = originalInputs
    }
    expect(createHash('sha256').update(JSON.stringify(meta)).digest('hex')).toBe(hash)
    expect(check()).toEqual([])
  })

  it.each([
    ['extension', 'src/host/bestOfN/bestOfNManager.ts', 'on its first action'],
    ['modelApi', 'src/core/backends/modelapi/reviewerEntry.ts', 'on its first action'],
    // Split out of activation on 2026-10-03 (PLAN.md D6).
    ['extension', 'src/core/codeIntel/codeIntelQuery.ts', 'on the first code intelligence call'],
    ['extension', 'src/core/voice/museVoice.ts', 'on the first recording'],
    // M90: the Auto reviewer on Muse Code, required on the first review.
    ['extension', 'src/host/review/museCodeReviewer.ts', 'on the first review'],
  ])(
    'fires the %s split guard for %s and restores its metafile byte-exact',
    (name, source, use) => {
      const file = `dist/meta/${name}.json`
      const meta = structuredClone(fixture(file).meta)
      const original = JSON.stringify(meta)
      const hash = createHash('sha256').update(original).digest('hex')
      const output = meta.outputs[`dist/${name}.js`]
      if (output === undefined) throw new Error('Missing bundle output')
      const check = () => {
        const changed = outputInputs(meta, `dist/${name}.js`)
        return checkDeferredBundles((bundle) =>
          bundle.metafile === file ? changed : bundleInputs(bundle),
        )
      }
      expect(check()).toEqual([])
      expect(output.inputs).not.toHaveProperty(source)
      try {
        output.inputs[source] = { bytesInOutput: 1 }
        expect(check()).toContain(`dist/${name}.js carries ${source}, which loads only ${use}`)
      } finally {
        Reflect.deleteProperty(output.inputs, source)
      }
      expect(createHash('sha256').update(JSON.stringify(meta)).digest('hex')).toBe(hash)
      expect(check()).toEqual([])
    },
  )
})
