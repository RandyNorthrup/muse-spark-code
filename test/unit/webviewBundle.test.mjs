import { spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { runInThisContext } from 'node:vm'
import { build, context as buildContext, transform } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { lazyBrowserKeybindings } from '../../scripts/lib/browserKeybindings.mjs'
import { sharedHighlightGrammar } from '../../scripts/lib/highlightGrammar.mjs'
import { resourceBrowserValidation } from '../../scripts/lib/webviewBundles.mjs'
import { BUNDLES, checkResourceBundles } from '../../scripts/lib/deferredBundles.mjs'
import { createRequire } from 'node:module'
import { listFiles } from '@vscode/vsce/out/package.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  webviewDeferredBudgetGroups,
  portableWebviewBudgetGroups,
} from '../../scripts/lib/webviewBundles.mjs'
import { measurePortableStartup } from '../../scripts/lib/portableStartup.mjs'
import { buildProductionPackage } from './helpers/productionPackage'

const ENTRY = 'dist/webview/main.js'
const SIZE_GATE = path.resolve('scripts/check-bundle-size.mjs')
const built = {
  outputs: {},
  fixture: '',
  production: '',
  startup: [],
  memoryStartup: [],
  graphs: new Map(),
  failures: new Map(),
  browser: undefined,
  contexts: { active: 0, peak: 0 },
  sizeGate: '',
  splitGate: '',
  splitSections: undefined,
  shippedBundles: [],
}
const outputFile = (file) => path.join(built.production, file)
const NON_BUILT_REQUESTS = ['native', 'companion', 'worker'].flatMap((variant) =>
  ['http://127.0.0.1/not-built', 'https://unbuilt.invalid/boot.js'].map((url) => [variant, url]),
)
const UNROUTABLE_TARGETS = [
  ['shared_worker', `new SharedWorker('/assets/portable/main.js');`],
  ['service_worker', `await navigator.serviceWorker.register('/assets/portable/main.js');`],
]

beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  built.production = mkdtempSync(path.resolve('temp/fix78w-production-'))
  mkdirSync(outputFile('dist/webview/chunks'), { recursive: true })
  writeFileSync(
    outputFile('dist/webview/chunks/stale.js'),
    'throw new Error("stale browser chunk")',
  )
  // Own the complete production graph: Node and policy checks must work in a
  // cold checkout, and deliberate metafile mutations must not race other suites.
  buildProductionPackage(process.cwd(), built.production)
  // The owned build shares the read-only dependency install through a junction.
  // esbuild records those inputs relative to its real location. Canonicalize
  // that fixture prefix while retaining every source and byte contribution.
  for (const folder of ['dist/meta', 'dist/meta-acp']) {
    const files = readdirSync(outputFile(folder))
    for (const name of files) {
      const file = outputFile(`${folder}/${name}`)
      const meta = readFileSync(file, 'utf8')
        .replaceAll('\\\\', '/')
        .replaceAll(/(?:\.\.\/)+(?=node_modules\/)/gu, '')
      writeFileSync(file, meta)
    }
  }
  const outputs = JSON.parse(readFileSync(outputFile('dist/meta/webview.json'), 'utf8')).outputs
  built.outputs = Object.fromEntries(
    Object.entries(outputs).map(([file, output]) => [
      file.replaceAll('\\', '/'),
      {
        ...output,
        entryPoint: output.entryPoint?.replaceAll('\\', '/'),
        inputs: Object.fromEntries(
          Object.entries(output.inputs).map(([source, details]) => [
            source.replaceAll('\\', '/'),
            details,
          ]),
        ),
        imports: output.imports.map((entry) => ({
          ...entry,
          path: entry.path.replaceAll('\\', '/'),
        })),
      },
    ]),
  )
  mkdirSync('temp', { recursive: true })
  built.fixture = mkdtempSync(path.resolve('temp/fix78w-size-'))
  mkdirSync(path.join(built.fixture, 'dist/meta'), { recursive: true })
  mkdirSync(path.join(built.fixture, 'dist/webview'), { recursive: true })
  for (const match of readFileSync(SIZE_GATE, 'utf8').matchAll(/path: '(dist\/[^']+\.js)'/g)) {
    const file = path.join(built.fixture, match[1])
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '')
  }
  writeFileSync(path.join(built.fixture, 'dist/whatsNew.json'), '{}')
  writeFileSync(path.join(built.fixture, 'dist/webview/whatsNew.js'), '')
  // Exercise the real allowlist over all real emitted browser files in an
  // owned tree, without traversing other tests’ concurrently growing temp trees.
  cpSync(outputFile('dist/webview'), path.join(built.fixture, 'dist/webview'), { recursive: true })
  cpSync(outputFile('dist/meta/portable.json'), path.join(built.fixture, 'dist/meta/portable.json'))
  mkdirSync(path.join(built.fixture, 'docs/schemas'), { recursive: true })
  cpSync(
    'docs/schemas/exec-event-v2.schema.json',
    path.join(built.fixture, 'docs/schemas/exec-event-v2.schema.json'),
  )
  for (const page of ['modelsWebview', 'whatsNewPage', 'usageWebview']) {
    cpSync(outputFile(`dist/meta/${page}.json`), path.join(built.fixture, `dist/meta/${page}.json`))
  }
  cpSync('.vscodeignore', path.join(built.fixture, '.vscodeignore'))
  cpSync('package.json', path.join(built.fixture, 'package.json'))
  built.browser = await chromium.launch({
    executablePath: findChrome(),
    channel: 'chrome',
    headless: true,
  })
  // Real contexts compete for the same browser and five-second boot deadline.
  // Observe the fixture's concurrency rather than relying on machine speed.
  const newContext = built.browser.newContext.bind(built.browser)
  built.browser.newContext = async (options) => {
    const context = await newContext(options)
    built.contexts.active += 1
    built.contexts.peak = Math.max(built.contexts.peak, built.contexts.active)
    context.on('close', () => {
      built.contexts.active -= 1
    })
    return context
  }
  const portableMeta = JSON.parse(readFileSync(outputFile('dist/meta/portable.json'), 'utf8'))
  built.startup = await measurePortableStartup(
    portableMeta,
    (file) => readFileSync(outputFile(file)),
    built.browser,
  )
  // Padding and unrelated Node/legacy-budget drills do not change boot imports.
  // Reuse the freshly observed resource lists through a fake measurement port;
  // the in-memory scenario tests below exercise the real browser port separately.
  const gateTasks = ['size', 'split'].map((gate) => async () => {
    const target = outputFile(`temp/check-bundle-${gate}.mjs`)
    await build({
      entryPoints: [`scripts/check-bundle-${gate}.mjs`],
      outfile: target,
      bundle: true,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      logLevel: 'silent',
      plugins: [
        {
          name: 'observed-boot-fixture',
          setup(build) {
            build.onLoad({ filter: /[/\\]portableStartup\.mjs$/ }, () => ({
              contents: `export async function measurePortableStartup() { return ${JSON.stringify(built.startup)} }`,
              loader: 'js',
            }))
          },
        },
      ],
    })
    if (gate === 'size') built.sizeGate = target
    else built.splitGate = target
  })
  // Evaluate the production option declarations, not a second approximate build configuration.
  const source = readFileSync('scripts/build.mjs', 'utf8')
  const declarations = source.slice(
    source.indexOf('const browserReviewComment ='),
    source.indexOf('async function buildPortable()'),
  )
  const strings = Object.fromEntries(
    source.matchAll(/const (\w+) = '([^']*)'/g).map((match) => [match[1], match[2]]),
  )
  const optionContext = {
    ...strings,
    readFileSync,
    path,
    esbuild: { transform },
    isProduction: true,
    sharedHighlightGrammar,
    compactBrowserUiText,
    lazyBrowserKeybindings,
    resourceBrowserValidation,
    common: {
      bundle: true,
      minify: true,
      metafile: true,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
    },
  }
  const options = runInThisContext(`(context) => {
    const { ${Object.keys(optionContext).join(',')} } = context;
    ${declarations}
    return portableOptions;
  }`)(optionContext)
  const original = readFileSync('src/webview/portable.tsx', 'utf8')
  const imports = Object.values(portableMeta.outputs)
    .map((output) => output.entryPoint)
    .filter((source) => source?.startsWith('src/webview/') && source !== 'src/webview/portable.tsx')
    .slice(0, 64)
    .map(
      (source) =>
        `bootImport(() => import(${JSON.stringify(`./${path.posix.relative('src/webview', source)}`)}))`,
    )
    .join(',')
  expect(imports.match(/bootImport/g)).toHaveLength(64)
  const mountCall =
    'mountChat(rootElement, portableChatBridge(host), reportBridgeFailure, markChatMounted)'
  const scenarioSources = [
    ['baseline', original],
    [
      'argument',
      original.replace(
        mountCall,
        () =>
          `mountChat(rootElement, (await Promise.all([${imports}]), portableChatBridge(host)), reportBridgeFailure, markChatMounted)`,
      ),
    ],
    [
      'helper',
      original.replace(
        'async function mount(): Promise<void> {',
        () =>
          `async function prepareBoot() { await Promise.all([${imports}]) }\nasync function mount(): Promise<void> { await prepareBoot();`,
      ),
    ],
    [
      'deferred',
      original.replace(
        '  performance.mark(PORTABLE_CHAT_MOUNTED_MARK)',
        () =>
          `  performance.mark(PORTABLE_CHAT_MOUNTED_MARK)\n  requestIdleCallback(() => { void Promise.all([${imports}]) })`,
      ),
    ],
  ]
  // Only the portable entry changes. Incremental rebuilds retain esbuild's
  // dependency parsing cache without reusing any scenario's emitted bytes.
  let scenarioSource = original
  const regressionBuild = await buildContext({
    ...options,
    write: false,
    plugins: [
      {
        name: 'boot-regression',
        setup(build) {
          build.onLoad({ filter: /[/\\]portable\.tsx$/ }, (args) => ({
            contents: scenarioSource,
            loader: 'tsx',
            resolveDir: path.dirname(args.path),
          }))
        },
      },
      ...options.plugins.map((plugin) => {
        if (![compactBrowserUiText, lazyBrowserKeybindings].includes(plugin)) return plugin
        // These scenarios change boot order only. Both reader surveys inspect
        // the same unchanged files on disk, so prepare their real data once in
        // this context; emitted scenario graphs are still rebuilt independently.
        return {
          ...plugin,
          setup(build) {
            plugin.setup({
              ...build,
              onStart(callback) {
                let prepared
                build.onStart(() => {
                  prepared ??= Promise.resolve(callback())
                  return prepared
                })
              },
            })
          },
        }
      }),
    ],
  })
  try {
    for (const [scenario, contents] of scenarioSources) {
      scenarioSource = contents
      const graph = await regressionBuild.rebuild()
      const files = new Map(
        graph.outputFiles.map((file) => [
          path.relative(process.cwd(), file.path).replaceAll('\\', '/'),
          file.contents,
        ]),
      )
      const loader = 'dist/webview/portable/loader.js'
      files.set(loader, readFileSync(outputFile(loader)))
      graph.metafile.outputs[loader] = portableMeta.outputs[loader]
      if (scenario === 'baseline') {
        // The owned clone's dependency junction changes esbuild chunk hashes.
        // Compare source ownership and emitted byte lengths, independent of that root.
        const inventory = (meta) =>
          Object.values(meta.outputs)
            .map((output) => [
              Object.keys(output.inputs)
                .map((file) =>
                  file.replaceAll('\\', '/').replaceAll(/(?:\.\.\/)+(?=node_modules\/)/gu, ''),
                )
                .toSorted((a, b) => a.localeCompare(b, 'en')),
              output.bytes,
            ])
            .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
        expect(inventory(graph.metafile)).toEqual(inventory(portableMeta))
      }
      built.graphs.set(scenario, { meta: graph.metafile, files })
      if (scenario === 'baseline')
        built.graphs.set('windows', {
          files,
          meta: {
            ...graph.metafile,
            outputs: Object.fromEntries(
              Object.entries(graph.metafile.outputs).map(([file, output]) => [
                file.replaceAll('/', '\\'),
                output,
              ]),
            ),
          },
        })
    }
  } finally {
    await regressionBuild.dispose()
  }
  for (const task of gateTasks) await task()
  // RVM104F4I P3: the complete split gate runs exactly once here, inside the
  // bounded setup hook — never inside a five-second test body. Each mutation
  // test below replays only its own gate section against this shared tree,
  // redoing solely what its mutation changes.
  {
    const baseline = spawnSync(process.execPath, [built.splitGate], {
      cwd: built.production,
      encoding: 'utf8',
    })
    expect(baseline.status, baseline.stdout + baseline.stderr).toBe(0)
  }
  {
    const gate = readFileSync('scripts/check-bundle-split.mjs', 'utf8')
    const section = (start, end, anchor) => {
      const text = gate.slice(gate.indexOf(start), gate.indexOf(end))
      expect(text).toContain(anchor)
      return text
    }
    built.splitSections = {
      inputsOf: section(
        'function inputsOf({ output, metafile }) {',
        '/** Every TypeScript file under the backend',
        'bytesInOutput',
      ),
      shipped: section(
        'function shippedBundles() {',
        'const SHIPPED = shippedBundles()',
        'dist/webview/portable/main.js',
      ),
      normalMeta: section(
        'function normalWebviewMeta(meta) {',
        'const webviewMeta = normalWebviewMeta(',
        'entryPoint',
      ),
      lazyHead: [
        section('const LAZY_ONLY = [', '/** The bundle', "'pacing.ts'"),
        section(
          "const MODEL_API_DIR = 'src/core/backends/modelapi'",
          "const ENTRY = 'src/host/backend/modelApiEntry.ts'",
          'modelapi',
        ),
        section('const loaders = [', 'for (const name of lazy) {', 'BUNDLES.acp.output'),
      ].join('\n'),
      lazyLoop: section(
        'for (const name of lazy) {',
        'for (const [output, inputs] of loaders) {\n  if (inputs.has(ENTRY))',
        'which loads only with the backend',
      ),
      budget: section(
        'for (const { name, budgetKiB, outputs } of portableWebviewBudgetGroups(',
        "const portableChunks = 'dist/webview/portable/chunks'",
        'exceeds ${budgetKiB} KiB',
      ),
      // RVM104F4J P3: the gate's only resource-policy call lives outside
      // shippedBundles, so it gets a slice anchor of its own. Deleting that
      // call fails setup before any body can pass on a stale copy.
      resource: section(
        'const SHIPPED = shippedBundles()',
        '// The authenticated classic bootstrap',
        'checkResourceBundles(inputsOf, SHIPPED)',
      ),
    }
    const { readdirSync: listDir, readFileSync: readFile } = productionFs()
    built.shippedBundles = runInThisContext(`(ports) => {
      const { readdirSync, readFileSync } = ports;
      ${built.splitSections.shipped}
      return shippedBundles();
    }`)({ readdirSync: listDir, readFileSync: readFile })
    expect(built.shippedBundles.length).toBeGreaterThan(0)
  }
  // The baseline boot stays sequential: the resource scenarios below derive
  // their eager set from its observed variants.
  {
    const graph = built.graphs.get('baseline')
    graph.variants = await measurePortableStartup(
      graph.meta,
      (file) => graph.files.get(file),
      built.browser,
    )
    built.memoryStartup = graph.variants
  }
  // One boot at a time avoids renderer/route contention on smaller machines.
  // Each scenario still owns a fresh context and its full measurement.
  const bootTasks = ['windows', 'argument', 'helper', 'deferred'].map((scenario) => async () => {
    const graph = built.graphs.get(scenario)
    graph.variants = await measurePortableStartup(
      graph.meta,
      (file) => graph.files.get(file),
      built.browser,
    )
  })
  bootTasks.push(
    ...['worker', 'font', 'extensionless'].map((scenario) => async () => {
      const baseline = built.graphs.get('baseline')
      const files = new Map(baseline.files)
      const meta = { ...baseline.meta, outputs: { ...baseline.meta.outputs } }
      const main = 'dist/webview/portable/main.js'
      const root = 'dist/webview/portable/'
      const url = (file) => `http://127.0.0.1/assets/portable/${file.slice(root.length)}`
      let prefix
      let required
      if (scenario === 'worker') {
        const eager = new Set(built.memoryStartup.flatMap(({ outputs }) => outputs))
        required = files
          .keys()
          .filter((file) => file.endsWith('.js') && !eager.has(file))
          .toArray()
        const worker = `Promise.all(${JSON.stringify(required.map((file) => url(file)))}.map(async url => {
          const response = await fetch(url); if (!response.ok) throw new Error(url);
          await response.arrayBuffer();
        })).then(() => postMessage('ready'));`
        const workerFile = root + 'boot-worker.js'
        const workerBytes = Buffer.from(worker)
        files.set(workerFile, workerBytes)
        meta.outputs[workerFile] = { bytes: workerBytes.byteLength, inputs: {}, imports: [] }
        required.push(workerFile)
        prefix = `await new Promise((resolve, reject) => {
          const worker = new Worker(${JSON.stringify(url(workerFile))});
          worker.onmessage = () => { worker.terminate(); resolve(); }; worker.onerror = reject;
        });`
      } else {
        const resource = root + (scenario === 'font' ? 'inter.woff2' : 'boot-payload')
        const bytes =
          scenario === 'font'
            ? readFileSync('design/fonts/pack/inter.woff2')
            : Buffer.alloc(300 * 1024)
        files.set(resource, bytes)
        meta.outputs[resource] = { bytes: bytes.byteLength, inputs: {}, imports: [] }
        required = [resource]
        prefix =
          scenario === 'font'
            ? `await Promise.all([new FontFace('startup-inter', 'url(${url(resource)})').load(), fetch('${url(resource)}?alias').then(r => r.arrayBuffer())]);`
            : `await Promise.all(['${url(resource)}', '${url(resource)}?alias'].map(async url => (await fetch(url)).arrayBuffer()));`
      }
      files.set(main, Buffer.concat([Buffer.from(prefix), files.get(main)]))
      meta.outputs[main] = { ...meta.outputs[main], bytes: files.get(main).byteLength }
      const variants = await measurePortableStartup(meta, (file) => files.get(file), built.browser)
      built.graphs.set(`resource:${scenario}`, { meta, files, required, variants })
    }),
  )
  // Negative boots own fresh contexts too. Share this expensive preparation
  // in the existing production hook; each test keeps the default body deadline.
  const baseline = built.graphs.get('baseline')
  const cases = [
    ...NON_BUILT_REQUESTS.map(([variant, url]) => {
      const worker = `fetch(${JSON.stringify(url)}).then(() => postMessage('ready'), () => postMessage('ready'));`
      const prefix =
        variant === 'worker'
          ? `await new Promise(resolve => { const worker = new Worker('/assets/portable/negative-worker.js'); worker.onmessage = () => { worker.terminate(); resolve(); }; });`
          : `if (document.body.dataset.bridge === ${JSON.stringify(variant)}) await fetch(${JSON.stringify(url)});`
      return [`${variant}:${url}`, prefix, variant === 'worker' ? worker : undefined]
    }),
    ...UNROUTABLE_TARGETS,
  ]
  bootTasks.push(
    ...cases.map(([key, prefix, worker]) => async () => {
      // Refusal occurs before chat mounts. Keep the real production loader
      // and its guards without evaluating React's full graph first.
      const files = new Map([
        ['dist/webview/portable/loader.js', baseline.files.get('dist/webview/portable/loader.js')],
        ['dist/webview/portable/main.css', Buffer.alloc(0)],
        [
          'dist/webview/portable/main.js',
          Buffer.from(prefix + "performance.mark('muse:chat-mounted');"),
        ],
      ])
      const meta = {
        outputs: Object.fromEntries(files.keys().map((file) => [file, { imports: [] }])),
      }
      if (worker !== undefined) {
        const file = 'dist/webview/portable/negative-worker.js'
        const bytes = Buffer.from(worker)
        files.set(file, bytes)
        meta.outputs[file] = { bytes: bytes.byteLength, inputs: {}, imports: [] }
      }
      try {
        await measurePortableStartup(meta, (file) => files.get(file), built.browser)
      } catch (error) {
        built.failures.set(key, error)
      }
    }),
  )
  // A cancelled/untimed served request cannot establish the render boundary.
  const timingBrowser = {
    newContext: async (options) => {
      const context = await built.browser.newContext(options)
      const route = context.route.bind(context)
      context.route = (pattern, handler) =>
        route(pattern, (value) => {
          value.request().timing = () => ({ startTime: -1 })
          return handler(value)
        })
      return context
    },
  }
  bootTasks.push(async () => {
    try {
      await measurePortableStartup(baseline.meta, (file) => baseline.files.get(file), timingBrowser)
    } catch (error) {
      built.failures.set('untimed', error)
    }
  })
  for (const task of bootTasks) await task()
}, 120_000)

afterAll(async () => {
  await built.browser?.close()
  for (const folder of [built.fixture, built.production])
    if (folder !== '') rmSync(folder, { recursive: true, force: true })
})

function initialOutputs() {
  const eager = new Set()
  function visit(output) {
    if (eager.has(output)) return
    eager.add(output)
    const imports = built.outputs[output].imports
    for (const entry of imports) {
      if (!entry.external && entry.kind !== 'dynamic-import') visit(entry.path)
    }
  }
  visit(ENTRY)
  return eager
}

/** Mock build outputs for the size gate, including duplicate edges and a large deferred file. */
function sizeFixture(sharedBytes) {
  writeFileSync(path.join(built.fixture, ENTRY), 'x')
  writeFileSync(path.join(built.fixture, 'dist/webview/shared.js'), Buffer.alloc(sharedBytes))
  writeFileSync(path.join(built.fixture, 'dist/webview/deferred.js'), Buffer.alloc(49 * 1024))
  writeFileSync(path.join(built.fixture, 'dist/webview/TeamUi.js'), '')
  writeFileSync(
    path.join(built.fixture, 'dist/meta/usageWebview.json'),
    JSON.stringify({
      outputs: {
        'dist/webview/usage.js': { imports: [] },
        'dist/webview/deferred.js': { imports: [], entryPoint: 'src/webview/usage/UsageApp.tsx' },
      },
    }),
  )
  writeFileSync(path.join(built.fixture, 'dist/webview/models-body.js'), '')
  writeFileSync(
    path.join(built.fixture, 'dist/meta/modelsWebview.json'),
    JSON.stringify({
      outputs: {
        'dist/webview/models.js': { imports: [] },
        'dist/webview/models-body.js': { imports: [], entryPoint: 'src/webview/models/panel.tsx' },
      },
    }),
  )
  const shared = { path: 'dist/webview/shared.js', kind: 'import-statement', external: false }
  writeFileSync(
    path.join(built.fixture, 'dist/meta/webview.json'),
    JSON.stringify({
      outputs: {
        [ENTRY]: {
          imports: [
            shared,
            shared,
            { path: 'dist/webview/deferred.js', kind: 'dynamic-import', external: false },
          ],
        },
        'dist/webview/shared.js': { imports: [] },
        'dist/webview/models.js': { imports: [] },
        'dist/webview/deferred.js': { imports: [] },
        'dist/webview/TeamUi.js': {
          entryPoint: 'src/webview/components/TeamUi.tsx',
          imports: [],
        },
        'dist/webview/usage.js': { imports: [] },
      },
    }),
  )
  return spawnSync(process.execPath, [built.sizeGate], { cwd: built.fixture, encoding: 'utf8' })
}

function questionSizeFixture(bytes) {
  sizeFixture(0)
  const metaPath = path.join(built.fixture, 'dist/meta/webview.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const file = 'dist/webview/question.js'
  meta.outputs[ENTRY].imports.push({ path: file, kind: 'dynamic-import', external: false })
  meta.outputs[file] = { imports: [], entryPoint: 'src/webview/components/QuestionUi.tsx' }
  writeFileSync(path.join(built.fixture, file), Buffer.alloc(bytes))
  writeFileSync(metaPath, JSON.stringify(meta))
  return spawnSync(process.execPath, [built.sizeGate], { cwd: built.fixture, encoding: 'utf8' })
}

// RVM104F4I P3: file ports scoped to the shared production tree, so each
// mutation body below replays one real split-gate section without relaunching
// the complete gate.
function productionFs() {
  return {
    existsSync: (file) => existsSync(outputFile(file)),
    readdirSync: (dir, options) => readdirSync(outputFile(dir), options),
    readFileSync: (file, ...rest) => readFileSync(outputFile(file), ...rest),
    statSync: (file) => statSync(outputFile(file)),
  }
}

// The gate's own metafile reader over the production tree, memoised per body.
function productionInputsOf() {
  const { existsSync, readFileSync } = productionFs()
  const cache = new Map()
  const inputsOf = runInThisContext(`(ports) => {
    const { existsSync, readFileSync } = ports;
    ${built.splitSections.inputsOf}
    return inputsOf;
  }`)({ existsSync, readFileSync })
  return (bundle) => {
    if (!cache.has(bundle.metafile)) cache.set(bundle.metafile, inputsOf(bundle))
    return cache.get(bundle.metafile)
  }
}

// The gate's portable budget verdict over the production tree as mutated.
function runSplitBudget() {
  const { existsSync, readFileSync, statSync } = productionFs()
  const ports = {
    portableWebviewBudgetGroups,
    normalWebviewMeta: runInThisContext(`() => {
      ${built.splitSections.normalMeta}
      return normalWebviewMeta;
    }`)(),
    portableMeta: undefined,
    portableStartup: built.startup,
    existsSync,
    statSync,
    BYTES_PER_KIB: 1024,
    problems: [],
  }
  ports.portableMeta = ports.normalWebviewMeta(
    JSON.parse(readFileSync('dist/meta/portable.json', 'utf8')),
  )
  runInThisContext(`(ports) => {
    const { ${Object.keys(ports).join(',')} } = ports;
    ${built.splitSections.budget}
  }`)(ports)
  return ports.problems
}

// The gate's backend-lazy verdict over the production tree as mutated.
function runSplitLazy() {
  const inputsOf = productionInputsOf()
  const ports = {
    BUNDLES,
    activation: inputsOf(BUNDLES.activation),
    acp: inputsOf(BUNDLES.acp),
    modelApi: inputsOf(BUNDLES.modelApi),
    problems: [],
  }
  runInThisContext(`(ports) => {
    const { ${Object.keys(ports).join(',')} } = ports;
    ${built.splitSections.lazyHead}
    const lazy = new Set(LAZY_ONLY);
    ${built.splitSections.lazyLoop}
  }`)(ports)
  return ports.problems
}

// The gate's own resource-policy verdict over the production tree as
// mutated: the shipped list and the single checkResourceBundles call,
// sliced verbatim from the gate, never the library on its own.
function runSplitResource() {
  const { readdirSync, readFileSync } = productionFs()
  const inputsOf = productionInputsOf()
  const ports = { readdirSync, readFileSync, inputsOf, checkResourceBundles, problems: [] }
  runInThisContext(`(ports) => {
    const { ${Object.keys(ports).join(',')} } = ports;
    ${built.splitSections.shipped}
    ${built.splitSections.resource}
  }`)(ports)
  return ports.problems
}

describe('the production webview chunks (FIX78W)', () => {
  it('keeps qualification contexts from competing for the five-second boot deadline', () => {
    expect(built.contexts.peak).toBe(1)
    expect(built.contexts.active).toBe(0)
  })
  it('keeps the question renderer and dock in one independently budgeted lazy closure', () => {
    for (const name of ['QuestionCard', 'QuestionUi', 'OpenQuestionsChip']) {
      const source = `src/webview/components/${name}.tsx`
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners).toHaveLength(1)
      expect(initialOutputs().has(owners[0][0])).toBe(false)
      expect(built.outputs[owners[0][0]].entryPoint).toBe('src/webview/components/QuestionUi.tsx')
    }
  })

  it('defers the complete M118 prompt library and chat preview behind independent caps', () => {
    const eager = initialOutputs()
    for (const source of [
      'src/webview/components/EffortSlider.tsx',
      'src/webview/prompts/PromptLibraryBridge.tsx',
      'src/webview/sharing/ChatShareBridge.tsx',
    ]) {
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners).toHaveLength(1)
      expect(eager.has(owners[0][0])).toBe(false)
    }
    for (const name of ['prompt library', 'chat sharing', 'HistoryPromptRow']) {
      const group = webviewDeferredBudgetGroups({ outputs: built.outputs }).find(
        (entry) => entry.name === name,
      )
      expect(group.budgetKiB).toBe(25)
      expect(group.outputs.length).toBeGreaterThan(0)
      expect(
        group.outputs.reduce((sum, file) => sum + statSync(outputFile(file)).size, 0),
      ).toBeLessThanOrEqual(group.budgetKiB * 1024)
    }
  })

  it('enforces the question closure cap independently of the full legacy deferred group', () => {
    const withinBudget = questionSizeFixture(25 * 1024)
    expect(withinBudget.status, withinBudget.stdout + withinBudget.stderr).toBe(0)
    expect(withinBudget.stdout).toContain('question UI: 25.0 KiB (budget 25 KiB)')
    const overflow = questionSizeFixture(25 * 1024 + 1)
    expect(overflow.status).toBe(1)
    expect(overflow.stdout).toContain('OVER dist/webview question UI:')
  })
  it.each(['dist/acp.js', 'dist/exec.js'])(
    'keeps standalone Node %s free of browser navigator probes',
    (file) => {
      expect(readFileSync(outputFile(file), 'utf8')).not.toMatch(/\bnavigator\b/)
    },
  )

  it('keeps all initial JavaScript within the unchanged 900 KiB cap', () => {
    const bytes = [...initialOutputs()].reduce(
      (sum, output) => sum + statSync(outputFile(output)).size,
      0,
    )
    expect(bytes).toBeLessThanOrEqual(900 * 1024)
  })

  it('M107 keeps resource validation deferred while sharing the caller React and English fallback', () => {
    const eager = initialOutputs()
    const resourceParsers = Object.entries(built.outputs).filter(([, output]) =>
      Object.keys(output.inputs).some((file) => file.startsWith('resource-validation:')),
    )
    expect(resourceParsers.length).toBeGreaterThan(0)
    for (const [file] of resourceParsers) expect(eager.has(file)).toBe(false)
    for (const prefix of ['node_modules/react/cjs/react.production.js', 'src/shared/l10n/en.ts']) {
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, prefix),
      )
      expect(owners).toHaveLength(1)
      expect(eager.has(owners[0][0])).toBe(true)
    }
  })

  it('shares resource validation in the complete portable graph', () => {
    const portable = JSON.parse(readFileSync(outputFile('dist/meta/portable.json'), 'utf8'))
    expect(
      Object.keys(portable.inputs).some((file) => file.startsWith('resource-validation:')),
    ).toBe(false)
    for (const source of ['src/shared/resources.ts', 'src/shared/hostApi/panel.ts'])
      expect(Object.hasOwn(portable.inputs, source)).toBe(true)
  })

  it.each([
    ['native startup resources', 1100, 'dist/webview/portable/loader.js'],
    ['companion startup resources', 1100, 'dist/webview/portable/loader.js'],
    ['total JS', 1486, 'dist/webview/portable/whatsNew.js'],
  ])('the split check rejects a one-byte portable %s overflow', async (name, cap, target) => {
    const meta = JSON.parse(readFileSync(outputFile('dist/meta/portable.json'), 'utf8'))
    const outputs = portableWebviewBudgetGroups(meta, built.startup).find(
      (group) => group.name === name,
    ).outputs
    const bytes = outputs.reduce((sum, file) => sum + statSync(outputFile(file)).size, 0)
    const file = outputFile(target)
    const original = readFileSync(file)
    try {
      writeFileSync(file, Buffer.concat([original, Buffer.alloc(cap * 1024 - bytes + 1, ' ')]))
      // The body's own gate section, not a fresh full-gate launch: the shared
      // setup already qualified the unmutated tree.
      const problems = runSplitBudget()
      expect(problems).toContainEqual(
        expect.stringContaining(`portable ${name} exceeds ${cap} KiB`),
      )
      if (name === 'total JS')
        expect(problems.join('\n')).not.toMatch(
          /portable (native|companion) startup resources exceeds/,
        )
    } finally {
      writeFileSync(file, original)
    }
    expect(readFileSync(file).equals(original)).toBe(true)
  })

  it.each(['baseline', 'windows', 'argument', 'helper', 'deferred'])(
    'measures production %s imports at the first-render boundary',
    (scenario) => {
      const { meta, files, variants } = built.graphs.get(scenario)
      const groups = portableWebviewBudgetGroups(meta, variants)
      for (const group of groups) {
        const bytes = group.outputs.reduce((sum, file) => sum + files.get(file).byteLength, 0)
        const isOverBudget = bytes > group.budgetKiB * 1024
        expect(isOverBudget, `${scenario}: ${group.name}: ${bytes} bytes`).toBe(
          group.name !== 'total JS' && ['argument', 'helper'].includes(scenario),
        )
      }
      switch (scenario) {
        case 'baseline': {
          built.memoryStartup = variants
          for (const group of groups) {
            const baseline = portableWebviewBudgetGroups(
              JSON.parse(readFileSync(outputFile('dist/meta/portable.json'), 'utf8')),
              built.startup,
            ).find((entry) => entry.name === group.name)
            expect(group.outputs.reduce((sum, file) => sum + files.get(file).byteLength, 0)).toBe(
              baseline.outputs.reduce((sum, file) => sum + statSync(outputFile(file)).size, 0),
            )
            expect(group.outputs).toHaveLength(baseline.outputs.length)
          }
          break
        }
        case 'windows': {
          expect(variants).toEqual(built.memoryStartup)
          break
        }
        case 'deferred': {
          for (const { variant, outputs } of variants) {
            const baseline = built.startup.find((entry) => entry.variant === variant).outputs
            // Imports alter chunk hashes; compare their source ownership as well as byte caps.
            const sources = outputs.flatMap((file) => Object.keys(meta.outputs[file].inputs))
            const before = baseline.flatMap((file) =>
              Object.keys(
                JSON.parse(readFileSync(outputFile('dist/meta/portable.json'), 'utf8')).outputs[
                  file
                ].inputs,
              ),
            )
            expect(new Set(sources)).toEqual(new Set(before))
          }
          break
        }
      }
    },
  )

  it.each(['worker', 'font', 'extensionless'])(
    'rejects awaited %s built resources above the startup cap',
    async (scenario) => {
      const { meta, files, required, variants } = built.graphs.get(`resource:${scenario}`)
      for (const { outputs, resources } of variants) {
        for (const resource of required) expect(outputs).toContain(resource)
        expect(new Set(outputs).size).toBe(outputs.length)
        expect(resources).toEqual(
          outputs.map((file) => ({
            file,
            bytes: files.get(file).byteLength,
            sha256: createHash('sha256').update(files.get(file)).digest('hex'),
          })),
        )
      }
      const groups = portableWebviewBudgetGroups(meta, variants)
      for (const group of groups) {
        const bytes = group.outputs.reduce((sum, file) => sum + files.get(file).byteLength, 0)
        expect(bytes > group.budgetKiB * 1024, `${scenario}: ${group.name}: ${bytes} bytes`).toBe(
          group.name !== 'total JS',
        )
      }
      // Replay the actual gate sections with the browser's observed lists and
      // these in-memory emitted bytes, so this assertion cannot mirror a gate.
      const log = []
      const ports = {
        portableWebviewBudgetGroups,
        measurePortableStartup: async () => variants,
        readFileSync: () => JSON.stringify(meta),
        existsSync: (file) => files.has(file),
        statSync: (file) => ({ size: files.get(file).byteLength }),
        BYTES_PER_KIB: 1024,
        console: {
          log: (...values) => {
            log.push(values)
          },
        },
      }
      const size = readFileSync('scripts/check-bundle-size.mjs', 'utf8')
      const sizeSection = size.slice(
        size.indexOf("const portableMeta = JSON.parse(readFileSync('dist/meta/portable.json'"),
        size.indexOf('// TRAIN15C: provider usage'),
      )
      expect(
        await runInThisContext(`async (ports) => {
        const { ${Object.keys(ports).join(',')} } = ports;
        let hasFailure = false; ${sizeSection}; return hasFailure;
      }`)(ports),
      ).toBe(true)
      const split = readFileSync('scripts/check-bundle-split.mjs', 'utf8')
      const splitSection = split.slice(
        split.indexOf('for (const { name, budgetKiB, outputs } of portableWebviewBudgetGroups('),
        split.indexOf("const portableChunks = 'dist/webview/portable/chunks'"),
      )
      expect(
        runInThisContext(`(ports, portableMeta, portableStartup) => {
        const { ${Object.keys(ports).join(',')} } = ports;
        const problems = []; ${splitSection}; return problems;
      }`)(ports, meta, variants),
      ).toEqual([
        expect.stringMatching(/portable native startup .* exceeds 1100 KiB/),
        expect.stringMatching(/portable companion startup .* exceeds 1100 KiB/),
      ])
    },
  )

  it.each(NON_BUILT_REQUESTS)(
    'refuses %s non-built boot request %s with a named diagnostic',
    (variant, url) => {
      expect(built.failures.get(`${variant}:${url}`)).toMatchObject({
        message: expect.stringContaining('PORTABLE_STARTUP_UNBUILT_REQUEST'),
      })
    },
  )
  it.each(UNROUTABLE_TARGETS)('refuses unroutable %s boot activity explicitly', (kind) => {
    expect(built.failures.get(kind)).toMatchObject({
      message: expect.stringContaining(`PORTABLE_STARTUP_UNROUTABLE_TARGET: ${kind}`),
    })
  })

  it('refuses served resources without a request-start timestamp', () => {
    expect(built.failures.get('untimed')).toMatchObject({
      message: expect.stringContaining('PORTABLE_STARTUP_UNTIMED_REQUEST'),
    })
  })

  it('keeps usage, action dialogs and estimator within their existing closure caps', () => {
    const groups = webviewDeferredBudgetGroups({ outputs: built.outputs })
    for (const name of [
      'UsageDialogContent',
      'action dialogs',
      'estimator panel',
      'account English',
    ]) {
      const group = groups.find((entry) => entry.name === name)
      expect(group.budgetKiB).toBe(25)
      expect(group.outputs.length).toBeGreaterThan(0)
      expect(
        group.outputs.reduce((sum, file) => sum + statSync(outputFile(file)).size, 0),
        name,
      ).toBeLessThanOrEqual(25 * 1024)
    }
  })

  it('loads exact USD arithmetic and display only with lazy media pricing', () => {
    for (const source of ['src/shared/usd.ts', 'src/shared/l10n/exactUsd.ts']) {
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners).toHaveLength(1)
      expect(initialOutputs().has(owners[0][0])).toBe(false)
    }
  })

  it('keeps FIXDIET1 startup and original deferred bytes within their review baseline', () => {
    const bytes = [...initialOutputs()].reduce(
      (sum, output) => sum + statSync(outputFile(output)).size,
      0,
    )
    // INT0170 lead decision (PLAN §8): 0.17.0's measured first paint, 760,059 B,
    // plus 0.16.0's margin of about 1.4 KB. FIXDIET1's pin was 733.8 KiB.
    expect(bytes).toBeLessThanOrEqual(743.7 * 1024)
  })

  it('keeps original deferred bytes within the unchanged FIXDIET1 baseline', () => {
    const legacy = webviewDeferredBudgetGroups({ outputs: built.outputs }).find(
      (group) => group.name === 'deferred JS',
    )
    expect(legacy).toBeDefined()
    expect(
      legacy.outputs.reduce((sum, output) => sum + statSync(outputFile(output)).size, 0),
    ).toBeLessThanOrEqual(32.1 * 1024)
  })

  it.each([
    'src/shared/estimate.ts',
    'src/shared/estimatorProtocol.ts',
    'src/shared/palette.ts',
    'src/shared/slashCommands.ts',
  ])('keeps %s out of chat startup while retaining its validated lazy implementation', (source) => {
    const owners = Object.entries(built.outputs).filter(([, output]) =>
      Object.hasOwn(output.inputs, source),
    )
    expect(owners.length).toBeGreaterThan(0)
    for (const [output] of owners) expect(initialOutputs().has(output)).toBe(false)
  })

  it.each([
    'ToolBodies',
    'ToolRow',
    'ReviewFindings',
    'HistoryPromptRow',
    'GitPanel',
    'UsageDialog',
    'SignIn',
    'GoalPanel',
    'SchedulePanel',
    'Palette',
    'PopoverMenu',
    'GooeyMenuContent',
    'UsageDialogContent',
    'AgentMapContent',
    'ToolArgumentPreview',
    'ServiceStatusRow',
    'LegalReport',
    'ReviewCommentForm',
    // FIXM116I: the startup diet's directly-imported on-demand bodies. (The
    // task list and effort control share one merged chunk, so the named
    // closure below — not this per-entry assertion — locks their placement.)
    'SlashMenu',
    'MentionMenu',
    'DiffTally',
  ])('loads %s only through its dynamic import', (name) => {
    const source = `src/webview/components/${name}.tsx`
    const owners = Object.entries(built.outputs).filter(([, output]) =>
      Object.hasOwn(output.inputs, source),
    )
    expect(owners).toHaveLength(1)
    const [[output]] = owners
    expect(initialOutputs().has(output)).toBe(false)
    expect(built.outputs[output].entryPoint).toBe(source)
    expect(Object.values(built.outputs).flatMap((chunk) => chunk.imports)).toContainEqual(
      expect.objectContaining({ path: output, kind: 'dynamic-import' }),
    )
  })

  it.each([
    ['WorkflowRun', 'WorkflowRun'],
    ['ElicitationCard', 'QuestionUi'],
  ])(
    'keeps %s within its lazy %s surface without pulling its implementation into startup',
    (name, surface) => {
      const source = `src/webview/components/${name}.tsx`
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners).toHaveLength(1)
      const [[owner]] = owners
      expect(initialOutputs().has(owner)).toBe(false)
      const roots = Object.entries(built.outputs).filter(
        ([, output]) => output.entryPoint === `src/webview/components/${surface}.tsx`,
      )
      expect(roots).toHaveLength(1)
      const [[root, output]] = roots
      if (root !== owner)
        expect(output.imports).toContainEqual(
          expect.objectContaining({ path: owner, kind: 'import-statement' }),
        )
      expect(Object.values(built.outputs).flatMap((chunk) => chunk.imports)).toContainEqual(
        expect.objectContaining({ path: root, kind: 'dynamic-import' }),
      )
    },
  )
  it('keeps the substantive preview UI in its lazy chunk', () => {
    const source = 'src/webview/components/ToolArgumentPreview.tsx'
    const [file] = Object.entries(built.outputs).find(([, output]) =>
      Object.hasOwn(output.inputs, source),
    )
    const chunk = readFileSync(outputFile(file), 'utf8')
    for (const key of [
      'toolArgumentPreviewLabel',
      'toolArgumentPreviewPending',
      'toolArgumentPreviewPreparing',
      'toolArgumentPreviewTruncated',
    ]) {
      expect(chunk).toContain(key)
    }
    const row = readFileSync('src/webview/components/ToolRow.tsx', 'utf8')
    expect(row).not.toContain('toolArgumentPreviewLabel')
    expect(row).not.toContain('toolArgumentPreviewPending')
    expect(row).not.toContain('toolArgumentPreviewPreparing')
    expect(row).not.toContain('toolArgumentPreviewTruncated')
  })

  it.each(['ProviderUsageSection', 'PaidUsageSection'])(
    'loads %s from the usage dialog only through a nested dynamic import',
    (name) => {
      const source = `src/webview/components/${name}.tsx`
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners).toHaveLength(1)
      const [[file, output]] = owners
      expect(output.entryPoint).toBe(source)
      expect(initialOutputs().has(file)).toBe(false)
      const usage = Object.values(built.outputs).find(
        (output) => output.entryPoint === 'src/webview/components/UsageDialogContent.tsx',
      )
      expect(usage.imports).toContainEqual(
        expect.objectContaining({ path: file, kind: 'dynamic-import' }),
      )
    },
  )

  it.each([
    'src/shared/l10n/en.ts',
    'src/shared/l10n/text.ts',
    'node_modules/react/cjs/react.production.js',
  ])('shares one copy of %s with both panels', (source) => {
    const owners = Object.entries(built.outputs).filter(([, output]) =>
      Object.keys(output.inputs).some((file) => file.replaceAll('\\', '/') === source),
    )
    expect(owners).toHaveLength(1)
    expect(initialOutputs().has(owners[0][0])).toBe(true)
  })

  it('refuses resource policy leaking into activation’s emitted inputs', () => {
    const file = outputFile('dist/meta/extension.json')
    const original = readFileSync(file)
    try {
      const meta = JSON.parse(original.toString('utf8'))
      const output = Object.entries(meta.outputs).find(
        ([file]) => file.replaceAll('\\', '/') === 'dist/extension.js',
      )?.[1]
      if (output === undefined) throw new Error('Missing activation output')
      output.inputs['src/core/resources/governor.ts'] = { bytesInOutput: 1 }
      writeFileSync(file, JSON.stringify(meta))
      // The gate's own resource section over the mutated tree, not a fresh
      // full-gate launch and never the library on its own: removing the
      // gate's checkResourceBundles call fails the setup anchor first.
      const problems = runSplitResource()
      expect(problems).toContain(
        'dist/extension.js carries resource policy src/core/resources/governor.ts outside the lazy governor',
      )
    } finally {
      writeFileSync(file, original)
    }
    expect(readFileSync(file).equals(original)).toBe(true)
  })

  it('keeps provider pacing in its lazy Model API inventory', () => {
    // The shared setup already qualified the unmutated tree through the full
    // gate; this body replays only the gate's backend-lazy section.
    expect(runSplitLazy()).toEqual([])
    const source = 'src/core/backends/modelapi/pacing.ts'
    for (const [meta, present] of [
      ['dist/meta/modelApi.json', true],
      ['dist/meta/extension.json', false],
      ['dist/meta-acp/acp.json', false],
    ]) {
      const inputs = Object.keys(JSON.parse(readFileSync(outputFile(meta), 'utf8')).inputs).map(
        (file) => file.replaceAll('\\', '/'),
      )
      expect(inputs.includes(source)).toBe(present)
    }
  })

  it('shares production libraries between chat and Models without importing either app', () => {
    const models = JSON.parse(readFileSync(outputFile('dist/meta/modelsWebview.json'), 'utf8'))
    for (const source of [
      'node_modules/react/cjs/react.production.js',
      'node_modules/react-dom/cjs/react-dom-client.production.js',
      'node_modules/zod/v4/core/schemas.js',
      'src/shared/l10n/en.ts',
      'src/shared/l10n/text.ts',
      'src/webview/hostBridge.ts',
      'src/webview/installTable.ts',
      'src/webview/errorReport.ts',
    ]) {
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners, source).toHaveLength(1)
      expect(Object.hasOwn(models.outputs, owners[0][0]), source).toBe(true)
    }
    expect(Object.hasOwn(models.inputs, 'src/webview/App.tsx')).toBe(false)
    expect(Object.hasOwn(models.inputs, 'src/webview/components/ReviewPane.tsx')).toBe(false)
    expect(Object.keys(built.outputs)).not.toContain('dist/webview/models.js')
    const scripts = Object.keys(models.outputs).filter((file) => file.endsWith('.js'))
    expect(scripts.map((file) => readFileSync(outputFile(file), 'utf8')).join('\n')).not.toMatch(
      /[{,]reviewRemovedLine:/,
    )
  })

  it.each([
    ['modelsWebview', 'dist/webview/models.js', 'src/webview/models/panel.tsx'],
    ['usageWebview', 'dist/webview/usage.js', 'src/webview/usage/UsageApp.tsx'],
  ])('defers the optional %s body while sharing chat vendor chunks', (page, entry, source) => {
    const meta = JSON.parse(readFileSync(outputFile(`dist/meta/${page}.json`), 'utf8'))
    const owners = Object.entries(meta.outputs).filter(([, output]) =>
      Object.hasOwn(output.inputs, source),
    )
    expect(owners).toHaveLength(1)
    const [[file, output]] = owners
    expect(output.entryPoint).toBe(source)
    expect(meta.outputs[entry].imports).toContainEqual(
      expect.objectContaining({ path: file, kind: 'dynamic-import' }),
    )
    for (const dependency of [
      'node_modules/react/cjs/react.production.js',
      'node_modules/react-dom/cjs/react-dom-client.production.js',
      'src/shared/l10n/text.ts',
    ]) {
      const shared = Object.entries(meta.outputs).filter(([, chunk]) =>
        Object.hasOwn(chunk.inputs, dependency),
      )
      expect(shared, dependency).toHaveLength(1)
      expect(Object.hasOwn(built.outputs, shared[0][0]), dependency).toBe(true)
    }
  })

  it('keeps the shipped M96 renderers inside the shared chat graph', () => {
    const graphs = ['webview', 'modelsWebview', 'whatsNewPage'].map((page) =>
      JSON.parse(readFileSync(outputFile(`dist/meta/${page}.json`), 'utf8')),
    )
    const outputs = Object.assign({}, ...graphs.map((graph) => graph.outputs))
    for (const source of ['TeamUi', 'TeamTree', 'TeamCards']) {
      const owners = Object.entries(outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, `src/webview/components/${source}.tsx`),
      )
      expect(owners, source).toHaveLength(1)
      expect(Object.hasOwn(built.outputs, owners[0][0]), source).toBe(true)
      expect(initialOutputs().has(owners[0][0]), source).toBe(false)
    }
    for (const source of [
      'node_modules/react/cjs/react.production.js',
      'node_modules/react-dom/cjs/react-dom-client.production.js',
      'node_modules/zod/v4/core/schemas.js',
      'src/webview/hostBridge.ts',
    ]) {
      expect(
        Object.values(outputs).filter((output) => Object.hasOwn(output.inputs, source)),
        source,
      ).toHaveLength(1)
    }
    // Traffic and runner forms have only harness/test readers on this input.
    expect(Object.keys(outputs)).not.toContain('dist/traffic-harness/main.js')
  })

  it('builds the catalogue data module with every exact JSON value', () => {
    const file = outputFile('dist/providerCatalog.js')
    expect(createRequire(file)(file)).toEqual(
      JSON.parse(readFileSync(outputFile('dist/providerCatalog.json'), 'utf8')),
    )
  })

  it('packages every emitted browser script, with no stale browser chunks', async () => {
    const files = await listFiles({ cwd: built.fixture, dependencies: false })
    const listed = files
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file.startsWith('dist/webview/') && file.endsWith('.js'))
      .toSorted((a, b) => a.localeCompare(b, 'en'))
    expect(listed).toEqual(
      [
        ...Object.keys(built.outputs),
        ...Object.keys(
          JSON.parse(readFileSync(outputFile('dist/meta/modelsWebview.json'), 'utf8')).outputs,
        ),
        ...Object.keys(
          JSON.parse(readFileSync(outputFile('dist/meta/whatsNewPage.json'), 'utf8')).outputs,
        ),
        ...Object.keys(
          JSON.parse(readFileSync(outputFile('dist/meta/usageWebview.json'), 'utf8')).outputs,
        ),
        ...Object.keys(
          JSON.parse(readFileSync(outputFile('dist/meta/referencePage.json'), 'utf8')).outputs,
        ),
      ]
        .filter((file, index, files) => files.indexOf(file) === index)
        .map((file) => file.replaceAll('\\', '/'))
        .filter((file) => file.endsWith('.js'))
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    )
  })

  it('counts a shared static chunk once and leaves dynamic imports outside startup', () => {
    const result = sizeFixture(899 * 1024)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('static imports: 899.0 KiB (budget 900 KiB)')
  })

  it('rejects overflow in a static chunk even when the entry itself is tiny', () => {
    const result = sizeFixture(900 * 1024)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('OVER dist/webview/main.js + static imports')
  })

  it('rejects a missing static chunk', () => {
    sizeFixture(0)
    rmSync(path.join(built.fixture, 'dist/webview/shared.js'))
    const result = spawnSync(process.execPath, [built.sizeGate], {
      cwd: built.fixture,
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ENOENT')
    expect(result.stderr).toContain('stat ')
    expect(result.stderr.replaceAll('\\', '/')).toContain('dist/webview/shared.js')
  })

  it('qualifies the full split gate once in setup, never inside a test body', () => {
    // RVM104F4I P3: a full-gate launch costs seconds on a slow machine and
    // breaks the five-second body deadline. Bodies replay only their own
    // section through runSplitBudget, runSplitLazy and runSplitResource.
    const source = readFileSync('test/unit/webviewBundle.test.mjs', 'utf8')
    expect(
      source.matchAll(/spawnSync\(process\.execPath, \[built\.splitGate\]/g).toArray(),
    ).toHaveLength(1)
    for (const file of ['test/unit/webviewBundles.test.mjs', 'test/unit/bundleSize.test.mjs']) {
      expect(readFileSync(file, 'utf8')).not.toContain('check-bundle-split')
    }
  })
})

it('assigns a non-entry optional input with Windows path separators to its lazy budget', () => {
  const meta = {
    outputs: {
      'dist\\webview\\main.js': { imports: [], inputs: {} },
      'dist\\webview\\chunks\\optional.js': {
        imports: [],
        inputs: { 'src\\webview\\components\\SignIn.tsx': { bytesInOutput: 1 } },
      },
    },
  }
  expect(
    webviewDeferredBudgetGroups(meta, 25).find((group) => group.name === 'SignIn').outputs,
  ).toEqual(['dist/webview/chunks/optional.js'])
})
