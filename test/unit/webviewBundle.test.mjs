import { spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { listFiles } from '@vscode/vsce/out/package.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webviewDeferredBudgetGroups } from '../../scripts/lib/webviewBundles.mjs'
import { buildProductionPackage } from './helpers/productionPackage'

const ENTRY = 'dist/webview/main.js'
const SIZE_GATE = path.resolve('scripts/check-bundle-size.mjs')
const built = { outputs: {}, fixture: '', production: '' }
const outputFile = (file) => path.join(built.production, file)

beforeAll(() => {
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
}, 120_000)

afterAll(() => {
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
  return spawnSync(process.execPath, [SIZE_GATE], { cwd: built.fixture, encoding: 'utf8' })
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
  return spawnSync(process.execPath, [SIZE_GATE], { cwd: built.fixture, encoding: 'utf8' })
}

describe('the production webview chunks (FIX78W)', () => {
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

  it('keeps FIXDIET1 startup and original deferred bytes within their review baseline', () => {
    const bytes = [...initialOutputs()].reduce(
      (sum, output) => sum + statSync(outputFile(output)).size,
      0,
    )
    expect(bytes).toBeLessThanOrEqual(733.8 * 1024)
    const legacy = webviewDeferredBudgetGroups({ outputs: built.outputs }).find(
      (group) => group.name === 'deferred JS',
    )
    expect(legacy).toBeDefined()
    expect(
      legacy.outputs.reduce((sum, output) => sum + statSync(outputFile(output)).size, 0),
    ).toBeLessThanOrEqual(32.1 * 1024)
  })

  it.each([
    'ToolBodies',
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
      const result = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
        cwd: built.production,
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'dist/extension.js carries resource policy src/core/resources/governor.ts outside the lazy governor',
      )
    } finally {
      writeFileSync(file, original)
    }
    expect(readFileSync(file).equals(original)).toBe(true)
  })

  it('keeps provider pacing in its lazy Model API inventory', () => {
    const result = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
      cwd: built.production,
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
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
    const result = spawnSync(process.execPath, [SIZE_GATE], {
      cwd: built.fixture,
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ENOENT')
    expect(result.stderr).toContain('stat ')
    expect(result.stderr.replaceAll('\\', '/')).toContain('dist/webview/shared.js')
  })
})
