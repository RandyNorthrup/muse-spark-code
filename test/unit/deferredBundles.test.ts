import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
// Build the real shipped Node entries once with the production plugins.
// Each drill changes its own metafile copy, never shared dist/ files.
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { EN } from '../../src/shared/l10n/en'
import { L10N_COMPRESSION_QUALITY } from '../../src/shared/constants'
import {
  UI_TEXT_REGIONS,
  compressedEnglish,
  regionalUiText,
} from '../../scripts/lib/uiTextRegions.mjs'
import {
  checkDeferredBundles,
  deferredCohort,
  sharedUiText,
  sharedValidation,
  sharedWire,
} from '../../scripts/lib/deferredBundles.mjs'
import type * as validation from '../../src/shared/validationEntry'
import { removeFolder } from './helpers/temporaryFolders'

const metafileSchema = z.looseObject({
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(
    z.string(),
    z.looseObject({
      inputs: z.record(z.string(), z.object({ bytesInOutput: z.number() })),
      imports: z.array(
        z.looseObject({ path: z.string(), kind: z.string(), external: z.optional(z.boolean()) }),
      ),
    }),
  ),
})

const fixtures = new Map<string, { bytes: Buffer; meta: z.infer<typeof metafileSchema> }>()
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'muse-deferred-bundles-'))
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
      outdir: 'dist',
      entryPoints: {
        extension: 'src/extension.ts',
        conversation: 'src/host/conversation/conversationEntry.ts',
        modelApi: 'src/host/backend/modelApiEntry.ts',
        providers: 'src/host/backend/providersEntry.ts',
        modelsPanel: 'src/host/models/modelsPanelEntry.ts',
        usageService: 'src/runtime/usage/usageServiceEntry.ts',
        usageCompanion: 'src/runtime/usage/usageCompanionEntry.ts',
        usagePanel: 'src/host/usage/usagePanelEntry.ts',
        sessionBoard: 'src/host/sessionBoardEntry.ts',
        reviewer: 'src/core/backends/modelapi/reviewerEntry.ts',
        foreignHooks: 'src/core/backends/modelapi/foreignHooksEntry.ts',
        hookRuntime: 'src/core/backends/modelapi/hookRuntimeEntry.ts',
        pluginHooks: 'src/core/backends/modelapi/pluginHooksEntry.ts',
        tab: 'src/host/tab/tabEntry.ts',
        judge: 'src/host/judge/judgeEntry.ts',
        report: 'src/host/support/reportEntry.ts',
        recorder: 'src/host/support/recorderEntry.ts',
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
      plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
      external: ['vscode', '@napi-rs/keyring'],
    }),
    build({
      ...common,
      outdir: 'dist',
      target: 'node22',
      entryPoints: { acp: 'src/runtime/main.ts' },
      plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
      external: ['@napi-rs/keyring'],
    }),
    build({
      ...common,
      outdir: 'dist',
      entryPoints: { wire: 'src/shared/wireEntry.ts' },
      plugins: [sharedUiText, sharedValidation],
    }),
    build({
      ...common,
      outdir: 'dist',
      entryPoints: { validation: 'src/shared/validationEntry.ts' },
    }),
    ...[{ name: undefined, output: 'dist/uiText.js' }, ...UI_TEXT_REGIONS].map((region) =>
      build({
        ...common,
        entryPoints: ['src/shared/l10n/en.ts'],
        outfile: region.output,
        plugins: [
          regionalUiText(region.name),
          compressedEnglish(region.output, true, L10N_COMPRESSION_QUALITY),
        ],
      }),
    ),
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

afterAll(() => removeFolder(fixtureRoot))

function bundleFile(name: string) {
  return path.join(fixtureRoot, `${name}.js`)
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
    (file: string): unknown =>
      file.startsWith('./') && bundleTexts.has(path.basename(file, '.js'))
        ? loadSupportBundle(path.basename(file, '.js'))
        : createRequire(entry)(file),
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
  return Object.keys(
    fixture(`dist/${name === 'acp' ? 'meta-acp' : 'meta'}/${name}.json`).meta.inputs,
  ).map((file) => file.split(path.sep).join('/'))
}

describe('deferred cohort bundles', () => {
  it('decodes the complete production English fallback without changing any value', () => {
    expect(bundleText('uiText')).toContain('brotliDecompressSync')
    expect(loadSupportBundle('uiText')).toHaveProperty('EN', EN)
  })

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
    expect(bundleText('extension')).toContain('conversation.js')
    expect(bundleText('conversation')).toContain('./sessionBoard.js')
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
        return file.startsWith('./') && bundleTexts.has(path.basename(file, '.js'))
          ? loadSupportBundle(path.basename(file, '.js'))
          : nativeRequire(file)
      },
      module,
      module.exports,
      path.dirname(entry),
      entry,
    ])
    expect(module.exports).toHaveProperty('activate', expect.any(Function))
    expect(loaded).toContain('./wire.js')
    expect(loaded).not.toContain('./sessionBoard.js')
    expect(loaded).not.toContain('./reviewer.js')
    expect(loaded).not.toContain('./providers.js')
    expect(loaded).not.toContain('./modelsPanel.js')
    expect(loaded).not.toContain('./conversation.js')
  })

  it('keeps the conversation implementation behind its first-surface factory', () => {
    for (const file of [
      'src/host/conversation/conversationEntry.ts',
      'src/host/conversation/conversationController.ts',
      'src/host/conversation/sessionImport.ts',
      'src/core/export/transcriptMarkdown.ts',
    ]) {
      expect(inputs('extension')).not.toContain(file)
      expect(inputs('conversation')).toContain(file)
    }
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

  it('carries every captured codec only in the providers bundle', () => {
    for (const codec of ['anthropic', 'chat', 'gemini', 'ollama', 'responses']) {
      const source = `src/core/backends/modelapi/codecs/${codec}.ts`
      expect(inputs('providers')).toContain(source)
      for (const bundle of ['extension', 'modelApi', 'modelsPanel']) {
        expect(inputs(bundle)).not.toContain(source)
      }
    }
    expect(inputs('providers')).toContain('src/core/providers/providersFile.ts')
  })

  it('keeps paid review execution out of the session first-turn bundle', () => {
    expect(inputs('modelApi')).not.toContain('src/core/backends/modelapi/reviewerEntry.ts')
    expect(inputs('reviewer')).toContain('src/core/backends/modelapi/reviewerEntry.ts')
  })

  it('keeps the imported hooks’ adapters out of the session bundle (M91 lane W)', () => {
    expect(bundleText('modelApi')).toContain('./foreignHooks.js')
    for (const file of [
      'src/core/backends/modelapi/foreignHooksEntry.ts',
      'src/core/backends/modelapi/hookFormats/engine.ts',
      'src/core/backends/modelapi/hookFormats/contracts/cursor.ts',
    ]) {
      expect(inputs('modelApi')).not.toContain(file)
      expect(inputs('foreignHooks')).toContain(file)
    }
  })

  it('keeps the hook and MCP-form runtime out of the session bundle (M91)', () => {
    const session = bundleText('modelApi')
    expect(session).toContain('./hookRuntime.js')
    expect(inputs('modelApi')).not.toContain('src/core/backends/modelapi/hookRuntimeEntry.ts')
    for (const file of [
      'src/core/backends/modelapi/hookRuntimeEntry.ts',
      'src/core/backends/modelapi/extensionHooks.ts',
      'src/core/backends/modelapi/hookHandlers.ts',
      'src/core/backends/modelapi/mcp/elicitation.ts',
    ]) {
      expect(inputs('hookRuntime')).toContain(file)
    }
    // The runners themselves: their fixed diagnostics live only in the runtime.
    const runtime = bundleText('hookRuntime')
    for (const text of [
      'spark-hooks.json exceeds the session handler limit',
      'http hook runner is unavailable',
    ]) {
      expect(session).not.toContain(text)
      expect(runtime).toContain(text)
    }
  })

  it('keeps the shared recorder outside ACP until journal startup', () => {
    expect(bundleText('acp')).toContain('./recorder.js')
    expect(inputs('acp')).not.toContain('src/host/support/recorderEntry.ts')
    expect(inputs('acp')).not.toContain('src/host/support/reportJournal.ts')
  })

  it('rejects duplicated wire schemas in an activation input map', () => {
    const original = bundleInputs({
      output: 'dist/extension.js',
      metafile: 'dist/meta/extension.json',
    })
    const changed = new Map(original)
    changed.set('src/shared/protocol.ts', 1)
    expect(
      checkDeferredBundles((bundle) =>
        bundle.output === 'dist/extension.js' ? changed : bundleInputs(bundle),
      ),
    ).toContain('dist/extension.js duplicates shared wire schemas in src/shared/protocol.ts')
    expect(checkDeferredBundles(bundleInputs)).toEqual([])
  })

  it('keeps the plugin host out of the adapters’ bundle until a plugin hook runs (M91b)', () => {
    expect(bundleText('foreignHooks')).toContain('./pluginHooks.js')
    for (const file of [
      'src/core/backends/modelapi/pluginHooksEntry.ts',
      'src/core/backends/modelapi/pluginHost.ts',
      'src/core/backends/modelapi/pluginChild.ts',
      'src/core/backends/modelapi/pluginFormats.ts',
    ]) {
      for (const bundle of ['extension', 'modelApi', 'foreignHooks']) {
        expect(inputs(bundle)).not.toContain(file)
      }
      expect(inputs('pluginHooks')).toContain(file)
    }
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
    ['extension', 'src/core/usage/usageService.ts', 'on its first action'],
    ['modelApi', 'src/core/usage/journalStore.ts', 'on its first action'],
    ['acp', 'src/runtime/usage/usageCompanionEntry.ts', 'on its first action'],
    ['extension', 'src/host/usage/usagePanel.ts', 'on its first action'],
    ['extension', 'src/host/bestOfN/bestOfNManager.ts', 'on its first action'],
    ['modelsPanel', 'src/shared/protocol.ts', 'chat schemas'],
    ['modelApi', 'node_modules/zod/v4/mini/future.js', 'shared mini-parser'],
    ['webview', 'src/webview/components/UsageDialog.tsx', 'deferred webview chunk'],
    ['extension', 'src/host/conversation/conversationController.ts', 'on the first chat surface'],
    ['acp', 'src/host/support/recorderEntry.ts', 'from the recorder bundle'],
    ['acp', 'src/host/support/reportJournal.ts', 'from the recorder bundle'],
    // M91b: the plugin host, required by the adapters on the first plugin hook.
    ['foreignHooks', 'src/core/backends/modelapi/pluginHost.ts', 'on the first plugin hook'],
    ['modelApi', 'src/core/backends/modelapi/pluginChild.ts', 'on its first action'],
    ['modelApi', 'src/core/backends/modelapi/reviewerEntry.ts', 'on its first action'],
    // M91 lane W: the imported hooks' adapters, required on first use.
    ['modelApi', 'src/core/backends/modelapi/hookFormats/engine.ts', 'on its first action'],
    // M91: the hook and MCP-form runtime, required on first use.
    ['modelApi', 'src/core/backends/modelapi/hookRuntimeEntry.ts', 'on its first action'],
    // Split out of activation on 2026-10-03 (PLAN.md D6).
    ['extension', 'src/core/codeIntel/codeIntelQuery.ts', 'on the first code intelligence call'],
    ['extension', 'src/core/voice/museVoice.ts', 'on the first recording'],
    // M95: membership injection must fail in every parent bundle.
    ['extension', 'src/core/backends/modelapi/codecs/anthropic.ts', 'in dist/providers.js'],
    ['modelApi', 'src/core/backends/modelapi/codecs/anthropic.ts', 'in dist/providers.js'],
    ['acp', 'src/core/backends/modelapi/codecs/anthropic.ts', 'in dist/providers.js'],
    ['pageWorker', 'src/core/backends/modelapi/codecs/future.ts', 'in dist/providers.js'],
    ['extension', 'src/core/backends/modelapi/codecs/gemini.ts', 'in dist/providers.js'],
    ['modelApi', 'src/core/backends/modelapi/codecs/responses.ts', 'in dist/providers.js'],
    ['modelsPanel', 'src/core/providers/providersFile.ts', 'in dist/providers.js'],
    ['providers', 'src/core/backends/modelapi/codecs/anthropic.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/gemini.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/responses.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/chat.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/ollama.ts', 'missing'],
    // M90: the Auto reviewer on Muse Code, required on the first review.
    ['extension', 'src/host/review/museCodeReviewer.ts', 'on the first review'],
  ])(
    'fires the %s split guard for %s and restores its metafile byte-exact',
    (name, source, use) => {
      const file = `dist/${name === 'acp' ? 'meta-acp' : 'meta'}/${name}.json`
      const original = readFileSync(file)
      const hash = createHash('sha256').update(original).digest('hex')
      const meta = metafileSchema.parse(JSON.parse(original.toString('utf8')))
      const output = meta.outputs[name === 'webview' ? 'dist/webview/main.js' : `dist/${name}.js`]
      if (output === undefined) throw new Error('Missing bundle output')
      if (name === 'providers') expect(output.inputs).toHaveProperty(source)
      else expect(output.inputs).not.toHaveProperty(source)
      try {
        if (name === 'providers') Reflect.deleteProperty(output.inputs, source)
        else output.inputs[source] = { bytesInOutput: 1 }
        writeFileSync(file, JSON.stringify(meta))
        const red = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
          encoding: 'utf8',
        })
        expect(red.status).toBe(1)
        let message = `dist/${name}.js carries ${source}, which loads only ${use}`
        if (name === 'webview') {
          message = `${source} must occur in exactly one deferred webview chunk`
        } else if (use === 'chat schemas') {
          message = 'dist/modelsPanel.js carries unrelated chat schemas'
        } else if (use === 'shared mini-parser') {
          message = 'dist/modelApi.js inlines the shared mini-parser'
        } else if (name === 'providers') {
          message = `dist/providers.js no longer carries ${source}`
        }
        expect(red.stderr).toContain(message)
      } finally {
        writeFileSync(file, original)
      }
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash)
    },
  )
})
