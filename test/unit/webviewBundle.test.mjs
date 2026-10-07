import { execFileSync, spawnSync } from 'node:child_process'
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
import { listFiles } from '@vscode/vsce/out/package.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webviewDeferredBudgetGroups } from '../../scripts/lib/webviewBundles.mjs'

const ENTRY = 'dist/webview/main.js'
const SIZE_GATE = path.resolve('scripts/check-bundle-size.mjs')
const built = { outputs: {}, fixture: '' }

beforeAll(() => {
  mkdirSync('dist/webview/chunks', { recursive: true })
  writeFileSync('dist/webview/chunks/stale.js', 'throw new Error("stale browser chunk")')
  // Exercise the real production settings, including removal of stale chunks.
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
  const outputs = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8')).outputs
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
  for (const file of readdirSync('dist')) {
    if (file.endsWith('.js')) writeFileSync(path.join(built.fixture, 'dist', file), '')
  }
  writeFileSync(path.join(built.fixture, 'dist/whatsNew.json'), '{}')
  writeFileSync(path.join(built.fixture, 'dist/webview/whatsNew.js'), '')
  // Exercise the real allowlist over all real emitted browser files in an
  // owned tree, without traversing other tests’ concurrently growing temp trees.
  cpSync('dist/webview', path.join(built.fixture, 'dist/webview'), { recursive: true })
  mkdirSync(path.join(built.fixture, 'docs/schemas'), { recursive: true })
  cpSync(
    'docs/schemas/exec-event-v2.schema.json',
    path.join(built.fixture, 'docs/schemas/exec-event-v2.schema.json'),
  )
  cpSync('.vscodeignore', path.join(built.fixture, '.vscodeignore'))
  cpSync('package.json', path.join(built.fixture, 'package.json'))
})

afterAll(() => {
  if (built.fixture !== '') rmSync(built.fixture, { recursive: true, force: true })
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
        'dist/webview/deferred.js': { imports: [] },
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
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bnavigator\b/)
    },
  )

  it('keeps all initial JavaScript within the unchanged 900 KiB cap', () => {
    const bytes = [...initialOutputs()].reduce((sum, output) => sum + statSync(output).size, 0)
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
    const bytes = [...initialOutputs()].reduce((sum, output) => sum + statSync(output).size, 0)
    expect(bytes).toBeLessThanOrEqual(733.8 * 1024)
    const legacy = webviewDeferredBudgetGroups({ outputs: built.outputs }).find(
      (group) => group.name === 'deferred JS',
    )
    expect(legacy).toBeDefined()
    expect(
      legacy.outputs.reduce((sum, output) => sum + statSync(output).size, 0),
    ).toBeLessThanOrEqual(32.1 * 1024)
  })

  it.each([
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

  it.each(['WorkflowRun', 'ElicitationCard'])(
    'shares %s between lazy surfaces without pulling its implementation into startup',
    (name) => {
      const source = `src/webview/components/${name}.tsx`
      const owners = Object.entries(built.outputs).filter(([, output]) =>
        Object.hasOwn(output.inputs, source),
      )
      expect(owners).toHaveLength(1)
      const [[owner]] = owners
      expect(initialOutputs().has(owner)).toBe(false)
      const roots = Object.entries(built.outputs).filter(
        ([, output]) => output.entryPoint === source,
      )
      expect(roots).toHaveLength(1)
      const [[root, output]] = roots
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
    const chunk = readFileSync(file, 'utf8')
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
    const file = 'dist/meta/extension.json'
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
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const source = 'src/core/backends/modelapi/pacing.ts'
    for (const [meta, present] of [
      ['dist/meta/modelApi.json', true],
      ['dist/meta/extension.json', false],
      ['dist/meta-acp/acp.json', false],
    ]) {
      const inputs = Object.keys(JSON.parse(readFileSync(meta, 'utf8')).inputs).map((file) =>
        file.replaceAll('\\', '/'),
      )
      expect(inputs.includes(source)).toBe(present)
    }
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
        ...Object.keys(JSON.parse(readFileSync('dist/meta/modelsWebview.json', 'utf8')).outputs),
        ...Object.keys(JSON.parse(readFileSync('dist/meta/whatsNewPage.json', 'utf8')).outputs),
        ...Object.keys(JSON.parse(readFileSync('dist/meta/referencePage.json', 'utf8')).outputs),
      ]
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
