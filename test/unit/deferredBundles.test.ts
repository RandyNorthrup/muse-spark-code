// Build the real shipped Node entries once with the production plugins.
// Each drill changes its own metafile copy, never shared dist/ files.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
  nodeReferenceData,
  sharedWire,
  sharedModelApiBoundaries,
} from '../../scripts/lib/deferredBundles.mjs'
import type * as validation from '../../src/shared/validationEntry'
import { deferredTeamView } from '../../scripts/lib/deferredTeamView.mjs'
import { removeFolder } from './helpers/temporaryFolders'
import { legalReportEnvelopeSchema } from '../../src/runtime/legal/runLegal'

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

function expectUnchangedMeta(
  meta: z.infer<typeof metafileSchema>,
  hash: string,
  check: () => readonly string[],
): void {
  expect(createHash('sha256').update(JSON.stringify(meta)).digest('hex')).toBe(hash)
  expect(check()).toEqual([])
}

const fixtures = new Map<string, { bytes: Buffer; meta: z.infer<typeof metafileSchema> }>()
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'muse-deferred-bundles-'))
const bundleTexts = new Map<string, string>()
const inputMaps = new Map<string, ReadonlyMap<string, number>>()
const supportModules = new Map<string, unknown>()
const gatePrograms = new Map<string, string>()
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
    ...Object.entries({
      schedules: 'src/runtime/schedules/schedulesBundle.ts',
      scheduleBackground: 'src/runtime/schedules/backgroundEntry.ts',
      questionNotes: 'src/core/questions/deferralEntry.ts',
      reference: 'src/shared/reference/referenceEntry.ts',
      runtimeEngine: 'src/runtime/runtimeEngineEntry.ts',
      providerPolicy: 'src/host/backend/providerPolicyEntry.ts',
      modelApiHooks: 'src/core/backends/modelapi/modelApiHooksEntry.ts',
      modelApiMcp: 'src/core/backends/modelapi/modelApiMcpEntry.ts',
      runtimeAccounting: 'src/runtime/runtimeAccountingEntry.ts',
      legalScan: 'src/core/legal/entry.ts',
      imageResizeWorker: 'src/core/imageResizeWorker.ts',
      reporting: 'src/runtime/reporting/reportsEntry.ts',
      reportingNetwork: 'src/runtime/reporting/network.ts',
      reportingDestinations: 'src/runtime/reporting/destinationsEntry.ts',
      reportingPanel: 'src/host/reporting/reportPanelEntry.ts',
      extension: 'src/extension.ts',
      conversation: 'src/host/conversation/conversationEntry.ts',
      modelApi: 'src/host/backend/modelApiEntry.ts',
      providers: 'src/host/backend/providersEntry.ts',
      subscriptions: 'src/host/backend/subscriptionsEntry.ts',
      configuredProviders: 'src/host/backend/configuredProvidersEntry.ts',
      usageService: 'src/runtime/usage/usageServiceEntry.ts',
      usageCompanion: 'src/runtime/usage/usageCompanionEntry.ts',
      usagePanel: 'src/host/usage/usagePanelEntry.ts',
      headless: 'src/runtime/exec/runExec.ts',
      modelsPanel: 'src/host/models/modelsPanelEntry.ts',
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
    }).map(([name, entry]) =>
      build({
        ...common,
        outfile: `dist/${name}.js`,
        entryPoints: [entry],
        plugins: [
          sharedUiText,
          sharedValidation,
          deferredCohort,
          sharedWire,
          deferredTeamView,
          sharedModelApiBoundaries,
          nodeReferenceData,
        ],
        external: ['vscode', '@napi-rs/keyring'],
      }),
    ),
    build({
      ...common,
      outdir: 'dist',
      target: 'node22',
      entryPoints: {
        acp: 'src/runtime/main.ts',
        acpQuestions: 'src/acp/questionDeferralEntry.ts',
        runtimeQuestions: 'src/runtime/questions/questionRegistryEntry.ts',
      },
      plugins: [
        sharedUiText,
        sharedValidation,
        deferredCohort,
        sharedWire,
        deferredTeamView,
        sharedModelApiBoundaries,
        nodeReferenceData,
      ],
      external: ['@napi-rs/keyring'],
    }),
    build({
      ...common,
      outdir: 'dist',
      entryPoints: { wire: 'src/shared/wireEntry.ts' },
      plugins: [sharedUiText, sharedValidation, deferredTeamView, sharedModelApiBoundaries],
    }),
    build({
      ...common,
      outdir: 'dist',
      entryPoints: {
        team: 'src/core/team/teamEntry.ts',
        teamScheduler: 'src/core/team/teamSchedulerEntry.ts',
        teamRunners: 'src/host/runners/teamRunnersEntry.ts',
      },
      plugins: [
        sharedUiText,
        sharedValidation,
        deferredCohort,
        sharedWire,
        sharedModelApiBoundaries,
      ],
      external: ['vscode', '@napi-rs/keyring'],
    }),
    build({
      ...common,
      outdir: 'dist',
      entryPoints: { modelApiBoundaries: 'src/shared/modelApiBoundariesEntry.ts' },
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
      fixtures.set(
        `dist/${['acp', 'headless', 'acpQuestions', 'runtimeQuestions'].includes(name) ? 'meta-acp' : 'meta'}/${name}.json`,
        {
          bytes: Buffer.from(JSON.stringify(meta)),
          meta,
        },
      )
    }
  }
  parsers.push(parserSchema.parse(loadSupportBundle('validation')))
})

beforeAll(async () => {
  mkdirSync(path.join(fixtureRoot, 'dist'), { recursive: true })
  for (const [name, text] of bundleTexts) writeFileSync(bundleFile(name), text)
  writeFileSync(path.join(fixtureRoot, 'package.json'), readFileSync('package.json'))
  await Promise.all(
    ['check-bundle-size', 'check-host-globals'].map(async (name) => {
      const built = await build({
        entryPoints: [`scripts/${name}.mjs`],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      })
      const output = built.outputFiles[0]
      if (output === undefined) throw new Error(`Missing gate program: ${name}`)
      gatePrograms.set(name, output.text)
    }),
  )
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
  return path.join(fixtureRoot, 'dist', `${name}.js`)
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
    (file: string): unknown => {
      if (file.startsWith('./') && bundleTexts.has(path.basename(file, '.js')))
        return loadSupportBundle(path.basename(file, '.js'))
      return file === 'vscode' ? {} : createRequire(entry)(file)
    },
    module,
    module.exports,
    path.dirname(entry),
    entry,
  ])
  supportModules.set(name, module.exports)
  return module.exports
}

// Run the unchanged CLI gates against the private real scanner. Other Node
// entries use the production builds above; unrelated browser outputs are fakes
// (their closure budgets have a dedicated bundleSize suite).
function runLegalGate(name: string) {
  const program = gatePrograms.get(name)
  if (program === undefined) throw new Error(`Missing gate program: ${name}`)
  const scanner = readFileSync(bundleFile('legalScan'), 'utf8')
  const textOf = (file: string) =>
    file.replaceAll('\\', '/') === 'dist/legalScan.js'
      ? scanner
      : (bundleTexts.get(path.basename(file.replaceAll('\\', '/'), '.js')) ?? '')
  const meta = {
    outputs: {
      ...Object.fromEntries(
        ['main', 'models', 'usage', 'whatsNew'].map((page) => [
          `dist/webview/${page}.js`,
          { imports: [] },
        ]),
      ),
      'dist/webview/models-body.js': {
        imports: [],
        entryPoint: 'src/webview/models/panel.tsx',
      },
      'dist/webview/usage-body.js': {
        imports: [],
        entryPoint: 'src/webview/usage/UsageApp.tsx',
      },
    },
  }
  let status = 0
  const stdout: string[] = []
  const stderr: string[] = []
  vm.runInNewContext(program, {
    require: (file: string): unknown => {
      if (file !== 'node:fs') throw new Error(`Unexpected gate dependency: ${file}`)
      return {
        existsSync: () => true,
        readFileSync: (file: string) =>
          file.endsWith('.json') ? JSON.stringify(meta) : textOf(file),
        statSync: (file: string) => ({ size: Buffer.byteLength(textOf(file)) }),
      }
    },
    process: {
      exit: (code: number) => {
        status = code
      },
    },
    console: {
      log: (line: string) => {
        stdout.push(line)
      },
      error: (line: string) => {
        stderr.push(line)
      },
    },
  })
  return { status, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
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
    fixture(
      `dist/${['acp', 'acpQuestions', 'runtimeQuestions'].includes(name) ? 'meta-acp' : 'meta'}/${name}.json`,
    ).meta.inputs,
  ).map((file) => file.split(path.sep).join('/'))
}

describe('deferred cohort bundles', () => {
  it('keeps M112 registry and deferral helpers lazy and rejects inline copies', () => {
    for (const [source, destination] of [
      ['src/runtime/questions/acpRegistry.ts', 'runtimeQuestions'],
      ['src/core/questions/deferralEntry.ts', 'questionNotes'],
    ]) {
      if (source === undefined || destination === undefined)
        throw new Error('Missing question split fixture')
      expect(inputs(destination)).toContain(source)
      for (const parent of ['extension', 'modelApi', 'acp'])
        expect(inputs(parent)).not.toContain(source)
      const problems = checkDeferredBundles((bundle) =>
        bundle.output === 'dist/acp.js'
          ? new Map([...bundleInputs(bundle), [source, 1]])
          : bundleInputs(bundle),
      )
      expect(problems.some((problem) => problem.includes(`dist/acp.js carries ${source}`))).toBe(
        true,
      )
    }
  })
  it('every production bundle passes the deferred-boundary gate', () => {
    expect(checkDeferredBundles(bundleInputs)).toEqual([])
  })

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

  it('installs the caller language in the compiled subscription command factory', async () => {
    const loaded = loadSupportBundle('modelsPanel')
    if (
      typeof loaded !== 'object' ||
      loaded === null ||
      !('createSubscriptionFeatures' in loaded) ||
      typeof loaded.createSubscriptionFeatures !== 'function'
    )
      throw new Error('Missing subscription factory')
    const fetcher = vi.fn(() => Promise.reject(new Error('No provider calls')))
    const options = {
      l10n: {
        locale: 'fr',
        table: {
          ...EN,
          planUi: { ...EN.planUi, copilotUnavailable: 'synthetic French model recovery' },
        },
      },
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), trace: vi.fn() },
      secrets: {
        get: () => Promise.resolve(undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      globalStorageUri: { fsPath: path.resolve('temp') },
      configFile: 'synthetic-unused.json',
      globalState: { get: () => undefined, update: () => Promise.resolve() },
      isRemote: false,
      isConfidential: () => false,
      access: { canSendRequest: () => false, onDidChange: () => ({ dispose: vi.fn() }) },
      fetch: fetcher,
      connected: () => Promise.resolve(),
      disconnected: () => Promise.resolve(),
    }
    try {
      const features: unknown = Reflect.apply(loaded.createSubscriptionFeatures, undefined, [
        options,
      ])
      if (
        typeof features !== 'object' ||
        features === null ||
        !('connectCopilot' in features) ||
        typeof features.connectCopilot !== 'function'
      )
        throw new Error('Missing subscription action')
      await expect(Reflect.apply(features.connectCopilot, undefined, [])).rejects.toThrow(
        options.l10n.table.planUi.copilotUnavailable,
      )
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      Reflect.apply(loaded.createSubscriptionFeatures, undefined, [
        { ...options, l10n: { table: EN, locale: 'en' } },
      ])
    }
  })
  it('installs the caller language before translated ChatGPT failures leave the lazy bundle', () => {
    const loaded = loadSupportBundle('subscriptions')
    if (
      typeof loaded !== 'object' ||
      loaded === null ||
      !('runtimeChatGptCommandDeps' in loaded) ||
      typeof loaded.runtimeChatGptCommandDeps !== 'function' ||
      !('setUiText' in loaded) ||
      typeof loaded.setUiText !== 'function'
    )
      throw new Error('Missing provider factory')
    const table = {
      ...EN,
      acpChatGpt: { ...EN.acpChatGpt, storeUnavailable: 'synthetic French desktop recovery' },
    }
    try {
      const deps: unknown = Reflect.apply(loaded.runtimeChatGptCommandDeps, undefined, [
        {
          uiText: table,
          locale: 'fr',
          configFile: 'synthetic-unused.json',
          secrets: {
            get: () => Promise.resolve(undefined),
            store: () => Promise.resolve(),
            delete: () => Promise.resolve(),
          },
          fetch,
          openBrowser: () => Promise.resolve(),
          callbackText: () => '',
          print: vi.fn(),
          printError: vi.fn(),
        },
      ])
      if (
        typeof deps !== 'object' ||
        deps === null ||
        !('text' in deps) ||
        typeof deps.text !== 'object' ||
        deps.text === null ||
        !('failure' in deps.text) ||
        typeof deps.text.failure !== 'function'
      )
        throw new Error('Missing translated command text')
      const message: unknown = Reflect.apply(deps.text.failure, undefined, ['store-unavailable'])
      expect(message).toBe(table.acpChatGpt.storeUnavailable)
    } finally {
      Reflect.apply(loaded.setUiText, undefined, [EN, 'en'])
    }
  })
  it('keeps ChatGPT runtime and core in subscriptions.js behind the real ACP dynamic import', () => {
    const acpInputs = inputs('acp')
    expect(bundleText('acp')).toContain('./subscriptions.js')
    for (const file of [
      'src/runtime/chatGptProviderCommands.ts',
      'src/runtime/chatGptHost.ts',
      'src/core/providers/subscriptions/chatgpt.ts',
    ]) {
      expect(inputs('subscriptions')).toContain(file)
      expect(acpInputs).not.toContain(file)
    }
    const bundle = loadSupportBundle('subscriptions')
    expect(bundle).toHaveProperty('runtimeChatGptCommandDeps', expect.any(Function))
    expect(bundle).toHaveProperty('runChatGptProviderCommand', expect.any(Function))
    expect(bundle).toHaveProperty('chatGptAuthenticationMethods', expect.any(Function))
  })
  it('RVM115U5 diet: Model API frees ten KiB and records context loaders in the lazy schedules chunk', () => {
    // M115W re-measurement (Kubuntu, deterministic across trees): the merged
    // milestone carries 1,161 more bytes than U's pin (the validated v2
    // protocol, schedules settings and their strings). The diet's mechanism
    // below is unchanged: the loaders stay out of Model API.
    expect(Buffer.byteLength(bundleText('modelApi'))).toBeLessThanOrEqual(474_100)
    const schedules = new Set(inputs('schedules'))
    for (const file of [
      'src/core/backends/modelapi/schedulesEntry.ts',
      'src/core/backends/modelapi/schedules.ts',
      'src/core/context/catalogFiles.ts',
    ]) {
      expect(schedules.has(file)).toBe(true)
      expect(inputs('modelApi')).not.toContain(file)
    }
    expect(bundleText('modelApi')).toContain('./schedules.js')
  })

  it('M115W: the lazy schedules chunk carries the v2 runtime binding beside v1', () => {
    const schedules = new Set(inputs('schedules'))
    for (const file of [
      'src/runtime/schedules/schedulesBundle.ts',
      'src/runtime/schedules/runtimeEntry.ts',
      'src/runtime/schedules/engine.ts',
      'src/runtime/schedules/control.ts',
      'src/core/schedules/store.ts',
      'src/core/schedules/scheduler.ts',
      'src/core/schedules/delivery.ts',
    ]) {
      expect(schedules.has(file)).toBe(true)
      for (const parent of ['extension', 'modelApi', 'acp'])
        expect(inputs(parent)).not.toContain(file)
    }
    expect(bundleText('schedules')).toContain('createRuntimeSchedules')
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

  it('emits the legal scanner once and keeps it out of both initial bundles', () => {
    expect(inputs('legalScan')).toContain('src/core/legal/entry.ts')
    expect(inputs('extension')).not.toContain('src/core/legal/entry.ts')
    const acp: unknown = fixture('dist/meta-acp/acp.json').meta
    expect(metafileSchema.parse(acp).outputs['dist/acp.js']?.inputs).not.toHaveProperty(
      'src/core/legal/entry.ts',
    )
  })
  it('runs the production headless scanner with pure JSON and no network, backend or keyring', () => {
    const entry = bundleFile('acp')
    const wrapper = `
      const entry = process.argv[1];
      const denied = (surface) => { process.stderr.write('unexpected ' + surface); throw new Error(surface); };
      globalThis.fetch = () => denied('network');
      require('node:child_process').spawn = () => denied('backend');
      const Module = require('node:module');
      const original = Module._load;
      Module._load = function(request, ...rest) {
        if (request === '@napi-rs/keyring') return denied('keyring');
        return Reflect.apply(original, this, [request, ...rest]);
      };
      process.argv = [process.execPath, entry, 'legal', '--format', 'json'];
      require(entry);
    `
    const result = spawnSync(process.execPath, ['-e', wrapper, entry], {
      cwd: path.resolve('test/fixtures/legal/tree'),
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(result.error).toBeUndefined()
    expect([0, 1, 2]).toContain(result.status)
    // Locale diagnostics belong on stderr; any forbidden surface emits our sentinel.
    expect(result.stderr).not.toContain('unexpected')
    const body: unknown = JSON.parse(result.stdout)
    const report = legalReportEnvelopeSchema.parse(body)
    expect(report.result.ruleVersion).not.toBe('unavailable')
    expect(report.registry).toMatchObject({ enabled: false, queried: [] })
    expect(report.disclaimer.length).toBeGreaterThan(0)
  })

  it('fires the legal scanner cap and restores the artifact byte-exact', () => {
    const file = bundleFile('legalScan')
    const original = readFileSync(file)
    const hash = createHash('sha256').update(original).digest('hex')
    try {
      writeFileSync(file, Buffer.alloc(150 * 1024 + 1))
      const red = runLegalGate('check-bundle-size')
      expect(red.status).toBe(1)
      expect(red.stdout).toContain('OVER dist/legalScan.js')
    } finally {
      writeFileSync(file, original)
    }
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash)
    const green = runLegalGate('check-bundle-size')
    expect(green.status, green.stderr).toBe(0)
  })

  it('fires the legal scanner host-global guard and restores the artifact byte-exact', () => {
    const file = bundleFile('legalScan')
    const original = readFileSync(file)
    const hash = createHash('sha256').update(original).digest('hex')
    try {
      writeFileSync(file, Buffer.concat([original, Buffer.from('\nvoid navigator;\n')]))
      const red = runLegalGate('check-host-globals')
      expect(red.status).toBe(1)
      expect(red.stdout).toContain('FAIL dist/legalScan.js')
    } finally {
      writeFileSync(file, original)
    }
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash)
    const green = runLegalGate('check-host-globals')
    expect(green.status, green.stderr).toBe(0)
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

  it('shares the captured Model API validators and pure team admission across Node consumers', () => {
    for (const source of [
      'src/core/backends/modelapi/schemas.ts',
      'src/shared/teamConversation.ts',
      'src/shared/paidBoundary.ts',
      'src/shared/legal.ts',
      'src/core/backends/modelapi/legalScanTool.ts',
    ]) {
      expect(inputs('modelApiBoundaries')).toContain(source)
      for (const parent of ['extension', 'modelApi', 'acp', 'providers']) {
        expect(inputs(parent)).not.toContain(source)
      }
    }
    expect(bundleText('modelApi')).toContain('./modelApiBoundaries.js')
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
    expectUnchangedMeta(meta, hash, check)
  })

  it.each([
    ['providerPolicy', 'src/host/backend/providerPolicyEntry.ts', 'missing'],
    ['providerPolicy', 'src/core/backends/modelapi/codecs/chat.ts', 'in dist/providers.js'],
    ['modelApiHooks', 'src/core/backends/modelapi/hookHandlers.ts', 'missing'],
    ['modelApiMcp', 'src/core/backends/modelapi/mcp/pool.ts', 'missing'],
    ['runtimeAccounting', 'src/runtime/runtimeAccountingEntry.ts', 'missing'],
    ['modelApi', 'src/core/backends/modelapi/hookHandlers.ts', 'on its first action'],
    ['modelApi', 'src/core/backends/modelapi/mcp/pool.ts', 'on its first action'],
    ['acp', 'src/runtime/runtimeAccountingEntry.ts', 'on its first action'],
    ['reviewer', 'src/core/backends/modelapi/reviewerEntry.ts', 'missing'],
    [
      'acp',
      'src/acp/questionDeferral.ts',
      'on the first ACP question, elicitation or question command',
    ],
    [
      'modelApi',
      'src/acp/questionDeferralEntry.ts',
      'on the first ACP question, elicitation or question command',
    ],
    [
      'modelApi',
      'src/runtime/schedules/nodeBackgroundIo.ts',
      'on the first native schedule wake or maintenance',
    ],
    [
      'modelApi',
      'src/runtime/schedules/effectiveDefinition.ts',
      'on the first native schedule wake or maintenance',
    ],
    ['extension', 'src/host/bestOfN/bestOfNManager.ts', 'on its first action'],
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
    ['extension', 'src/core/legal/entry.ts', 'on the first legal scan'],
    ['subscriptions', 'src/core/providers/subscriptions/chatgpt.ts', 'missing'],
    ['subscriptions', 'src/core/providers/subscriptions/registry.ts', 'missing'],
    ['configuredProviders', 'src/core/providers/configured.ts', 'missing'],
    ['configuredProviders', 'src/core/backends/modelapi/authSource.ts', 'missing'],
    ['configuredProviders', 'src/core/backends/modelapi/providerClient.ts', 'missing'],
    ['usageService', 'src/runtime/usage/usageAcp.ts', 'missing'],
    ['acp', 'src/runtime/usage/usageAcp.ts', 'on its first action'],
    ['headless', 'src/runtime/exec/runExec.ts', 'missing'],
    ['acp', 'src/runtime/exec/runExec.ts', 'on its first action'],
    ['modelApi', 'src/core/backends/modelapi/ndjson.ts', 'missing'],
    ['modelApi', 'src/core/backends/modelapi/transport.ts', 'missing'],
    ['modelApi', 'src/core/backends/modelapi/sse.ts', 'missing'],
    ['extension', 'src/core/backends/modelapi/transport.ts', 'in dist/modelApi.js'],
    ['acp', 'src/core/backends/modelapi/authSource.ts', 'in dist/configuredProviders.js'],
    ['providers', 'src/core/backends/modelapi/sse.ts', 'in dist/modelApi.js'],
    // M90: the Auto reviewer on Muse Code, required on the first review.
    ['extension', 'src/host/review/museCodeReviewer.ts', 'on the first review'],
  ])(
    'fires the %s split guard for %s and restores its metafile byte-exact',
    (name, source, use) => {
      const file = `dist/${['acp', 'headless'].includes(name) ? 'meta-acp' : 'meta'}/${name}.json`
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
      const originalInputs = structuredClone(output.inputs)
      if (use === 'missing') expect(output.inputs).toHaveProperty(source)
      else expect(output.inputs).not.toHaveProperty(source)
      try {
        if (use === 'missing') Reflect.deleteProperty(output.inputs, source)
        else output.inputs[source] = { bytesInOutput: 1 }
        expect(check()).toContain(
          use === 'missing'
            ? `dist/${name}.js no longer carries ${source}`
            : `dist/${name}.js carries ${source}, which loads only ${use}`,
        )
      } finally {
        output.inputs = originalInputs
      }
      expectUnchangedMeta(meta, hash, check)
    },
  )
  it.each(['reporting', 'reportingNetwork', 'reportingDestinations', 'reportingPanel'])(
    'refuses backend imports from %s with either path separator',
    (name) => {
      const file = `dist/meta/${name}.json`
      const meta = structuredClone(fixture(file).meta)
      const output = meta.outputs[`dist/${name}.js`]
      if (output === undefined) throw new Error('Missing output')
      const hash = createHash('sha256').update(JSON.stringify(meta)).digest('hex')
      for (const separator of ['/', '\\']) {
        const source = 'src/core/backends/modelapi/backend.ts'.replaceAll('/', () => separator)
        try {
          output.inputs[source] = { bytesInOutput: 1 }
          expect(
            checkDeferredBundles((bundle) =>
              bundle.metafile === file
                ? outputInputs(meta, `dist/${name}.js`)
                : bundleInputs(bundle),
            ),
          ).toContain(`dist/${name}.js carries a backend: src/core/backends/modelapi/backend.ts`)
        } finally {
          Reflect.deleteProperty(output.inputs, source)
        }
      }
      expect(createHash('sha256').update(JSON.stringify(meta)).digest('hex')).toBe(hash)
    },
  )
  it.each(['reporting', 'reportingNetwork', 'reportingDestinations', 'reportingPanel'])(
    'refuses paid-gate imports from %s with either path separator (D93)',
    (name) => {
      const file = `dist/meta/${name}.json`
      const meta = structuredClone(fixture(file).meta)
      const output = meta.outputs[`dist/${name}.js`]
      if (output === undefined) throw new Error('Missing output')
      const hash = createHash('sha256').update(JSON.stringify(meta)).digest('hex')
      for (const separator of ['/', '\\']) {
        const source = 'src/core/paid/paidFeatures.ts'.replaceAll('/', () => separator)
        try {
          output.inputs[source] = { bytesInOutput: 1 }
          expect(
            checkDeferredBundles((bundle) =>
              bundle.metafile === file
                ? outputInputs(meta, `dist/${name}.js`)
                : bundleInputs(bundle),
            ),
          ).toContain(`dist/${name}.js carries the paid gate: src/core/paid/paidFeatures.ts`)
        } finally {
          Reflect.deleteProperty(output.inputs, source)
        }
      }
      expect(createHash('sha256').update(JSON.stringify(meta)).digest('hex')).toBe(hash)
    },
  )
})

it('refuses a raster codec leaked into the lazy Model API parent', () => {
  const maps = new Map(inputMaps)
  const inputs = new Map(maps.get('dist/modelApi.js'))
  inputs.set('node_modules/jpeg-js/lib/decoder.js', 1)
  maps.set('dist/modelApi.js', inputs)
  expect(checkDeferredBundles((bundle) => maps.get(bundle.output) ?? new Map())).toContain(
    'dist/modelApi.js carries node_modules/jpeg-js/, which runs only on the image resize worker',
  )
})
