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
import { createRequire } from 'node:module'
import { listFiles } from '@vscode/vsce/out/package.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ENTRY = 'dist/webview/main.js'
const SIZE_GATE = path.resolve('scripts/check-bundle-size.mjs')
const built = { outputs: {}, fixture: '' }

beforeAll(() => {
  mkdirSync('dist/webview/chunks', { recursive: true })
  writeFileSync('dist/webview/chunks/stale.js', 'throw new Error("stale browser chunk")')
  // Exercise the real production settings, including removal of stale chunks.
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
  built.outputs = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8')).outputs
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
  for (const page of ['modelsWebview', 'whatsNewPage']) {
    cpSync(`dist/meta/${page}.json`, path.join(built.fixture, `dist/meta/${page}.json`))
  }
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
  writeFileSync(path.join(built.fixture, 'dist/webview/TeamUi.js'), '')
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
        'dist/webview/TeamUi.js': {
          entryPoint: 'src/webview/components/TeamUi.tsx',
          imports: [],
        },
      },
    }),
  )
  return spawnSync(process.execPath, [SIZE_GATE], { cwd: built.fixture, encoding: 'utf8' })
}

describe('the production webview chunks (FIX78W)', () => {
  it('keeps all initial JavaScript within the unchanged 900 KiB cap', () => {
    const bytes = [...initialOutputs()].reduce((sum, output) => sum + statSync(output).size, 0)
    expect(bytes).toBeLessThanOrEqual(900 * 1024)
  })

  it.each(['GitPanel', 'UsageDialog'])('loads %s only through its dynamic import', (name) => {
    const source = `src/webview/components/${name}.tsx`
    const owners = Object.entries(built.outputs).filter(([, output]) =>
      Object.hasOwn(output.inputs, source),
    )
    expect(owners).toHaveLength(1)
    const [[output]] = owners
    expect(initialOutputs().has(output)).toBe(false)
    expect(built.outputs[output].entryPoint).toBe(source)
    expect(built.outputs[ENTRY].imports).toContainEqual(
      expect.objectContaining({ path: output, kind: 'dynamic-import' }),
    )
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
        (output) => output.entryPoint === 'src/webview/components/UsageDialog.tsx',
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
      Object.hasOwn(output.inputs, source),
    )
    expect(owners).toHaveLength(1)
    expect(initialOutputs().has(owners[0][0])).toBe(true)
  })

  it('shares production libraries between chat and Models without importing either app', () => {
    const models = JSON.parse(readFileSync('dist/meta/modelsWebview.json', 'utf8'))
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
    expect(scripts.map((file) => readFileSync(file, 'utf8')).join('\n')).not.toMatch(
      /[{,]reviewRemovedLine:/,
    )
  })

  it('builds the catalogue data module with every exact JSON value', () => {
    const file = path.resolve('dist/providerCatalog.js')
    expect(createRequire(file)(file)).toEqual(
      JSON.parse(readFileSync('dist/providerCatalog.json', 'utf8')),
    )
  })

  it('packages every emitted browser script, with no stale browser chunks', async () => {
    const files = await listFiles({ cwd: built.fixture, dependencies: false })
    const listed = files
      .filter((file) => file.startsWith('dist/webview/') && file.endsWith('.js'))
      .toSorted((a, b) => a.localeCompare(b, 'en'))
    expect(listed).toEqual(
      [
        ...Object.keys(built.outputs),
        ...Object.keys(JSON.parse(readFileSync('dist/meta/modelsWebview.json', 'utf8')).outputs),
        ...Object.keys(JSON.parse(readFileSync('dist/meta/whatsNewPage.json', 'utf8')).outputs),
      ]
        .filter((file, index, files) => files.indexOf(file) === index)
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
